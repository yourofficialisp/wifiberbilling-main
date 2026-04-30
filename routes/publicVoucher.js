const express = require('express');
const router = express.Router();
const { getHotspotProfiles } = require('../config/mikrotik');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const billingManager = require('../config/billing');
const logger = require('../config/logger');

// Helper function to get color based on price
function getPriceColor(price) {
    if (price <= 5000) return 'primary';
    if (price <= 10000) return 'success';
    if (price <= 20000) return 'info';
    if (price <= 30000) return 'warning';
    return 'danger';
}

// Helper function to ensure default package exists
async function ensureDefaultPackage() {
    return new Promise((resolve, reject) => {
        billingManager.db.get('SELECT id FROM packages WHERE id = 1', (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(1);

            billingManager.db.run(
                'INSERT INTO packages (id, name, speed, price, description, pppoe_profile) VALUES (1, "Public Voucher Package", "Unlimited", 0, "Default package for public voucher system", "default")',
                (err) => {
                    if (err) {
                        // If it fails because ID 1 already exists (race condition), it's fine
                        if (err.message.includes('UNIQUE constraint failed')) resolve(1);
                        else reject(err);
                    } else {
                        resolve(1);
                    }
                }
            );
        });
    });
}

// Helper function to get public voucher customer_id
async function getVoucherCustomerId() {
    await ensureDefaultPackage();
    return new Promise((resolve, reject) => {
        billingManager.db.get('SELECT id FROM customers WHERE username = ?', ['voucher_public'], (err, row) => {
            if (err) {
                reject(err);
            } else if (row) {
                resolve(row.id);
            } else {
                // If not exists, create new voucher customer with safe ID (1021)
                billingManager.db.run(`
                    INSERT INTO customers (id, username, name, phone, email, address, package_id, status, join_date, 
                                          pppoe_username, pppoe_profile, auto_suspension, billing_day, 
                                          latitude, longitude, static_ip, mac_address, assigned_ip)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    1021, // Safe ID, far from billing range (1000+)
                    'voucher_public', 'Public Voucher', '0000000000', 'voucher@public.com', 'Public Voucher System',
                    1, 'active', new Date().toISOString(), 'voucher_public', 'voucher', 0, 1,
                    0, 0, null, null, null
                ], function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID || 1021);
                });
            }
        });
    });
}

// Helper function to get online voucher settings
async function getVoucherOnlineSettings() {
    return new Promise((resolve, reject) => {
        // Try to get from voucher_online_settings table if exists
        billingManager.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='voucher_online_settings'", (err, row) => {
            if (err) {
                console.error('Error checking voucher_online_settings table:', err);
                resolve({}); // Return empty object if error
                return;
            }

            if (row) {
                // Table exists, get data
                billingManager.db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                    if (err) {
                        console.error('Error getting voucher online settings:', err);
                        resolve({});
                        return;
                    }

                    const settings = {};
                    rows.forEach(row => {
                        settings[row.package_id] = {
                            name: row.name || `${row.package_id} - Package`,
                            profile: row.profile,
                            digits: row.digits || 5,
                            price: row.price || 0,
                            duration: row.duration || 24,
                            duration_type: row.duration_type || 'hours',
                            enabled: row.enabled === 1
                        };
                    });

                    resolve(settings);
                });
            } else {
                // Table not yet exists, create default settings
                console.log('voucher_online_settings table not found, using default settings');
                resolve({
                    '3k': { profile: '3k', enabled: true, price: 3000, duration: 24, duration_type: 'hours' },
                    '5k': { profile: '5k', enabled: true, price: 5000, duration: 48, duration_type: 'hours' },
                    '10k': { profile: '10k', enabled: true, price: 10000, duration: 120, duration_type: 'hours' },
                    '15k': { profile: '15k', enabled: true, price: 15000, duration: 192, duration_type: 'hours' },
                    '25k': { profile: '25k', enabled: true, price: 25000, duration: 360, duration_type: 'hours' },
                    '50k': { profile: '50k', enabled: true, price: 50000, duration: 720, duration_type: 'hours' }
                });
            }
        });
    });
}

// Test route
router.get('/test', (req, res) => {
    res.json({ success: true, message: 'Voucher router works!' });
});

// GET: API for payment methods (same as invoice)
router.get('/api/payment-methods', async (req, res) => {
    try {
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();

        const methods = await paymentGateway.getAvailablePaymentMethods();

        res.json({
            success: true,
            methods: methods
        });
    } catch (error) {
        console.error('Error getting payment methods:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting payment methods',
            error: error.message
        });
    }
});

// GET: Public voucher page
router.get('/', async (req, res) => {
    try {
        // Get hotspot profiles
        const profilesResult = await getHotspotProfiles();
        let profiles = [];
        if (profilesResult.success && Array.isArray(profilesResult.data)) {
            profiles = profilesResult.data;
        }

        // Get settings
        const settings = getSettingsWithCache();

        // Get online voucher settings from database
        const voucherSettings = await getVoucherOnlineSettings();

        // Get voucher packages from voucher_pricing database
        const voucherPackagesFromDB = await new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM voucher_pricing WHERE is_active = 1 ORDER BY customer_price ASC';
            billingManager.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });


        // Format package from database or use data from voucher_online_settings if not available
        let allPackages;
        if (Object.keys(voucherSettings).length > 0) {
            // Use data from voucher_online_settings (main priority)
            allPackages = Object.keys(voucherSettings).map(packageId => {
                const setting = voucherSettings[packageId];
                // Format package name based on name stored in database
                const packageName = setting.name || `${packageId} - Package`;
                // Format duration using data from database
                const durationText = getDurationText(packageId, setting.duration, setting.duration_type);

                return {
                    id: packageId,
                    name: packageName,
                    duration: durationText,
                    duration_value: setting.duration || 24,
                    duration_type: setting.duration_type || 'hours',
                    price: setting.price || 0,
                    profile: setting.profile || 'default',
                    description: packageName,
                    color: getPriceColor(setting.price || 0),
                    enabled: setting.enabled !== false
                };
            });
        } else if (voucherPackagesFromDB.length > 0) {
            // Fallback to data from voucher_pricing if voucher_online_settings is empty
            allPackages = voucherPackagesFromDB.map(pkg => {
                // Format duration using data from database
                const durationText = getDurationText(pkg.package_id || `pkg-${pkg.id}`, pkg.duration, pkg.duration_type);

                // Format price
                const price = pkg.customer_price;

                // Format package name
                const packageName = pkg.package_name;

                return {
                    id: `pkg-${pkg.id}`,
                    name: packageName,
                    duration: durationText,
                    duration_value: pkg.duration || 24,
                    duration_type: pkg.duration_type || 'hours',
                    price: price,
                    profile: pkg.hotspot_profile || 'default',
                    description: pkg.description || `Voucher ${packageName}`,
                    color: getPriceColor(price),
                    enabled: true
                };
            });
        } else {
            // Fallback to hardcoded data if both tables are empty
            allPackages = [
                {
                    id: '3k',
                    name: '3k - 1 Day',
                    duration: getDurationText('3k'),
                    duration_value: 24,
                    duration_type: 'hours',
                    price: 3000,
                    profile: voucherSettings['3k']?.profile || '3k',
                    description: 'WiFi Access 1 full day',
                    color: 'primary',
                    enabled: voucherSettings['3k']?.enabled !== false
                },
                {
                    id: '5k',
                    name: '5k - 2 Days',
                    duration: getDurationText('5k'),
                    duration_value: 48,
                    duration_type: 'hours',
                    price: 5000,
                    profile: voucherSettings['5k']?.profile || '5k',
                    description: 'WiFi Access 2 full days',
                    color: 'success',
                    enabled: voucherSettings['5k']?.enabled !== false
                },
                {
                    id: '10k',
                    name: '10k - 5 Days',
                    duration: getDurationText('10k'),
                    duration_value: 120,
                    duration_type: 'hours',
                    price: 10000,
                    profile: voucherSettings['10k']?.profile || '10k',
                    description: 'WiFi Access 5 full days',
                    color: 'info',
                    enabled: voucherSettings['10k']?.enabled !== false
                },
                {
                    id: '15k',
                    name: '15k - 8 Days',
                    duration: getDurationText('15k'),
                    duration_value: 192,
                    duration_type: 'hours',
                    price: 15000,
                    profile: voucherSettings['15k']?.profile || '15k',
                    description: 'WiFi Access 8 full days',
                    color: 'warning',
                    enabled: voucherSettings['15k']?.enabled !== false
                },
                {
                    id: '25k',
                    name: '25k - 15 Days',
                    duration: getDurationText('25k'),
                    duration_value: 360,
                    duration_type: 'hours',
                    price: 25000,
                    profile: voucherSettings['25k']?.profile || '25k',
                    description: 'WiFi Access 15 full days',
                    color: 'danger',
                    enabled: voucherSettings['25k']?.enabled !== false
                },
                {
                    id: '50k',
                    name: '50k - 30 Days',
                    duration: getDurationText('50k'),
                    duration_value: 720,
                    duration_type: 'hours',
                    price: 50000,
                    profile: voucherSettings['50k']?.profile || '50k',
                    description: 'WiFi Access 30 full days',
                    color: 'secondary',
                    enabled: voucherSettings['50k']?.enabled !== false
                }
            ];
        }

        // Sort packages by price from smallest to largest
        allPackages.sort((a, b) => a.price - b.price);

        // Filter only enabled packages
        const voucherPackages = allPackages.filter(pkg => pkg.enabled);

        res.render('publicVoucher', {
            title: 'Buy Hotspot Voucher',
            voucherPackages,
            profiles,
            settings,
            error: req.query.error,
            success: req.query.success,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        console.error('Error rendering public voucher page:', error);
        res.render('publicVoucher', {
            title: 'Buy Hotspot Voucher',
            voucherPackages: [],
            profiles: [],
            settings: {},
            error: 'Failed to load voucher page: ' + error.message,
            success: null,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// POST: Process voucher purchase
router.post('/purchase', async (req, res) => {
    try {
        const { packageId, customerPhone, customerName, quantity = 1, gateway = 'tripay', method = 'BRIVA' } = req.body;

        if (!packageId || !customerPhone || !customerName) {
            return res.status(400).json({
                success: false,
                message: 'Incomplete data'
            });
        }

        // Get online voucher settings from database
        const voucherSettings = await getVoucherOnlineSettings();

        // Get voucher packages from voucher_pricing database
        const voucherPackagesFromDB = await new Promise((resolve, reject) => {
            const sql = 'SELECT * FROM voucher_pricing WHERE is_active = 1 ORDER BY customer_price ASC';
            billingManager.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Format package from database or use data from voucher_online_settings if not available
        let allPackages;
        if (Object.keys(voucherSettings).length > 0) {
            // Use data from voucher_online_settings (main priority)
            allPackages = Object.keys(voucherSettings).map(packageId => {
                const setting = voucherSettings[packageId];
                // Format package name based on name stored in database
                const packageName = setting.name || `${packageId} - Package`;
                // Format duration using data from database
                const durationText = getDurationText(packageId, setting.duration, setting.duration_type);

                return {
                    id: packageId,
                    name: packageName,
                    duration: durationText,
                    price: setting.price || 0,
                    profile: setting.profile || 'default',
                    description: packageName,
                    color: getPriceColor(setting.price || 0),
                    enabled: setting.enabled !== false
                };
            });
        } else if (voucherPackagesFromDB.length > 0) {
            // Fallback to data from voucher_pricing if voucher_online_settings is empty
            allPackages = voucherPackagesFromDB.map(pkg => {
                // Format duration using data from database
                const durationText = getDurationText(pkg.package_id || `pkg-${pkg.id}`, pkg.duration, pkg.duration_type);

                // Format price
                const price = pkg.customer_price;

                // Format package name
                const packageName = pkg.package_name;

                return {
                    id: `pkg-${pkg.id}`,
                    name: packageName,
                    duration: durationText,
                    price: price,
                    profile: pkg.hotspot_profile || 'default',
                    description: pkg.description || `Voucher ${packageName}`,
                    color: getPriceColor(price),
                    enabled: true
                };
            });
        } else {
            // Fallback to hardcoded data if both tables are empty
            allPackages = [
                {
                    id: '3k',
                    name: '3k - 1 Day',
                    duration: getDurationText('3k'),
                    price: 3000,
                    profile: voucherSettings['3k']?.profile || '3k',
                    description: 'WiFi Access 1 full day',
                    color: 'primary',
                    enabled: voucherSettings['3k']?.enabled !== false
                },
                {
                    id: '5k',
                    name: '5k - 2 Days',
                    duration: getDurationText('5k'),
                    price: 5000,
                    profile: voucherSettings['5k']?.profile || '5k',
                    description: 'WiFi Access 2 full days',
                    color: 'success',
                    enabled: voucherSettings['5k']?.enabled !== false
                },
                {
                    id: '10k',
                    name: '10k - 5 Days',
                    duration: getDurationText('10k'),
                    price: 10000,
                    profile: voucherSettings['10k']?.profile || '10k',
                    description: 'WiFi Access 5 full days',
                    color: 'info',
                    enabled: voucherSettings['10k']?.enabled !== false
                },
                {
                    id: '15k',
                    name: '15k - 8 Days',
                    duration: getDurationText('15k'),
                    price: 15000,
                    profile: voucherSettings['15k']?.profile || '15k',
                    description: 'WiFi Access 8 full days',
                    color: 'warning',
                    enabled: voucherSettings['15k']?.enabled !== false
                },
                {
                    id: '25k',
                    name: '25k - 15 Days',
                    duration: getDurationText('25k'),
                    price: 25000,
                    profile: voucherSettings['25k']?.profile || '25k',
                    description: 'WiFi Access 15 full days',
                    color: 'danger',
                    enabled: voucherSettings['25k']?.enabled !== false
                },
                {
                    id: '50k',
                    name: '50k - 30 Days',
                    duration: getDurationText('50k'),
                    price: 50000,
                    profile: voucherSettings['50k']?.profile || '50k',
                    description: 'WiFi Access 30 full days',
                    color: 'secondary',
                    enabled: voucherSettings['50k']?.enabled !== false
                }
            ];
        }

        // Sort packages by price from smallest to largest
        allPackages.sort((a, b) => a.price - b.price);

        // Filter only enabled packages
        const voucherPackages = allPackages.filter(pkg => pkg.enabled);
        // Find package by ID (can be database ID or hardcoded ID)
        let selectedPackage = voucherPackages.find(pkg => pkg.id === packageId);

        // If not found, try searching with database ID (format: pkg-1, pkg-2, dll)
        if (!selectedPackage) {
            selectedPackage = voucherPackages.find(pkg => pkg.id === `pkg-${packageId}`);
        }

        // If still not found, fallback to search by package name
        if (!selectedPackage) {
            selectedPackage = voucherPackages.find(pkg =>
                pkg.name.toLowerCase().includes(packageId.toLowerCase()) ||
                pkg.name.toLowerCase().includes(packageId.replace('k', 'K').toLowerCase())
            );
        }

        if (!selectedPackage) {
            return res.status(400).json({
                success: false,
                message: 'Package voucher not found'
            });
        }

        // For backward compatibility, ensure packageId is in correct format
        const actualPackageId = selectedPackage.id.startsWith('pkg-')
            ? selectedPackage.id.replace('pkg-', '')
            : selectedPackage.id;

        const totalAmount = selectedPackage.price * parseInt(quantity);

        // 1. Save purchase data without generating voucher first
        // Voucher will be generated after payment success to avoid wasted vouchers
        console.log('Saving voucher purchase for package:', packageId, 'quantity:', quantity);

        // 2. Save voucher data to voucher_purchases table (without voucher_data first)
        const voucherDataString = JSON.stringify([]); // Empty for now, will be filled after payment success
        console.log('Voucher purchase data to save (vouchers will be generated after payment success)');

        const voucherPurchase = await saveVoucherPurchase({
            invoiceId: null, // will be updated after invoice is created
            customerName: customerName,
            customerPhone: customerPhone,
            amount: totalAmount,
            description: `Voucher Hotspot ${selectedPackage.name} x${quantity}`,
            packageId: actualPackageId,
            quantity: parseInt(quantity),
            profile: selectedPackage.profile,
            voucherData: voucherDataString, // Save generated voucher
            status: 'pending'
        });

        console.log('Saved voucher purchase with ID:', voucherPurchase.id);
        console.log('Voucher purchase saved, vouchers will be generated after payment success');

        try {
            // 3. Create invoice using billingManager for consistency
            const invoiceNumber = `INV-VCR-${Date.now()}-${voucherPurchase.id}`;
            const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            const voucherCustomerId = await getVoucherCustomerId();

            // Use a valid package ID from packages table if possible, otherwise use 1 as placeholder
            // This is to avoid FOREIGN KEY constraint failure in invoices table
            const finalPackageId = !isNaN(actualPackageId) ? parseInt(actualPackageId) : 1;

            // Create invoice using billingManager method
            const invoiceResult = await billingManager.createInvoice({
                customer_id: voucherCustomerId,
                invoice_number: invoiceNumber,
                amount: totalAmount,
                due_date: dueDate,
                notes: `Voucher Hotspot ${selectedPackage.name} x${quantity}`,
                package_id: finalPackageId,
                package_name: selectedPackage.name,
                invoice_type: 'voucher',
                status: 'pending'
            });

            const invoiceDbId = invoiceResult.id;

            // Update voucher purchase with invoice_number (string) to sync with invoice
            await new Promise((resolve, reject) => {
                billingManager.db.run('UPDATE voucher_purchases SET invoice_id = ? WHERE id = ?', [invoiceNumber, voucherPurchase.id], function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('Invoice created successfully:', invoiceNumber, 'DB ID:', invoiceDbId);

            // 4. Create payment gateway transaction using Tripay
            console.log('Creating payment for invoice DB ID:', invoiceDbId);

            // Use the same method as monthly invoice, but with paymentType voucher
            // Override phone number with consumer input to match e-wallet account (DANA, etc)
            const paymentResult = await billingManager.createOnlinePaymentWithMethod(
                invoiceDbId,
                gateway,
                method,
                'voucher',
                customerPhone
            );
            console.log('Payment result:', paymentResult);

            if (!paymentResult || !paymentResult.payment_url) {
                throw new Error('Failed to create payment URL');
            }

            res.json({
                success: true,
                message: 'Purchase voucher successfully created',
                data: {
                    purchaseId: voucherPurchase.id,
                    invoiceId: invoiceNumber,
                    paymentUrl: paymentResult.payment_url,
                    amount: totalAmount,
                    package: selectedPackage,
                    note: 'Voucher will be generated after successful payment'
                }
            });
        } catch (paymentError) {
            console.error('Payment creation error:', paymentError);
            // If payment failed, update voucher status to failed
            try {
                await new Promise((resolve, reject) => {
                    billingManager.db.run('UPDATE voucher_purchases SET status = ? WHERE id = ?', ['failed', voucherPurchase.id], function (err) {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } catch (updateError) {
                console.error('Failed to update voucher status:', updateError);
            }

            throw paymentError;
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to process voucher purchase: ' + error.message
        });
    }
});

// GET: Page sukses pembelian voucher
router.get('/success/:purchaseId', async (req, res) => {
    try {
        const { purchaseId } = req.params;

        const purchase = await new Promise((resolve, reject) => {
            billingManager.db.get('SELECT * FROM voucher_purchases WHERE id = ?', [purchaseId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!purchase) {
            return res.render('voucherError', {
                title: 'Voucher Not Found',
                error: 'Voucher not found',
                message: 'Purchase ID invalid or voucher has expired',
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        let vouchers = [];
        if (purchase.voucher_data) {
            try {
                vouchers = JSON.parse(purchase.voucher_data);
            } catch (e) {
                console.error('Error parsing voucher data:', e);
            }
        }

        // Don't close billingManager.db as it's a singleton

        // Get settings for additional information
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['admins.0'] || '-';

        // Format data for template
        const voucherData = {
            purchaseId: purchase.id,
            packageName: purchase.description || 'Voucher WiFi',
            duration: getPackageDuration(purchase.voucher_package),
            price: purchase.amount,
            vouchers: vouchers,
            customerName: purchase.customer_name,
            customerPhone: purchase.customer_phone,
            status: purchase.status
        };

        res.render('voucherSuccess', {
            title: 'Voucher Successfully Purchased',
            purchase,
            vouchers,
            voucherData,
            success: true,
            company_header,
            adminContact,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        console.error('Error rendering voucher success page:', error);

        // Get settings for error page too
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';

        res.render('voucherError', {
            title: 'Error',
            error: 'Failed to load voucher page',
            message: error.message,
            company_header,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// GET: Page hasil pembayaran dari payment gateway
router.get('/finish', async (req, res) => {
    try {
        const { order_id, transaction_status } = req.query;

        if (!order_id) {
            const settings = getSettingsWithCache();
            const company_header = settings.company_header || 'Voucher Hotspot';

            return res.render('voucherError', {
                title: 'Error',
                error: 'Order ID not found',
                message: 'Parameter order_id not found dalam URL',
                company_header,
                settings,
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        const purchase = await new Promise((resolve, reject) => {
            billingManager.db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [order_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!purchase) {
            const settings = getSettingsWithCache();
            const company_header = settings.company_header || 'Voucher Hotspot';

            return res.render('voucherError', {
                title: 'Voucher Not Found',
                error: 'Voucher not found',
                message: 'Purchase with that order ID not found',
                company_header,
                settings,
                versionInfo: getVersionInfo(),
                versionBadge: getVersionBadge()
            });
        }

        let vouchers = [];
        if (purchase.voucher_data) {
            try {
                vouchers = JSON.parse(purchase.voucher_data);
            } catch (e) {
                console.error('Error parsing voucher data:', e);
            }
        }

        // Don't close billingManager.db as it's a singleton

        // Determine status based on transaction_status
        let status = 'pending';
        if (transaction_status === 'settlement' || transaction_status === 'capture') {
            status = 'success';
        } else if (transaction_status === 'expire' || transaction_status === 'cancel') {
            status = 'failed';
        }

        // Get settings for additional information
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['admins.0'] || '-';

        res.render('voucherFinish', {
            title: 'Payment Voucher Result',
            purchase,
            vouchers,
            status,
            transaction_status,
            order_id,
            company_header,
            adminContact,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        console.error('Error rendering voucher finish page:', error);

        // Get settings for error page too
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';

        res.render('voucherError', {
            title: 'Error',
            error: 'Failed to load payment result page',
            message: error.message,
            company_header,
            settings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// Helper function to get package duration
function getPackageDuration(packageId) {
    const durations = {
        '3k': '1 day',
        '5k': '2 days',
        '10k': '5 days',
        '15k': '8 days',
        '25k': '15 days',
        '50k': '30 days'
    };
    return durations[packageId] || 'Unknown';
}

// Helper function to get duration text based on package ID
function getDurationText(packageId) {
    const durations = {
        '3k': '1 Day',
        '5k': '2 Day',
        '10k': '5 Day',
        '15k': '8 Day',
        '25k': '15 Day',
        '50k': '30 Day'
    };
    return durations[packageId] || '1 Day';
}

// Improve getDurationText function to use more dynamic data
function getDurationText(packageId, duration, durationType) {
    // If duration and durationType are available, use that
    if (duration !== undefined && durationType !== undefined) {
        if (durationType === 'days') {
            return `${duration} Day`;
        } else if (durationType === 'hours') {
            // Convert hours to days if possible
            if (duration === 24) return '1 Day';
            if (duration === 48) return '2 Day';
            if (duration === 72) return '3 Day';
            if (duration === 96) return '4 Day';
            if (duration === 120) return '5 Day';
            if (duration === 144) return '6 Day';
            if (duration === 168) return '7 Day';
            if (duration === 192) return '8 Day';
            if (duration === 240) return '10 Day';
            if (duration === 360) return '15 Day';
            if (duration === 720) return '30 Day';
            return `${duration} Hours`;
        }
    }

    // Fallback to static mapping if no duration data
    const defaultDurations = {
        '3k': '1 Day',
        '5k': '2 Day',
        '10k': '5 Day',
        '15k': '8 Day',
        '25k': '15 Day',
        '50k': '30 Day'
    };
    return defaultDurations[packageId] || '1 Day';
}

// Helper function to format voucher WhatsApp message
function formatVoucherMessage(vouchers, purchase, settings) {
    let message = `🛒 *${settings.company_header || 'VOUCHER HOTSPOT'} SUCCESSFULLY PURCHASED*\n\n`;
    message += `👤 Name: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rs ${purchase.amount.toLocaleString('en-PK')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profile: ${voucher.profile}\n\n`;
    });

    message += `🌐 *HOW TO USE:*\n`;
    message += `1. Connect to WiFi hotspot\n`;
    message += `2. Open browser and login to hotspot\n`;
    message += `3. Enter Username & Password above\n`;
    message += `4. Click Login\n\n`;

    message += `⏰ *ACTIVE PERIOD:* According to selected package\n\n`;
    message += `📞 *HELP:* Contact ${settings.contact_phone || settings['admins.0'] || 'admin'} if you have any issues\n\n`;
    message += `Thank you for using ${settings.company_header || 'our'} services! 🚀`;

    return message;
}

// Helper function to format voucher message with success page link
function formatVoucherMessageWithSuccessPage(vouchers, purchase, successUrl, settings) {
    let message = `🛒 *${settings.company_header || 'VOUCHER HOTSPOT'} SUCCESSFULLY PURCHASED*\n\n`;
    message += `👤 Name: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rs ${purchase.amount.toLocaleString('en-PK')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profile: ${voucher.profile}\n\n`;
    });

    message += `🌐 *VIEW FULL DETAILS:*\n`;
    message += `${successUrl}\n\n`;

    message += `🌐 *HOW TO USE:*\n`;
    message += `1. Connect to WiFi hotspot\n`;
    message += `2. Open browser and login to hotspot\n`;
    message += `3. Enter Username & Password above\n`;
    message += `4. Click Login\n\n`;

    message += `⏰ *ACTIVE PERIOD:* According to selected package\n\n`;
    message += `📞 *HELP:* Contact ${settings.contact_phone || settings['admins.0'] || 'admin'} if you have any issues\n\n`;
    message += `Thank you for using ${settings.company_header || 'our'} services! 🚀`;

    return message;
}

// Function to handle voucher webhook (can be called from universal webhook)
async function handleVoucherWebhook(body, headers) {
    try {
        console.log('Received voucher payment webhook:', body);

        // Use PaymentGatewayManager for consistency
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();

        // Determine gateway based on payload
        let gateway = 'tripay'; // Default to tripay
        if (body.transaction_status) {
            gateway = 'midtrans';
        } else if (body.merchantCode && body.merchantOrderId && body.resultCode !== undefined) {
            gateway = 'duitku';
        } else if (body.status === 'PAID' || body.status === 'EXPIRED' || body.status === 'FAILED') {
            gateway = 'tripay';
        } else if (body.status === 'settled' || body.status === 'expired' || body.status === 'failed') {
            gateway = 'xendit';
        }

        console.log(`Processing webhook with gateway: ${gateway}`);

        // Process webhook using PaymentGatewayManager
        let webhookResult;
        try {
            webhookResult = await paymentGateway.handleWebhook({ body, headers }, gateway);
            console.log('Webhook result:', webhookResult);
        } catch (webhookError) {
            console.log('Webhook signature validation failed, processing manually:', webhookError.message);

            // Fallback: manual process for voucher payment
            webhookResult = {
                order_id: body.order_id || body.merchant_ref || body.external_id || body.merchantOrderId,
                status: body.status || body.transaction_status || body.resultCode,
                amount: body.amount || body.gross_amount || body.paymentAmount,
                payment_type: body.payment_type || body.payment_method || body.paymentCode
            };

            // Normalize status
            if (webhookResult.status === 'PAID' || webhookResult.status === 'settlement' || webhookResult.status === 'capture') {
                webhookResult.status = 'success';
            } else if (webhookResult.status === '00') {
                webhookResult.status = 'success';
            } else if (webhookResult.status === '01' || webhookResult.status === '02') {
                webhookResult.status = 'failed';
            }
        }

        const { order_id, status, amount, payment_type } = webhookResult;

        if (!order_id) {
            console.log('No order_id found in webhook payload');
            return {
                success: false,
                message: 'Order ID not found in webhook payload'
            };
        }

        // Search purchase by order_id
        const db = billingManager.db;

        let purchase;
        try {
            // Try to search by order_id directly First (EXACT MATCH)
            // This is because we save invoice_id as full invoice number (e.g., INV-VCR-...)
            purchase = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [order_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            // If not found, try searching by removing INV- prefix (Legacy case)
            if (!purchase) {
                const invoiceIdFallback = order_id.replace('INV-', '');
                purchase = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [invoiceIdFallback], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
            }
        } catch (error) {
            console.error('Error finding purchase:', error);
        }

        if (!purchase) {
            console.log(`Purchase with order_id ${order_id} not found in database`);
            return {
                success: false,
                message: 'Voucher not found',
                details: `Purchase with order_id ${order_id} not found. May have expired or order_id is invalid.`,
                suggestions: [
                    'Please check the correct payment link',
                    'Ensure payment is made within the specified time',
                    'Contact admin if you encounter difficulties'
                ]
            };
        }

        // Check payment status using already normalized status
        if (status === 'success' || status === 'settlement' || status === 'capture') {
            console.log('Payment successful for purchase ID:', purchase.id);

            // Generate voucher AFTER payment success to avoid wasted vouchers
            let generatedVouchers = [];
            try {
                console.log('Generating vouchers after payment success...');
                generatedVouchers = await generateHotspotVouchersWithRetry({
                    profile: purchase.voucher_profile,
                    count: purchase.voucher_quantity,
                    packageId: purchase.voucher_package,
                    customerName: purchase.customer_name,
                    customerPhone: purchase.customer_phone
                });

                if (generatedVouchers && generatedVouchers.length > 0) {
                    console.log('Vouchers generated successfully:', generatedVouchers.length);
                } else {
                    console.log('No vouchers generated');
                }
            } catch (voucherError) {
                console.error('Error generating vouchers:', voucherError);
                // Log error but don't fail webhook
            }

            // Update status purchase menjadi completed
            await new Promise((resolve, reject) => {
                const updateSql = `UPDATE voucher_purchases 
                                 SET status = 'completed', 
                                     voucher_data = ?, 
                                     updated_at = datetime('now')
                                 WHERE id = ?`;
                db.run(updateSql, [JSON.stringify(generatedVouchers), purchase.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Update status invoice menjadi paid
            try {
                console.log('Updating invoice status to paid for invoice_id:', purchase.invoice_id);
                await billingManager.updateInvoiceStatus(purchase.invoice_id, 'paid', gateway);
                console.log('Invoice status updated successfully');
            } catch (invoiceError) {
                console.error('Error updating invoice status:', invoiceError);
                // Log error but don't fail webhook
            }

            // Kirim voucher via WhatsApp jika ada nomor HP
            if (purchase.customer_phone) {
                try {
                    const { sendMessage } = require('../config/sendMessage');
                    const { getSettingsWithCache } = require('../config/settingsManager');
                    const settings = getSettingsWithCache();

                    // Use settings to create consistent URL
                    const baseUrl = settings.server_host || 'localhost';
                    const port = settings.server_port || '3003';
                    const protocol = baseUrl.includes('localhost') || baseUrl.match(/^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./) ? 'http' : 'https';
                    const successUrl = `${protocol}://${baseUrl}:${port}/voucher/success/${purchase.id}`;

                    const voucherText = formatVoucherMessageWithSuccessPage(generatedVouchers, purchase, successUrl, settings);
                    const deliveryResult = await sendVoucherWithRetry(purchase.customer_phone, voucherText);

                    // Log delivery result
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, deliveryResult.success, deliveryResult.message);

                    if (deliveryResult.success) {
                        console.log('Voucher sent successfully via WhatsApp');
                    } else {
                        console.log('Failed to send voucher via WhatsApp:', deliveryResult.message);
                    }
                } catch (whatsappError) {
                    console.error('Error sending voucher via WhatsApp:', whatsappError);
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, false, whatsappError.message);
                }
            }

            // Don't close billingManager.db as it's a singleton
            return {
                success: true,
                message: 'Voucher successfully created and sent',
                purchase_id: purchase.id,
                vouchers_generated: generatedVouchers.length,
                whatsapp_sent: purchase.customer_phone ? true : false
            };

        } else if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            console.log('Payment failed/expired for purchase ID:', purchase.id);

            // Update status menjadi failed
            await new Promise((resolve, reject) => {
                db.run('UPDATE voucher_purchases SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
                    [status, purchase.id], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
            });

            // Don't close billingManager.db as it's a singleton
            return {
                success: false,
                message: `Payment ${status}`,
                purchase_id: purchase.id
            };

        } else {
            console.log('Payment status unknown:', status);
            // Don't close billingManager.db as it's a singleton
            return {
                success: false,
                message: 'Payment status not recognized',
                status: status,
                purchase_id: purchase.id
            };
        }

    } catch (error) {
        console.error('Voucher webhook error:', error);
        return {
            success: false,
            message: 'Error processing voucher webhook: ' + error.message
        };
    }
}

// Webhook handler for voucher payment success
router.post('/payment-webhook', async (req, res) => {
    try {
        const result = await handleVoucherWebhook(req.body, req.headers);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        console.error('Voucher webhook route error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
});

// Helper functions that are required
async function generateHotspotVouchersWithRetry(purchaseData, maxRetries = 3) {
    const { generateHotspotVouchers } = require('../config/mikrotik');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt} to generate vouchers for purchase:`, purchaseData);

            // Generate user-friendly voucher format
            const timestamp = Date.now().toString().slice(-6); // Ambil 6 digit terakhir timestamp
            const prefix = `V${timestamp}`; // Format: V123456

            const result = await generateHotspotVouchers(
                purchaseData.count || 1,
                prefix,
                purchaseData.profile || 'default',
                'all',
                '',
                '',
                'alphanumeric'
            );

            if (result.success && result.vouchers && result.vouchers.length > 0) {
                console.log(`Successfully generated ${result.vouchers.length} vouchers on attempt ${attempt}`);
                return result.vouchers;
            } else {
                console.log(`Attempt ${attempt} failed:`, result.message);
                if (attempt === maxRetries) {
                    throw new Error(`Failed to generate vouchers after ${maxRetries} attempts: ${result.message}`);
                }
            }
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
            if (attempt === maxRetries) {
                throw error;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function generateHotspotVouchers(count, prefix, profile, comment, limitUptime, limitBytes, passwordType) {
    const { generateHotspotVouchers } = require('../config/mikrotik');
    return await generateHotspotVouchers(count, prefix, profile, comment, limitUptime, limitBytes, passwordType);
}

async function sendVoucherWithRetry(phone, message, maxRetries = 3) {
    const { sendMessage } = require('../config/sendMessage');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt} to send voucher to ${phone}`);
            const result = await sendMessage(phone, message);

            // sendMessage mengembalikan true/false, bukan object
            if (result === true) {
                console.log(`Successfully sent voucher to ${phone} on attempt ${attempt}`);
                return { success: true, message: 'Voucher sent successfully' };
            } else {
                console.log(`Attempt ${attempt} failed: WhatsApp sendMessage returned false`);
                if (attempt === maxRetries) {
                    return { success: false, message: `Failed to send voucher after ${maxRetries} attempts: WhatsApp connection issue` };
                }
            }
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
            if (attempt === maxRetries) {
                return { success: false, message: `Failed to send voucher after ${maxRetries} attempts: ${error.message}` };
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

async function logVoucherDelivery(purchaseId, phone, success, message) {
    return new Promise((resolve, reject) => {
        // Tentukan status berdasarkan success flag
        const status = success ? 'sent' : 'failed';

        billingManager.db.run(`
            INSERT INTO voucher_delivery_logs (purchase_id, phone, status, error_message, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `, [purchaseId, phone, status, message], (err) => {
            if (err) {
                console.error('Error logging voucher delivery:', err);
                reject(err);
            } else {
                console.log(`Voucher delivery logged: ${phone} - ${status}`);
                resolve();
            }
        });
    });
}

async function saveVoucherPurchase(purchaseData) {
    return new Promise((resolve, reject) => {
        billingManager.db.run(`
            INSERT INTO voucher_purchases (invoice_id, customer_name, customer_phone, voucher_package, 
                                         voucher_profile, voucher_quantity, amount, description, 
                                         voucher_data, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [
            purchaseData.invoiceId,
            purchaseData.customerName,
            purchaseData.customerPhone,
            purchaseData.packageId,
            purchaseData.profile,
            purchaseData.quantity,
            purchaseData.amount,
            purchaseData.description,
            purchaseData.voucherData,
            purchaseData.status || 'pending'
        ], function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID });
        });
    });
}

async function cleanupFailedVoucher(purchaseId) {
    return new Promise((resolve, reject) => {
        billingManager.db.run('DELETE FROM voucher_purchases WHERE id = ?', [purchaseId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Export functions for testing
module.exports = {
    router,
    handleVoucherWebhook,
    generateHotspotVouchersWithRetry,
    generateHotspotVouchers,
    sendVoucherWithRetry,
    logVoucherDelivery,
    saveVoucherPurchase,
    cleanupFailedVoucher
};
