const billingManager = require('./billing');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');
const serviceSuspension = require('./serviceSuspension');

class BillingCommands {
    constructor() {
        this.sock = null;
    }

    setSock(sockInstance) {
        this.sock = sockInstance;
    }

    async sendFormattedMessage(remoteJid, message) {
        if (!this.sock) {
            logger.error('WhatsApp sock not initialized');
            return false;
        }

        try {
            const formattedMessage = this.formatWithHeaderFooter(message);
            await this.sock.sendMessage(remoteJid, { text: formattedMessage });
            return true;
        } catch (error) {
            logger.error('Error sending formatted message:', error);
            return false;
        }
    }

    // Suspend customer service via WA admin
    async handleIsolir(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid,
                    '❌ *WRONG FORMAT!*\n\n' +
                    'Format: isolir [customer_number/name] [optional_reason]\n' +
                    'Examples:\n' +
                    '• isolir 081234567890 Late payment\n' +
                    '• isolir "Santo" Late 2 months'
                );
                return;
            }

            const searchTerm = params[0];
            const reason = params.slice(1).join(' ') || 'Late payment (manual WA)';

            // Search customer by phone or name (supports names with spaces if parser has combined them)
            let customer = await billingManager.getCustomerByNameOrPhone(searchTerm);
            if (!customer) {
                // Try to find multiple candidates
                const candidates = await billingManager.findCustomersByNameOrPhone(params.join(' '));
                if (candidates.length === 0) {
                    await this.sendFormattedMessage(remoteJid,
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Search: "${params.join(' ')}"`
                    );
                    return;
                }
                if (candidates.length > 1) {
                    let message = `🔍 *FOUND ${candidates.length} CUSTOMERS*\n\n`;
                    candidates.forEach((c, i) => {
                        message += `${i + 1}. *${c.name}*\n`;
                        message += `   📱 ${c.phone}\n`;
                        message += `   👤 ${c.username}\n`;
                        message += `   Use: \`suspend ${c.phone} [reason]\`\n\n`;
                    });
                    await this.sendFormattedMessage(remoteJid, message);
                    return;
                }
                customer = candidates[0];
            }

            // Execute isolation
            const result = await serviceSuspension.suspendCustomerService(customer, reason);
            if (result && result.success) {
                await this.sendFormattedMessage(remoteJid,
                    '⛔ *SUSPEND SUCCESSFUL*\n\n' +
                    `*Customer:* ${customer.name}\n` +
                    `*Number:* ${customer.phone}\n` +
                    `*Username:* ${customer.username}\n` +
                    `*Reason:* ${reason}\n` +
                    `*Status:* Suspended`
                );
            } else {
                await this.sendFormattedMessage(remoteJid,
                    '❌ *SUSPEND FAILED!*\n\n' +
                    `Error: ${(result && result.error) || 'Unknown error'}`
                );
            }
        } catch (error) {
            logger.error('Error in handleIsolir:', error);
            await this.sendFormattedMessage(remoteJid,
                '❌ *SYSTEM ERROR!*\n\n' +
                (error.message || 'Error occurred while suspending customer.')
            );
        }
    }

    // Restore customer service via WA admin
    async handleBuka(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid,
                    '❌ *WRONG FORMAT!*\n\n' +
                    'Format: open [customer_number/name] [optional_reason]\n' +
                    'Examples:\n' +
                    '• open 081234567890 Already paid\n' +
                    '• open "Santo" Payment confirmed'
                );
                return;
            }

            const searchTerm = params[0];
            const reason = params.slice(1).join(' ') || 'Restore service (manual WA)';

            let customer = await billingManager.getCustomerByNameOrPhone(searchTerm);
            if (!customer) {
                const candidates = await billingManager.findCustomersByNameOrPhone(params.join(' '));
                if (candidates.length === 0) {
                    await this.sendFormattedMessage(remoteJid,
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Search: "${params.join(' ')}"`
                    );
                    return;
                }
                if (candidates.length > 1) {
                    let message = `🔍 *FOUND ${candidates.length} CUSTOMERS*\n\n`;
                    candidates.forEach((c, i) => {
                        message += `${i + 1}. *${c.name}*\n`;
                        message += `   📱 ${c.phone}\n`;
                        message += `   👤 ${c.username}\n`;
                        message += `   Use: \`open ${c.phone} [reason]\`\n\n`;
                    });
                    await this.sendFormattedMessage(remoteJid, message);
                    return;
                }
                customer = candidates[0];
            }

            const result = await serviceSuspension.restoreCustomerService(customer, reason);
            if (result && result.success) {
                await this.sendFormattedMessage(remoteJid,
                    '🔓 *RESTORE SUCCESSFUL*\n\n' +
                    `*Customer:* ${customer.name}\n` +
                    `*Number:* ${customer.phone}\n` +
                    `*Username:* ${customer.username}\n` +
                    `*Reason:* ${reason}\n` +
                    `*Status:* Active`
                );
            } else {
                await this.sendFormattedMessage(remoteJid,
                    '❌ *RESTORE FAILED!*\n\n' +
                    `Error: ${(result && result.error) || 'Unknown error'}`
                );
            }
        } catch (error) {
            logger.error('Error in handleBuka:', error);
            await this.sendFormattedMessage(remoteJid,
                '❌ *SYSTEM ERROR!*\n\n' +
                (error.message || 'Error occurred while restoring customer service.')
            );
        }
    }

    formatWithHeaderFooter(message) {
        const header = getSetting('company_header', '📱 NBB Wifiber');
        const footer = getSetting('footer_info', 'Powered by CyberNet');
        
        return `🏢 *${header}*\n\n${message}\n\n${footer}`;
    }

    // Main billing menu
    async handleBillingMenu(remoteJid) {
        const menuMessage = `📊 *ADMIN BILLING MENU*\n\n` +
            `*Customer Commands:*\n` +
            `• 👤 *add [name] [number] [package]* - Add new customer\n` +
            `• 📝 *edit [number] [field] [value]* - Edit customer data\n` +
            `• 🗑️ *delete [number]* - Delete customer\n` +
            `• 📋 *list* - List all customers\n` +
            `• 🔍 *search [number/name]* - Search customer\n\n` +

            `*Payment Commands:*\n` +
            `• 💰 *pay [number/name]* - Pay customer bill\n` +
            `• 📊 *bill [number/name]* - Check payment status\n` +
            `• ✅ *paid* - List of customers who already paid\n` +
            `• ⏰ *overdue* - List of overdue customers\n` +
            `• 📈 *stats* - Billing statistics\n\n` +

            `*Isolation Commands:*\n` +
            `• ⛔ *suspend [number/name] [reason?]* - Suspend customer service\n` +
            `• 🔓 *open [number/name] [reason?]* - Restore customer service\n\n` +

            `*Package Commands:*\n` +
            `• 📦 *addpackage [name] [speed] [price]* - Add package\n` +
            `• 📋 *listpackages* - List all packages\n\n` +

            `*Invoice Commands:*\n` +
            `• 📄 *createinvoice [number] [amount] [date]* - Create invoice\n` +
            `• 📊 *listinvoices [number]* - List customer invoices\n\n` +

            `*Usage Examples:*\n` +
            `add "John Doe" 081234567890 "Package Premium"\n` +
            `pay 081321960111  ← using number\n` +
            `pay Santo  ← using name\n` +
            `bill "John Doe"  ← name with spaces\n` +
            `search John  ← name search\n` +
            `suspend Santo Late payment 2 months\n` +
            `open 081234567890 Already paid the bill\n` +
            `paid`;

        await this.sendFormattedMessage(remoteJid, menuMessage);
    }

    // Customer Management Commands
    async handleAddCustomer(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: addcustomer [nama] [phone] [paket]\n' +
                    'Examples: addcustomer "John Doe" 081234567890 "Package Premium"'
                );
                return;
            }

            const name = params[0];
            const phone = params[1].replace(/\D/g, '');
            const packageName = params[2];

            // Cek apakah paket ada
            const packages = await billingManager.getPackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(packageName.toLowerCase()));
            
            if (!selectedPackage) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *PACKAGE NOT FOUND!*\n\n' +
                    'Available packages:\n' +
                    packages.map(p => `• ${p.name} - ${p.speed} - Rp${p.price}`).join('\n')
                );
                return;
            }

            // Cek apakah phone sudah ada
            const existingCustomer = await billingManager.getCustomerByPhone(phone);
            if (existingCustomer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *NOMOR TELEPON SUDAH TERDAFTAR!*\n\n' +
                    `Customer: ${existingCustomer.name}`
                );
                return;
            }

            const customerData = {
                name: name,
                phone: phone,
                package_id: selectedPackage.id,
                pppoe_username: billingManager.generatePPPoEUsername(phone),
                status: 'active'
            };

            const result = await billingManager.createCustomer(customerData);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMER SUCCESSFULLY ADDED!*\n\n' +
                    `*Name:* ${name}\n` +
                    `*Phone:* ${phone}\n` +
                    `*Package:* ${selectedPackage.name} (${selectedPackage.speed})\n` +
                    `*Username PPPoE:* ${customerData.pppoe_username}\n` +
                    `*Price:* Rp${selectedPackage.price}/month`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO ADD CUSTOMER!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleAddCustomer:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while adding customer.'
            );
        }
    }

    // Add customer (Indonesian)
    async handleAdd(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: add [name] [number] [package]\n' +
                    'Examples: tambah "John Doe" 081234567890 "Package Premium"'
                );
                return;
            }

            const name = params[0];
            const phone = params[1].replace(/\D/g, '');
            const packageName = params[2];

            // Cek apakah paket ada
            const packages = await billingManager.getPackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(packageName.toLowerCase()));
            
            if (!selectedPackage) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *PACKAGE NOT FOUND!*\n\n' +
                    'Available packages:\n' +
                    packages.map(p => `• ${p.name} - ${p.speed} - Rp${p.price}`).join('\n')
                );
                return;
            }

            // Cek apakah phone sudah ada
            const existingCustomer = await billingManager.getCustomerByPhone(phone);
            if (existingCustomer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *NOMOR TELEPON SUDAH TERDAFTAR!*\n\n' +
                    `Customer: ${existingCustomer.name}`
                );
                return;
            }

            const customerData = {
                name: name,
                phone: phone,
                package_id: selectedPackage.id,
                pppoe_username: billingManager.generatePPPoEUsername(phone),
                status: 'active'
            };

            const result = await billingManager.createCustomer(customerData);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMER SUCCESSFULLY ADDED!*\n\n' +
                    `*Name:* ${name}\n` +
                    `*Number:* ${phone}\n` +
                    `*Package:* ${selectedPackage.name} (${selectedPackage.speed})\n` +
                    `*Username PPPoE:* ${customerData.pppoe_username}\n` +
                    `*Price:* Rp${selectedPackage.price}/month`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO ADD CUSTOMER!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleAdd:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while adding customer.'
            );
        }
    }

    async handleEditCustomer(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: editcustomer [phone] [field] [value]\n' +
                    'Field yang tersedia: name, phone, package_id, status\n' +
                    'Examples: editcustomer 081234567890 name "John Smith"'
                );
                return;
            }

            const phone = params[0].replace(/\D/g, '');
            const field = params[1];
            const value = params[2];

            const customer = await billingManager.getCustomerByPhone(phone);
            if (!customer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *CUSTOMER NOT FOUND!*\n\n' +
                    `Phone: ${phone}`
                );
                return;
            }

            const updateData = {};
            updateData[field] = value;

            const result = await billingManager.updateCustomer(phone, updateData);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMER DATA SUCCESSFULLY UPDATED!*\n\n' +
                    `*Phone:* ${phone}\n` +
                    `*Field:* ${field}\n` +
                    `*Value:* ${value}`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO UPDATE CUSTOMER DATA!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleEditCustomer:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while updating customer data.'
            );
        }
    }

    async handleDeleteCustomer(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: delcustomer [phone]\n' +
                    'Examples: delcustomer 081234567890'
                );
                return;
            }

            const phone = params[0].replace(/\D/g, '');
            const customer = await billingManager.getCustomerByPhone(phone);
            
            if (!customer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *CUSTOMER NOT FOUND!*\n\n' +
                    `Phone: ${phone}`
                );
                return;
            }

            const result = await billingManager.deleteCustomer(phone);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMER SUCCESSFULLY DELETED!*\n\n' +
                    `*Name:* ${customer.name}\n` +
                    `*Phone:* ${customer.phone}\n` +
                    `*Username:* ${customer.username}`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO DELETE CUSTOMER!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleDeleteCustomer:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while deleting customer.'
            );
        }
    }

    async handleListCustomers(remoteJid) {
        try {
            const customers = await billingManager.getCustomers();
            
            if (customers.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '📋 *CUSTOMER INVOICE*\n\n' +
                    'No registered customers.'
                );
                return;
            }

            let message = `📋 *CUSTOMER INVOICE* (${customers.length} total)\n\n`;
            
            customers.forEach((customer, index) => {
                message += `${index + 1}. *${customer.name}*\n`;
                message += `   📱 ${customer.phone}\n`;
                message += `   👤 ${customer.username}\n`;
                message += `   📦 Package: ${customer.package_name || 'N/A'}\n`;
                message += `   📊 Status: ${customer.status}\n\n`;
            });

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleListCustomers:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving customer list.'
            );
        }
    }

    // List customer (bahasa Indonesia)
    async handleList(remoteJid) {
        try {
            const customers = await billingManager.getCustomers();
            
            if (customers.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '📋 *CUSTOMER INVOICE*\n\n' +
                    'No registered customers.'
                );
                return;
            }

            let message = `📋 *CUSTOMER INVOICE* (${customers.length} total)\n\n`;
            
            customers.forEach((customer, index) => {
                message += `${index + 1}. *${customer.name}*\n`;
                message += `   📱 ${customer.phone}\n`;
                message += `   👤 ${customer.username}\n`;
                message += `   📦 Package: ${customer.package_name || 'N/A'}\n`;
                message += `   📊 Status: ${customer.status}\n\n`;
            });

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleList:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving customer list.'
            );
        }
    }

    async handleFindCustomer(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: findcustomer [phone/username]\n' +
                    'Examples: findcustomer 081234567890'
                );
                return;
            }

            const searchTerm = params[0];
            const customers = await billingManager.getCustomers();
            
            // Search by phone or username
            const customer = customers.find(c => 
                c.phone.includes(searchTerm) || 
                c.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.name.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (!customer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *CUSTOMER NOT FOUND!*\n\n' +
                    `Search term: ${searchTerm}`
                );
                return;
            }

            const packages = await billingManager.getPackages();
            const selectedPackage = packages.find(p => p.id === customer.package_id);

            let message = `🔍 *CUSTOMER DETAILS*\n\n`;
            message += `*Name:* ${customer.name}\n`;
            message += `*Phone:* ${customer.phone}\n`;
            message += `*Username:* ${customer.username}\n`;
            message += `*PPPoE Username:* ${customer.pppoe_username || 'N/A'}\n`;
            message += `*Package:* ${selectedPackage ? selectedPackage.name : 'N/A'}\n`;
            message += `*Speed:* ${selectedPackage ? selectedPackage.speed : 'N/A'}\n`;
            message += `*Price:* ${selectedPackage ? `Rp${selectedPackage.price}` : 'N/A'}\n`;
            message += `*Status:* ${customer.status}\n`;
            message += `*Join Date:* ${customer.join_date}`;

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleFindCustomer:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while searching customer.'
            );
        }
    }

    // Search customer (Indonesian)
    async handleSearch(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: search [number/customer_name]\n' +
                    'Examples: \n' +
                    '• search 081234567890\n' +
                    '• search "Santo"\n' +
                    '• search John'
                );
                return;
            }

            const searchTerm = params.join(' '); // Combine all params for names containing spaces
            
            // Coba cari berdasarkan nomor atau nama
            let customer = await billingManager.getCustomerByNameOrPhone(searchTerm);
            
            // Jika not found dengan pencarian tunggal, coba cari multiple
            if (!customer) {
                const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);
                
                if (customers.length === 0) {
                    await this.sendFormattedMessage(remoteJid, 
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Search: "${searchTerm}"\n` +
                        `Make sure the phone number or customer name is correct.`
                    );
                    return;
                } else if (customers.length === 1) {
                    customer = customers[0];
                } else {
                    // Multiple customers found, show all
                    let message = `🔍 *FOUND ${customers.length} CUSTOMERS*\n\n`;
                    message += `Search: "${searchTerm}"\n\n`;
                    
                    customers.forEach((cust, index) => {
                        message += `${index + 1}. *${cust.name}*\n`;
                        message += `   📱 ${cust.phone}\n`;
                        message += `   👤 ${cust.username}\n`;
                        message += `   📦 ${cust.package_name || 'N/A'}\n`;
                        message += `   📊 Status: ${cust.status}\n\n`;
                    });
                    
                    message += `Use phone number for more details:\n`;
                    message += `Examples: \`search ${customers[0].phone}\``;
                    
                    await this.sendFormattedMessage(remoteJid, message);
                    return;
                }
            }

            const packages = await billingManager.getPackages();
            const selectedPackage = packages.find(p => p.id === customer.package_id);

            let message = `🔍 *CUSTOMER DETAILS*\n\n`;
            message += `*Name:* ${customer.name}\n`;
            message += `*Number:* ${customer.phone}\n`;
            message += `*Username:* ${customer.username}\n`;
            message += `*PPPoE Username:* ${customer.pppoe_username || 'N/A'}\n`;
            message += `*Package:* ${selectedPackage ? selectedPackage.name : 'N/A'}\n`;
            message += `*Speed:* ${selectedPackage ? selectedPackage.speed : 'N/A'}\n`;
            message += `*Price:* ${selectedPackage ? `Rp${selectedPackage.price.toLocaleString()}` : 'N/A'}\n`;
            message += `*Status:* ${customer.status}\n`;
            message += `*Join Date:* ${customer.join_date}`;

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleSearch:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while searching customer.'
            );
        }
    }

    // Payment Management Commands
    async handlePayInvoice(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: payinvoice [invoice_id] [amount] [method]\n' +
                    'Examples: payinvoice 123 500000 cash'
                );
                return;
            }

            const invoiceId = parseInt(params[0]);
            const amount = parseFloat(params[1]);
            const method = params[2];

            const invoice = await billingManager.getInvoiceById(invoiceId);
            if (!invoice) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *INVOICE NOT FOUND!*\n\n' +
                    `Invoice ID: ${invoiceId}`
                );
                return;
            }

            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const selectedPackage = await billingManager.getPackageById(invoice.package_id);

            const paymentData = {
                invoice_id: invoiceId,
                amount: amount,
                payment_method: method,
                reference_number: `WHATSAPP_${Date.now()}`,
                notes: 'Payment via WhatsApp Admin'
            };

            const result = await billingManager.recordPayment(paymentData);
            
            if (result.success) {
                // Update invoice status
                await billingManager.updateInvoiceStatus(invoiceId, 'paid', method);

                await this.sendFormattedMessage(remoteJid, 
                    '✅ *PAYMENT SUCCESSFUL!*\n\n' +
                    `*Invoice ID:* ${invoiceId}\n` +
                    `*Customer:* ${customer.name}\n` +
                    `*Package:* ${selectedPackage.name}\n` +
                    `*Amount:* Rp${amount.toLocaleString()}\n` +
                    `*Method:* ${method}\n` +
                    `*Status:* Paid`
                );

                // Auto-restore if all bills are paid
                try {
                    const refreshed = await billingManager.getCustomerById(customer.id);
                    const allInvoices = await billingManager.getInvoicesByCustomer(customer.id);
                    const unpaid = allInvoices.filter(i => i.status === 'unpaid');
                    logger.info(`[BILLING][WA] PayInvoice cek auto-restore -> status: ${refreshed?.status}, unpaid: ${unpaid.length}`);
                    if (refreshed && refreshed.status === 'suspended' && unpaid.length === 0) {
                        logger.info('[BILLING][WA] PayInvoice no pending bills. Running service restore...');
                        const restoreRes = await serviceSuspension.restoreCustomerService(refreshed, `Payment via WhatsApp (${method})`);
                        logger.info('[BILLING][WA] PayInvoice hasil restore:', restoreRes);
                    }
                } catch (restoreErr) {
                    logger.error('[BILLING][WA] PayInvoice failed auto-restore after payment:', restoreErr);
                }
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *PAYMENT PROCESSING FAILED!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handlePayInvoice:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error processing payment.'
            );
        }
    }

    // Payment sederhana dengan nomor customer atau nama
    async handlePay(remoteJid, params) {
        try {
            logger.info(`[BILLING] handlePay called with params:`, params);
            
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: pay [number/customer_name]\n' +
                    'Examples: \n' +
                    '• pay 081234567890\n' +
                    '• pay "Santo"\n' +
                    '• pay John'
                );
                return;
            }

            const searchTerm = params.join(' '); // Combine all params for names containing spaces
            logger.info(`[BILLING] Searching customer with: ${searchTerm}`);
            
            // Coba cari berdasarkan nomor atau nama
            let customer = await billingManager.getCustomerByNameOrPhone(searchTerm);
            logger.info(`[BILLING] Customer found:`, customer ? 'Yes' : 'No');
            
            // Jika not found dengan pencarian tunggal, coba cari multiple dan tanya konfirmasi
            if (!customer) {
                const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);
                logger.info(`[BILLING] Multiple customers found: ${customers.length}`);
                
                if (customers.length === 0) {
                    await this.sendFormattedMessage(remoteJid, 
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Search: "${searchTerm}"\n` +
                        `Make sure the phone number or customer name is correct.`
                    );
                    return;
                } else if (customers.length === 1) {
                    customer = customers[0];
                } else {
                    // Multiple customers found, ask for clarification
                    let message = `🔍 *FOUND ${customers.length} CUSTOMERS*\n\n`;
                    message += `Search: "${searchTerm}"\n\n`;
                    message += `Please use the payment command with more specific data:\n\n`;
                    
                    customers.forEach((cust, index) => {
                        message += `${index + 1}. *${cust.name}*\n`;
                        message += `   📱 ${cust.phone}\n`;
                        message += `   📦 ${cust.package_name || 'N/A'}\n`;
                        message += `   Use: \`pay ${cust.phone}\`\n\n`;
                    });
                    
                    await this.sendFormattedMessage(remoteJid, message);
                    return;
                }
            }

            // Search for unpaid invoices
            logger.info(`[BILLING] Searching invoice for customer ID: ${customer.id}`);
            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            logger.info(`[BILLING] Total invoices found: ${invoices ? invoices.length : 0}`);
            
            if (!invoices || invoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *CUSTOMER HAS NO BILLS!*\n\n' +
                    `*Customer:* ${customer.name}\n` +
                    `*Number:* ${customer.phone}\n` +
                    `*Status:* No bills created`
                );
                return;
            }
            
            const unpaidInvoices = invoices.filter(inv => inv.status === 'unpaid');
            logger.info(`[BILLING] Unpaid invoices: ${unpaidInvoices.length}`);
            
            if (unpaidInvoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMER HAS NO BILLS!*\n\n' +
                    `*Customer:* ${customer.name}\n` +
                    `*Number:* ${customer.phone}\n` +
                    `*Status:* All bills already paid`
                );
                return;
            }

            // Get the oldest unpaid invoice
            const oldestInvoice = unpaidInvoices.sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0];
            logger.info(`[BILLING] Selected invoice:`, oldestInvoice.id);
            
            const selectedPackage = await billingManager.getPackageById(oldestInvoice.package_id);
            logger.info(`[BILLING] Package found:`, selectedPackage ? 'Yes' : 'No');

            if (!selectedPackage) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *PACKAGE ERROR!*\n\n' +
                    'Package not found for this invoice.'
                );
                return;
            }

            const paymentData = {
                invoice_id: oldestInvoice.id,
                amount: oldestInvoice.amount,
                payment_method: 'cash',
                reference_number: `WHATSAPP_${Date.now()}`,
                notes: 'Payment via WhatsApp Admin'
            };

            logger.info(`[BILLING] Processing payment:`, paymentData);
            
            try {
                const result = await billingManager.recordPayment(paymentData);
                logger.info(`[BILLING] Hasil record payment:`, result);
                
                if (result && result.success) {
                    // Update invoice status
                    logger.info(`[BILLING] Updating invoice status: ${oldestInvoice.id}`);
                    await billingManager.updateInvoiceStatus(oldestInvoice.id, 'paid', 'cash');

                    await this.sendFormattedMessage(remoteJid, 
                        '✅ *PAYMENT SUCCESSFUL!*\n\n' +
                        `*Customer:* ${customer.name}\n` +
                        `*Number:* ${customer.phone}\n` +
                        `*Package:* ${selectedPackage.name}\n` +
                        `*Bill:* ${oldestInvoice.invoice_number}\n` +
                        `*Quantity:* Rp${oldestInvoice.amount.toLocaleString()}\n` +
                        `*Method:* Cash\n` +
                        `*Status:* Paid`
                    );

                    // Try auto-restore service if all bills are paid
                    try {
                        const refreshed = await billingManager.getCustomerById(customer.id);
                        const allInvoices = await billingManager.getInvoicesByCustomer(customer.id);
                        const unpaid = allInvoices.filter(i => i.status === 'unpaid');
                        logger.info(`[BILLING][WA] Check auto-restore -> status: ${refreshed?.status}, unpaid: ${unpaid.length}`);
                        if (refreshed && refreshed.status === 'suspended' && unpaid.length === 0) {
                            logger.info('[BILLING][WA] No pending bills. Running service restore...');
                            const restoreRes = await serviceSuspension.restoreCustomerService(refreshed, 'Payment via WhatsApp Admin');
                            logger.info('[BILLING][WA] Hasil restore:', restoreRes);
                        }
                    } catch (restoreErr) {
                        logger.error('[BILLING][WA] Failed auto-restore after payment:', restoreErr);
                    }
                } else {
                    logger.error(`[BILLING] Record payment failed:`, result);
                    await this.sendFormattedMessage(remoteJid, 
                        '❌ *PAYMENT PROCESSING FAILED!*\n\n' +
                        `Error: ${result ? result.error : 'Payment record failed'}`
                    );
                }
            } catch (paymentError) {
                logger.error(`[BILLING] Error during record payment:`, paymentError);
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *PAYMENT PROCESSING FAILED!*\n\n' +
                    `Error: ${paymentError.message || 'Database error'}`
                );
            }
        } catch (error) {
            logger.error('Error in handlePay:', error);
            logger.error('Error stack:', error.stack);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                `Error occurred: ${error.message || 'Unknown error'}`
            );
        }
    }

    async handleCheckPayment(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: checkpayment [invoice_id]\n' +
                    'Examples: checkpayment 123'
                );
                return;
            }

            const invoiceId = parseInt(params[0]);
            const invoice = await billingManager.getInvoiceById(invoiceId);
            
            if (!invoice) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *INVOICE NOT FOUND!*\n\n' +
                    `Invoice ID: ${invoiceId}`
                );
                return;
            }

            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const selectedPackage = await billingManager.getPackageById(invoice.package_id);
            const payments = await billingManager.getPayments(invoiceId);

            let message = `📊 *PAYMENT STATUS*\n\n`;
            message += `*Invoice ID:* ${invoice.id}\n`;
            message += `*Invoice Number:* ${invoice.invoice_number}\n`;
            message += `*Customer:* ${customer.name}\n`;
            message += `*Phone:* ${customer.phone}\n`;
            message += `*Package:* ${selectedPackage.name}\n`;
            message += `*Amount:* Rp${invoice.amount.toLocaleString()}\n`;
            message += `*Due Date:* ${invoice.due_date}\n`;
            message += `*Status:* ${invoice.status.toUpperCase()}\n\n`;

            if (payments.length > 0) {
                message += `*Payment History:*\n`;
                payments.forEach((payment, index) => {
                    message += `${index + 1}. Rp${payment.amount.toLocaleString()} - ${payment.payment_method} - ${payment.payment_date}\n`;
                });
            } else {
                message += `*Payment History:* No payments`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleCheckPayment:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while checking payment status.'
            );
        }
    }

    // Check payment status dengan nomor customer atau nama
    async handleBill(remoteJid, params) {
        try {
            if (params.length < 1) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: bill [number/customer_name]\n' +
                    'Examples: \n' +
                    '• bill 081234567890\n' +
                    '• bill "Santo"\n' +
                    '• bill John'
                );
                return;
            }

            const searchTerm = params.join(' '); // Combine all params for names containing spaces
            
            // Coba cari berdasarkan nomor atau nama
            let customer = await billingManager.getCustomerByNameOrPhone(searchTerm);
            
            // Jika not found dengan pencarian tunggal, coba cari multiple dan tanya konfirmasi
            if (!customer) {
                const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);
                
                if (customers.length === 0) {
                    await this.sendFormattedMessage(remoteJid, 
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Search: "${searchTerm}"\n` +
                        `Make sure the phone number or customer name is correct.`
                    );
                    return;
                } else if (customers.length === 1) {
                    customer = customers[0];
                } else {
                    // Multiple customers found, ask for clarification
                    let message = `🔍 *FOUND ${customers.length} CUSTOMERS*\n\n`;
                    message += `Search: "${searchTerm}"\n\n`;
                    message += `Please use the invoice command with more specific data:\n\n`;
                    
                    customers.forEach((cust, index) => {
                        message += `${index + 1}. *${cust.name}*\n`;
                        message += `   📱 ${cust.phone}\n`;
                        message += `   📦 ${cust.package_name || 'N/A'}\n`;
                        message += `   Use: \`bill ${cust.phone}\`\n\n`;
                    });
                    
                    await this.sendFormattedMessage(remoteJid, message);
                    return;
                }
            }

            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            const selectedPackage = await billingManager.getPackages().then(packages => 
                packages.find(p => p.id === customer.package_id)
            );

            let message = `📊 *CUSTOMER STATUS*\n\n`;
            message += `*Name:* ${customer.name}\n`;
            message += `*Number:* ${customer.phone}\n`;
            message += `*Package:* ${selectedPackage ? selectedPackage.name : 'N/A'}\n`;
            message += `*Status:* ${customer.status}\n\n`;

            if (invoices.length === 0) {
                message += `*Bill:* No bills`;
            } else {
                const unpaidInvoices = invoices.filter(inv => inv.status === 'unpaid');
                const paidInvoices = invoices.filter(inv => inv.status === 'paid');
                
                message += `*Total Bill:* ${invoices.length}\n`;
                message += `*Already paid:* ${paidInvoices.length}\n`;
                message += `*Unpaid:* ${unpaidInvoices.length}\n\n`;

                if (unpaidInvoices.length > 0) {
                    message += `*Unpaid Bills:*\n`;
                    unpaidInvoices.slice(0, 3).forEach((invoice, index) => {
                        const dueDate = new Date(invoice.due_date);
                        const today = new Date();
                        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                        
                        message += `${index + 1}. ${invoice.invoice_number}\n`;
                        message += `   💰 Rp${invoice.amount.toLocaleString()}\n`;
                        message += `   📅 Due date: ${invoice.due_date}\n`;
                        message += `   ⏰ ${daysOverdue > 0 ? `${daysOverdue} days overdue` : 'Not overdue'}\n\n`;
                    });
                    
                    if (unpaidInvoices.length > 3) {
                        message += `... and ${unpaidInvoices.length - 3} more bills`;
                    }
                }
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleBill:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while checking customer status.'
            );
        }
    }

    async handlePaidCustomers(remoteJid) {
        try {
            const invoices = await billingManager.getInvoices();
            const paidInvoices = invoices.filter(inv => inv.status === 'paid');
            
            if (paidInvoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMERS WHO Already paid*\n\n' +
                    'No customers have paid yet.'
                );
                return;
            }

            let message = `✅ *CUSTOMERS WHO Already paid* (${paidInvoices.length} total)\n\n`;
            
            for (const invoice of paidInvoices.slice(0, 10)) { // Limit to 10
                const customer = await billingManager.getCustomerById(invoice.customer_id);
                const selectedPackage = await billingManager.getPackageById(invoice.package_id);
                
                message += `• *${customer.name}*\n`;
                message += `  📱 ${customer.phone}\n`;
                message += `  📦 ${selectedPackage.name}\n`;
                message += `  💰 Rp${invoice.amount.toLocaleString()}\n`;
                message += `  📅 ${invoice.payment_date}\n\n`;
            }

            if (paidInvoices.length > 10) {
                message += `... and paidInvoices.length - 10 more customers`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handlePaidCustomers:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving list of customers who already paid.'
            );
        }
    }

    // List of customers who already paid (bahasa Indonesia)
    async handleAlreadyPay(remoteJid) {
        try {
            const invoices = await billingManager.getInvoices();
            const paidInvoices = invoices.filter(inv => inv.status === 'paid');
            
            if (paidInvoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *CUSTOMERS WHO Already paid*\n\n' +
                    'No customers have paid yet.'
                );
                return;
            }

            let message = `✅ *CUSTOMERS WHO Already paid* (${paidInvoices.length} total)\n\n`;
            
            for (const invoice of paidInvoices.slice(0, 10)) { // Limit to 10
                const customer = await billingManager.getCustomerById(invoice.customer_id);
                const selectedPackage = await billingManager.getPackageById(invoice.package_id);
                
                message += `• *${customer.name}*\n`;
                message += `  📱 ${customer.phone}\n`;
                message += `  📦 ${selectedPackage.name}\n`;
                message += `  💰 Rp${invoice.amount.toLocaleString()}\n`;
                message += `  📅 ${invoice.payment_date}\n\n`;
            }

            if (paidInvoices.length > 10) {
                message += `... and paidInvoices.length - 10 more customers`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleAlreadyPay:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving list of customers who already paid.'
            );
        }
    }

    async handleOverdueCustomers(remoteJid) {
        try {
            const overdueInvoices = await billingManager.getOverdueInvoices();
            
            if (overdueInvoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '⏰ *OVERDUE CUSTOMERS*\n\n' +
                    'No customers are overdue.'
                );
                return;
            }

            let message = `⏰ *OVERDUE CUSTOMERS* (${overdueInvoices.length} total)\n\n`;
            
            for (const invoice of overdueInvoices.slice(0, 10)) { // Limit to 10
                const customer = await billingManager.getCustomerById(invoice.customer_id);
                const selectedPackage = await billingManager.getPackageById(invoice.package_id);
                
                const dueDate = new Date(invoice.due_date);
                const today = new Date();
                const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                
                message += `• *${customer.name}*\n`;
                message += `  📱 ${customer.phone}\n`;
                message += `  📦 ${selectedPackage.name}\n`;
                message += `  💰 Rp${invoice.amount.toLocaleString()}\n`;
                message += `  📅 Due: ${invoice.due_date}\n`;
                message += `  ⏰ ${daysOverdue} days overdue\n\n`;
            }

            if (overdueInvoices.length > 10) {
                message += `... and overdueInvoices.length - 10 more customers`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleOverdueCustomers:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving list of overdue customers.'
            );
        }
    }

    // List of overdue customers (Indonesian)
    async handleTerlambat(remoteJid) {
        try {
            const overdueInvoices = await billingManager.getOverdueInvoices();
            
            if (overdueInvoices.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '⏰ *OVERDUE CUSTOMERS*\n\n' +
                    'No customers are overdue.'
                );
                return;
            }

            let message = `⏰ *OVERDUE CUSTOMERS* (${overdueInvoices.length} total)\n\n`;
            
            for (const invoice of overdueInvoices.slice(0, 10)) { // Limit to 10
                const customer = await billingManager.getCustomerById(invoice.customer_id);
                const selectedPackage = await billingManager.getPackageById(invoice.package_id);
                
                const dueDate = new Date(invoice.due_date);
                const today = new Date();
                const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                
                message += `• *${customer.name}*\n`;
                message += `  📱 ${customer.phone}\n`;
                message += `  📦 ${selectedPackage.name}\n`;
                message += `  💰 Rp${invoice.amount.toLocaleString()}\n`;
                message += `  📅 Due date: ${invoice.due_date}\n`;
                message += `  ⏰ ${daysOverdue} days overdue\n\n`;
            }

            if (overdueInvoices.length > 10) {
                message += `... and overdueInvoices.length - 10 more customers`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleTerlambat:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving list of overdue customers.'
            );
        }
    }

    async handleBillingStats(remoteJid) {
        try {
            const stats = await billingManager.getBillingStats();
            const customers = await billingManager.getCustomers();
            const invoices = await billingManager.getInvoices();
            const overdueInvoices = await billingManager.getOverdueInvoices();

            let message = `📈 *Billing statistics*\n\n`;
            message += `*Total Customer:* ${customers.length}\n`;
            message += `*Total Invoice:* ${invoices.length}\n`;
            message += `*Invoice Paid:* ${invoices.filter(inv => inv.status === 'paid').length}\n`;
            message += `*Invoice Unpaid:* ${invoices.filter(inv => inv.status === 'unpaid').length}\n`;
            message += `*Overdue Invoices:* ${overdueInvoices.length}\n\n`;
            
            message += `*Revenue:*\n`;
            message += `• Total: Rp${stats.totalRevenue?.toLocaleString() || '0'}\n`;
            message += `• This Month: Rp${stats.monthlyRevenue?.toLocaleString() || '0'}\n`;
            message += `• Outstanding: Rp${stats.outstandingAmount?.toLocaleString() || '0'}`;

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleBillingStats:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving billing statistics.'
            );
        }
    }

    // Billing statistics (bahasa Indonesia)
    async handleStatistik(remoteJid) {
        try {
            const stats = await billingManager.getBillingStats();
            const customers = await billingManager.getCustomers();
            const invoices = await billingManager.getInvoices();
            const overdueInvoices = await billingManager.getOverdueInvoices();

            let message = `📈 *Billing statistics*\n\n`;
            message += `*Total Customer:* ${customers.length}\n`;
            message += `*Total Bill:* ${invoices.length}\n`;
            message += `*Already Paid:* ${invoices.filter(inv => inv.status === 'paid').length}\n`;
            message += `*Not yet Paid:* ${invoices.filter(inv => inv.status === 'unpaid').length}\n`;
            message += `*Overdue:* ${overdueInvoices.length}\n\n`;
            
            message += `*Revenue:*\n`;
            message += `• Total: Rp${stats.totalRevenue?.toLocaleString() || '0'}\n`;
            message += `• This Month: Rp${stats.monthlyRevenue?.toLocaleString() || '0'}\n`;
            message += `• Outstanding: Rp${stats.outstandingAmount?.toLocaleString() || '0'}`;

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleStatistik:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving billing statistics.'
            );
        }
    }

    // Package Management Commands
    async handleAddPackage(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: addpackage [name] [speed] [price]\n' +
                    'Examples: addpackage "Package Premium" "50 Mbps" 500000'
                );
                return;
            }

            const name = params[0];
            const speed = params[1];
            const price = parseFloat(params[2]);

            const packageData = {
                name: name,
                speed: speed,
                price: price,
                description: `Package ${name} dengan kecepatan ${speed}`,
                is_active: true
            };

            const result = await billingManager.createPackage(packageData);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *PACKAGE SUCCESSFULLY ADDED!*\n\n' +
                    `*Name:* ${name}\n` +
                    `*Speed:* ${speed}\n` +
                    `*Price:* Rp${price.toLocaleString()}\n` +
                    `*Status:* Active`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO ADD PACKAGE!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleAddPackage:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while adding package.'
            );
        }
    }

    async handleListPackages(remoteJid) {
        try {
            const packages = await billingManager.getPackages();
            
            if (packages.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '📦 *PACKAGE LIST*\n\n' +
                    'No packages registered.'
                );
                return;
            }

            let message = `📦 *PACKAGE LIST* (${packages.length} total)\n\n`;
            
            packages.forEach((pkg, index) => {
                message += `${index + 1}. *${pkg.name}*\n`;
                message += `   🚀 Speed: ${pkg.speed}\n`;
                message += `   💰 Harga: Rp${pkg.price.toLocaleString()}\n`;
                message += `   📊 Status: ${pkg.is_active ? 'Active' : 'Inactive'}\n\n`;
            });

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleListPackages:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving package list.'
            );
        }
    }

    // List paket (bahasa Indonesia)
    async handleListPaket(remoteJid) {
        try {
            const packages = await billingManager.getPackages();
            
            if (packages.length === 0) {
                await this.sendFormattedMessage(remoteJid, 
                    '📦 *PACKAGE LIST*\n\n' +
                    'No packages registered.'
                );
                return;
            }

            let message = `📦 *PACKAGE LIST* (${packages.length} total)\n\n`;
            
            packages.forEach((pkg, index) => {
                message += `${index + 1}. *${pkg.name}*\n`;
                message += `   🚀 Speed: ${pkg.speed}\n`;
                message += `   💰 Harga: Rp${pkg.price.toLocaleString()}\n`;
                message += `   📊 Status: ${pkg.is_active ? 'Active' : 'Inactive'}\n\n`;
            });

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleListPackage:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving package list.'
            );
        }
    }

    // Invoice Management Commands
    async handleCreateInvoice(remoteJid, params) {
        try {
            if (params.length < 3) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FORMAT SALAH!*\n\n' +
                    'Format: createinvoice [phone] [amount] [due_date]\n' +
                    'Examples: createinvoice 081234567890 500000 2024-02-15'
                );
                return;
            }

            const phone = params[0].replace(/\D/g, '');
            const amount = parseFloat(params[1]);
            const dueDate = params[2];

            const customer = await billingManager.getCustomerByPhone(phone);
            if (!customer) {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *CUSTOMER NOT FOUND!*\n\n' +
                    `Phone: ${phone}`
                );
                return;
            }

            const invoiceData = {
                customer_id: customer.id,
                package_id: customer.package_id,
                amount: amount,
                due_date: dueDate,
                status: 'unpaid'
            };

            const result = await billingManager.createInvoice(invoiceData);
            
            if (result.success) {
                await this.sendFormattedMessage(remoteJid, 
                    '✅ *INVOICE SUCCESSFULLY CREATED!*\n\n' +
                    `*Invoice ID:* ${result.invoice.id}\n` +
                    `*Invoice Number:* ${result.invoice.invoice_number}\n` +
                    `*Customer:* ${customer.name}\n` +
                    `*Phone:* ${customer.phone}\n` +
                    `*Amount:* Rp${amount.toLocaleString()}\n` +
                    `*Due Date:* ${dueDate}\n` +
                    `*Status:* Unpaid`
                );
            } else {
                await this.sendFormattedMessage(remoteJid, 
                    '❌ *FAILED TO CREATE INVOICE!*\n\n' +
                    `Error: ${result.error}`
                );
            }
        } catch (error) {
            logger.error('Error in handleCreateInvoice:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while creating invoice.'
            );
        }
    }

    async handleListInvoices(remoteJid, params) {
        try {
            let invoices;
            let customer = null;

            if (params.length > 0) {
                const phone = params[0].replace(/\D/g, '');
                customer = await billingManager.getCustomerByPhone(phone);
                if (!customer) {
                    await this.sendFormattedMessage(remoteJid, 
                        '❌ *CUSTOMER NOT FOUND!*\n\n' +
                        `Phone: ${phone}`
                    );
                    return;
                }
                invoices = await billingManager.getInvoicesByCustomer(customer.id);
            } else {
                invoices = await billingManager.getInvoices();
            }

            if (invoices.length === 0) {
                const message = customer 
                    ? `📄 *CUSTOMER INVOICE*\n\nNo invoices for ${customer.name}`
                    : '📄 *INVOICE LIST*\n\nNo invoices registered.';
                
                await this.sendFormattedMessage(remoteJid, message);
                return;
            }

            let message = customer 
                ? `📄 *CUSTOMER INVOICE: ${customer.name}* (${invoices.length} total)\n\n`
                : `📄 *INVOICE LIST* (${invoices.length} total)\n\n`;

            for (const invoice of invoices.slice(0, 10)) { // Limit to 10
                const invCustomer = customer || await billingManager.getCustomerById(invoice.customer_id);
                const selectedPackage = await billingManager.getPackageById(invoice.package_id);
                
                message += `• *Invoice #${invoice.invoice_number}*\n`;
                message += `  👤 ${invCustomer.name}\n`;
                message += `  📦 ${selectedPackage.name}\n`;
                message += `  💰 Rp${invoice.amount.toLocaleString()}\n`;
                message += `  📅 Due: ${invoice.due_date}\n`;
                message += `  📊 Status: ${invoice.status.toUpperCase()}\n\n`;
            }

            if (invoices.length > 10) {
                message += `... and ${invoices.length - 10} more invoices`;
            }

            await this.sendFormattedMessage(remoteJid, message);
        } catch (error) {
            logger.error('Error in handleListInvoices:', error);
            await this.sendFormattedMessage(remoteJid, 
                '❌ *SYSTEM ERROR!*\n\n' +
                'Error occurred while retrieving invoice list.'
            );
        }
    }
}

module.exports = new BillingCommands();
