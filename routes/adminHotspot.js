const express = require('express');
const router = express.Router();
const { listMikrotikRouters, addHotspotUser, getActiveHotspotUsers, getHotspotProfileeeeeeeeees, deleteHotspotUser, generateHotspotVouchers, getHotspotServers, disconnectHotspotUser, getMikrotikConnection, updateHotspotUser } = require('../config/mikrotik');
const fs = require('fs');
const path = require('path');
const { getSettingsWithCache } = require('../config/settingsManager')
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

function getRouterIdFromReq(req) {
    return (req.query && (req.query.routerId || req.query.router_id)) || (req.body && (req.body.routerId || req.body.router_id)) || null;
}

// Helper function untuk mengambil setting voucher online
async function getVoucherOnlineSettings(routerOptions = {}) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./data/billing.db');

    return new Promise((resolve, reject) => {
        // Ensure table exists
        db.run(`
            CREATE TABLE IF NOT EXISTS voucher_online_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT '',
                profile TEXT NOT NULL,
                digits INTEGER NOT NULL DEFAULT 5,
                price INTEGER DEFAULT 0,
                duration INTEGER DEFAULT 24,
                duration_type TEXT DEFAULT 'hours',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating voucher_online_settings table:', err);
                resolve({});
                return;
            }

            // Insert default settings if table is empty
            db.get('SELECT COUNT(*) as count FROM voucher_online_settings', (err, row) => {
                if (err || row.count === 0) {
                    // Get first available profile from Mikrotik as default
                    const { getHotspotProfileeeeeeeeees } = require('../config/mikrotik');
                    getHotspotProfileeeeeeeeees(routerOptions).then(profilesResult => {
                        const defaultProfileeeeeeeeee = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
                            ? profilesResult.data[0].name 
                            : 'default';
                        
                        const defaultSettings = [
                            ['3k', '3rb - 1 Day', defaultProfileeeeeeeeee, 5, 0, 24, 'hours', 1],
                            ['5k', '5rb - 2 Day', defaultProfileeeeeeeeee, 5, 0, 48, 'hours', 1],
                            ['10k', '10rb - 5 Day', defaultProfileeeeeeeeee, 5, 0, 120, 'hours', 1],
                            ['15k', '15rb - 8 Day', defaultProfileeeeeeeeee, 5, 0, 192, 'hours', 1],
                            ['25k', '25rb - 15 Day', defaultProfileeeeeeeeee, 5, 0, 360, 'hours', 1],
                            ['50k', '50rb - 30 Day', defaultProfileeeeeeeeee, 5, 0, 720, 'hours', 1]
                        ];

                        const insertPromises = defaultSettings.map(([packageId, name, profile, digits, price, duration, duration_type, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, price, duration, duration_type, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, price, duration, duration_type, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            // Now get all settings
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            price: row.price || 0,
                                            duration: row.duration || 24,
                                            duration_type: row.duration_type || 'hours',
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting default settings:', err);
                            db.close();
                            resolve({});
                        });
                    }).catch((err) => {
                        console.error('Error getting Mikrotik profiles for default settings:', err);
                        // Fallback to hardcoded defaults
                        const fallbackSettings = [
                            ['3k', '3rb - 1 Day', 'default', 5, 0, 24, 'hours', 1],
                            ['5k', '5rb - 2 Day', 'default', 5, 0, 48, 'hours', 1],
                            ['10k', '10rb - 5 Day', 'default', 5, 0, 120, 'hours', 1],
                            ['15k', '15rb - 8 Day', 'default', 5, 0, 192, 'hours', 1],
                            ['25k', '25rb - 15 Day', 'default', 5, 0, 360, 'hours', 1],
                            ['50k', '50rb - 30 Day', 'default', 5, 0, 720, 'hours', 1]
                        ];
                        
                        const insertPromises = fallbackSettings.map(([packageId, name, profile, digits, price, duration, duration_type, enabled]) => {
                            return new Promise((resolveInsert, rejectInsert) => {
                                db.run(
                                    'INSERT OR IGNORE INTO voucher_online_settings (package_id, name, profile, digits, price, duration, duration_type, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                    [packageId, name, profile, digits, price, duration, duration_type, enabled],
                                    (err) => {
                                        if (err) rejectInsert(err);
                                        else resolveInsert();
                                    }
                                );
                            });
                        });

                        Promise.all(insertPromises).then(() => {
                            db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                                if (err) {
                                    console.error('Error getting voucher online settings:', err);
                                    resolve({});
                                } else {
                                    const settings = {};
                                    rows.forEach(row => {
                                        settings[row.package_id] = {
                                            name: row.name || `${row.package_id} - Paket`,
                                            profile: row.profile,
                                            digits: row.digits || 5,
                                            price: row.price || 0,
                                            duration: row.duration || 24,
                                            duration_type: row.duration_type || 'hours',
                                            enabled: row.enabled === 1
                                        };
                                    });
                                    db.close();
                                    resolve(settings);
                                }
                            });
                        }).catch((err) => {
                            console.error('Error inserting fallback settings:', err);
                            db.close();
                            resolve({});
                        });
                    });
                } else {
                    // Get existing settings
                    db.all('SELECT * FROM voucher_online_settings', (err, rows) => {
                        if (err) {
                            console.error('Error getting voucher online settings:', err);
                            resolve({});
                        } else {
                            const settings = {};
                            rows.forEach(row => {
                                settings[row.package_id] = {
                                    name: row.name || `${row.package_id} - Paket`,
                                    profile: row.profile,
                                    digits: row.digits || 5,
                                    price: row.price || 0,
                                    duration: row.duration || 24,
                                    duration_type: row.duration_type || 'hours',
                                    enabled: row.enabled === 1
                                };
                            });
                            db.close();
                            resolve(settings);
                        }
                    });
                }
            });
        });
    });
}

// GET: Show add hotspot user form and list of hotspot users
router.get('/', async (req, res) => {
    try {
        const routerId = getRouterIdFromReq(req);
        const { routers, defaultRouterId } = listMikrotikRouters();
        const selectedRouterId = routerId || defaultRouterId || null;
        const routerOptions = { routerId: selectedRouterId };

        const activeUsersResult = await getActiveHotspotUsers(routerOptions);
        let users = [];
        if (activeUsersResult.success && Array.isArray(activeUsersResult.data)) {
            users = activeUsersResult.data;
        }
        
        let profiles = [];
        let allUsers = [];
        try {
            const profilesResult = await getHotspotProfileeeeeeeeees(routerOptions);
            if (profilesResult.success && Array.isArray(profilesResult.data)) {
                profiles = profilesResult.data;
            } else {
                profiles = [];
            }
            console.log('Hotspot profiles from Mikrotik:', profiles);
        } catch (e) {
            console.error('Failed to get hotspot profile:', e.message);
            profiles = [];
        }
        try {
            // Get all hotspot users (not only active ones)
            const conn = await getMikrotikConnection(routerOptions);
            allUsers = await conn.write('/ip/hotspot/user/print');
            // Mapping so that properties are always present
            allUsers = allUsers.map(u => ({
                name: u.name || '',
                password: u.password || '',
                profile: u.profile || '',
            }));
        } catch (e) {
            console.error('Failed to get all hotspot users:', e.message);
            allUsers = [];
        }
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['admins.0'] || '-';

        // Get online voucher settings
        const voucherOnlineSettings = await getVoucherOnlineSettings(routerOptions);

        res.render('adminHotspot', {
            users,
            profiles,
            allUsers,
            voucherOnlineSettings,
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminContact,
            settings,
            routers,
            selectedRouterId,
            page: 'hotspot',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        const routerId = getRouterIdFromReq(req);
        const { routers, defaultRouterId } = listMikrotikRouters();
        const selectedRouterId = routerId || defaultRouterId || null;
        res.render('adminHotspot', {
            users: [],
            profiles: [],
            allUsers: [],
            success: null,
            error: 'Failed to get hotspot user data: ' + error.message,
            routers,
            selectedRouterId,
            page: 'hotspot'
        });
    }
});

// POST: Delete user hotspot
router.post('/delete', async (req, res) => {
    const { username } = req.body;
    try {
        const routerId = getRouterIdFromReq(req);
        await deleteHotspotUser(username, { routerId });
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?success=User+Hotspot+successful+dihapus' + qs);
    } catch (error) {
        const routerId = getRouterIdFromReq(req);
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?error=Failed+hapus+user:+' + encodeURIComponent(error.message) + qs);
    }
});

// POST: Proses penambahan user hotspot
router.post('/', async (req, res) => {
    const { username, password, profile } = req.body;
    try {
        const routerId = getRouterIdFromReq(req);
        await addHotspotUser(username, password, profile, null, { routerId });
        // Redirect agar tidak double submit, tampilkan pesan sukses
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?success=User+Hotspot+successful+ditambahkan' + qs);
    } catch (error) {
        const routerId = getRouterIdFromReq(req);
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?error=Failed+menambah+user:+"'+encodeURIComponent(error.message)+'"' + qs);
    }
});

// POST: Edit user hotspot
router.post('/edit', async (req, res) => {
    const { username, password, profile } = req.body;
    try {
        const routerId = getRouterIdFromReq(req);
        await updateHotspotUser(username, password, profile, { routerId });
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?success=User+Hotspot+successful+diupdate' + qs);
    } catch (error) {
        const routerId = getRouterIdFromReq(req);
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot?error=Failed+update+user:+' + encodeURIComponent(error.message) + qs);
    }
});

// POST: Generate user hotspot voucher
router.post('/generate', async (req, res) => {
    const jumlah = parseInt(req.body.jumlah) || 10;
    const profile = req.body.profile || 'default';
    const panjangPassword = parseInt(req.body.panjangPassword) || 6;
    const generated = [];

    // Get hotspot name and admin number from settings.json
    const settings = getSettingsWithCache();
    const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
    const adminContact = settings['admins.0'] || '-';

    // Random string generator function
    function randomString(length) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let str = '';
        for (let i = 0; i < length; i++) {
            str += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return str;
    }

    // Generate user and add to Mikrotik
    const { addHotspotUser } = require('../config/mikrotik');
    const routerId = getRouterIdFromReq(req);
    for (let i = 0; i < jumlah; i++) {
        const username = randomString(6) + randomString(2); // 8 characters unik
        const password = randomString(panjangPassword);
        try {
            await addHotspotUser(username, password, profile, null, { routerId });
            generated.push({ username, password, profile });
        } catch (e) {
            // Skip failed users
        }
    }

    // Render voucher in grid 4 rows per A4
    res.render('voucherHotspot', {
        vouchers: generated,
        namaHotspot,
        adminContact,
        profile,
    });
});

// POST: Generate user hotspot vouchers (JSON response)
router.post('/generate-vouchers', async (req, res) => {
    const { quantity, length, profile, type, charType } = req.body;

    try {
        // Use the generateHotspotVouchers function with correct parameters
        const count = parseInt(quantity) || 5;
        const prefix = 'wifi-'; // Default prefix
        const server = 'all'; // Default server
        const routerId = getRouterIdFromReq(req);
        const result = await generateHotspotVouchers(count, prefix, profile, server, '', '', charType, { routerId });
        
        if (result.success) {
            res.json({ success: true, vouchers: result.vouchers });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users count for statistics
router.get('/active-users', async (req, res) => {
    try {
        const routerId = getRouterIdFromReq(req);
        const result = await getActiveHotspotUsers({ routerId });
        if (result.success) {
            // Hitung jumlah user yang aktif dari data array
            const activeCount = Array.isArray(result.data) ? result.data.length : 0;
            res.json({ success: true, activeUsers: activeCount, activeUsersList: result.data });
        } else {
            console.error('Failed to get active hotspot users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Get active hotspot users detail for table
router.get('/active-users-detail', async (req, res) => {
    try {
        const routerId = getRouterIdFromReq(req);
        const result = await getActiveHotspotUsers({ routerId });
        if (result.success) {
            res.json({ success: true, activeUsers: result.data });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users detail:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST: Disconnect hotspot user
router.post('/disconnect-user', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required' });
    }
    
    try {
        const routerId = getRouterIdFromReq(req);
        const result = await disconnectHotspotUser(username, { routerId });
        if (result.success) {
            res.json({ success: true, message: `User ${username} successful diputus` });
        } else {
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error disconnecting hotspot user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Ambil data user hotspot aktif untuk AJAX
router.get('/active-users', async (req, res) => {
    try {
        const routerId = getRouterIdFromReq(req);
        const result = await getActiveHotspotUsers({ routerId });
        if (result.success) {
            // Log data untuk debugging
            console.log('Active users data:', JSON.stringify(result.data).substring(0, 200) + '...');
            res.json({ success: true, activeUsersList: result.data });
        } else {
            console.error('Failed to get active users:', result.message);
            res.status(500).json({ success: false, message: result.message });
        }
    } catch (error) {
        console.error('Error getting active hotspot users:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Tampilkan halaman voucher hotspot
router.get('/voucher', async (req, res) => {
    try {
        const routerId = getRouterIdFromReq(req);
        const { routers, defaultRouterId } = listMikrotikRouters();
        const selectedRouterId = routerId || defaultRouterId || null;
        const routerOptions = { routerId: selectedRouterId };

        // Get hotspot profiles
        const profilesResult = await getHotspotProfileeeeeeeeees(routerOptions);
        let profiles = [];
        if (profilesResult.success && Array.isArray(profilesResult.data)) {
            profiles = profilesResult.data;
        }
        
        // Get hotspot servers
        const serversResult = await getHotspotServers(routerOptions);
        let servers = [];
        if (serversResult.success && Array.isArray(serversResult.data)) {
            servers = serversResult.data;
        }
        
        // Get voucher history (from hotspot users)
        const conn = await getMikrotikConnection(routerOptions);
        const allUsers = await conn.write('/ip/hotspot/user/print');
        
        // Get active users to determine active status
        const activeUsersResult = await getActiveHotspotUsers(routerOptions);
        const activeUsernames = activeUsersResult.success && Array.isArray(activeUsersResult.data) 
            ? activeUsersResult.data.map(user => user.user) 
            : [];
        
        // Filter only vouchers (based on prefix or other criteria)
        const voucherHistory = allUsers.filter(user => 
            user.name && (user.name.startsWith('wifi-') || user.comment === 'voucher')
        ).map(user => ({
            username: user.name || '',
            password: user.password || '',
            profile: user.profile || 'default',
            server: user.server || 'all',
            createdAt: new Date(), // This should be taken from data if available
            active: activeUsernames.includes(user.name), // Check if user is currently active
            comment: user.comment || ''
        }));
        
        console.log(`Loaded ${voucherHistory.length} vouchers for history table`);
        
        // Get settings from settings.json
        const settings = getSettingsWithCache();
        const company_header = settings.company_header || 'Voucher Hotspot';
        const adminContact = settings['footer_info'] || '-';
        
        // Get online voucher settings
        const voucherOnlineSettings = await getVoucherOnlineSettings(routerOptions);
        
        res.render('adminVoucher', {
            profiles,
            servers,
            voucherHistory,
            voucherOnlineSettings,
            success: req.query.success,
            error: req.query.error,
            company_header,
            adminContact,
            settings,
            routers,
            selectedRouterId,
            page: 'voucher',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Error rendering voucher page:', error);
        const routerId = getRouterIdFromReq(req);
        const { routers, defaultRouterId } = listMikrotikRouters();
        const selectedRouterId = routerId || defaultRouterId || null;
        res.render('adminVoucher', {
            profiles: [],
            servers: [],
            voucherHistory: [],
            voucherOnlineSettings: {},
            success: null,
            error: 'Failed to load voucher page: ' + error.message,
            routers,
            selectedRouterId,
            page: 'voucher',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    }
});

// POST: Generate voucher dengan JSON response
router.post('/generate-voucher', async (req, res) => {
    try {
        // Log request untuk debugging
        console.log('Generate voucher request:', req.body);
        console.log('Count from request:', req.body.count);
        console.log('Profileeeeeeeeee from request:', req.body.profile);
        console.log('Price from request:', req.body.price);
        console.log('CharType from request:', req.body.charType);
        
        const count = parseInt(req.body.count) || 5;
        const prefix = req.body.prefix || 'wifi-';
        const profile = req.body.profile || 'default';
        const server = req.body.server || 'all';
        const validUntil = req.body.validUntil || '';
        const price = req.body.price || '';
        const voucherModel = req.body.voucherModel || 'standard';
        const charType = req.body.charType || 'alphanumeric';
        
        console.log('Parsed values:');
        console.log('- Count:', count);
        console.log('- Profileeeeeeeeee:', profile);
        console.log('- Price:', price);
        console.log('- CharType:', charType);
        
        // Use the generateHotspotVouchers function that was imported above
        const routerId = getRouterIdFromReq(req);
        const result = await generateHotspotVouchers(count, prefix, profile, server, validUntil, price, charType, { routerId });
        
        if (!result.success) {
            throw new Error(result.message || 'Failed generate voucher');
        }
        
        // Get settings from settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminContact = settings['footer_info'] || '-';
        
        // Log response for debugging
        console.log(`Generated ${result.vouchers.length} vouchers successfully`);
        
        const response = {
            success: true,
            vouchers: result.vouchers.map(voucher => ({
                ...voucher,
                profile: profile, // Ensure profile is in every voucher
                price: price // Ensure price is in every voucher
            })),
            server,
            profile,
            validUntil,
            price,
            voucherModel: voucherModel,
            namaHotspot,
            adminContact
        };
        
        console.log('Response:', JSON.stringify(response));
        res.json(response);
    } catch (error) {
        console.error('Error generating vouchers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed generate voucher: ' + error.message
        });
    }
});

// GET: Print vouchers page
router.get('/print-vouchers', async (req, res) => {
    try {
        // Get settings from settings.json
        const settings = getSettingsWithCache();
        const namaHotspot = settings.company_header || 'HOTSPOT VOUCHER';
        const adminContact = settings['admins.0'] || '-';
        
        res.render('voucherHotspot', {
            vouchers: [], // Vouchers will be sent via postMessage
            namaHotspot,
            adminContact
        });
    } catch (error) {
        res.status(500).send('Error: ' + error.message);
    }
});

// POST: Delete voucher
router.post('/delete-voucher', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        const routerId = getRouterIdFromReq(req);
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        return res.redirect('/admin/hotspot/voucher?error=Username+is+required' + qs);
    }

    try {
        const routerId = getRouterIdFromReq(req);
        await deleteHotspotUser(username, { routerId });
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot/voucher?success=Voucher+successful+dihapus' + qs);
    } catch (error) {
        console.error('Error deleting voucher:', error);
        const routerId = getRouterIdFromReq(req);
        const qs = routerId ? `&routerId=${encodeURIComponent(routerId)}` : '';
        res.redirect('/admin/hotspot/voucher?error=' + encodeURIComponent('Failed to delete voucher: ' + error.message) + qs);
    }
});

// POST: Generate manual voucher for online settings
router.post('/generate-manual-voucher', async (req, res) => {
    try {
        const { username, password, profile } = req.body;

        if (!username || !password || !profile) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, and profile must be filled'
            });
        }

        // Add user to Mikrotik
        const routerId = getRouterIdFromReq(req);
        const result = await addHotspotUser(username, password, profile, null, { routerId });

        if (result.success) {
            res.json({
                success: true,
                message: 'Manual voucher successfully created',
                voucher: {
                    username,
                    password,
                    profile
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to create voucher: ' + (result.message || 'Unknown error')
            });
        }

    } catch (error) {
        console.error('Error generating manual voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating manual voucher: ' + error.message
        });
    }
});

// POST: Generate auto voucher for online settings
router.post('/generate-auto-voucher', async (req, res) => {
    try {
        const { count, profile, numericOnly } = req.body;
        const numVouchers = parseInt(count) || 1;

        if (numVouchers > 10) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal 10 voucher per generate'
            });
        }

        const generatedVouchers = [];

        // Function to generate random string
        function randomString(length, numeric = false) {
            const chars = numeric ? '0123456789' : 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let str = '';
            for (let i = 0; i < length; i++) {
                str += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return str;
        }

        // Generate vouchers
        const routerId = getRouterIdFromReq(req);
        for (let i = 0; i < numVouchers; i++) {
            let username, password;

            if (numericOnly) {
                // Username dan password sama, angka saja
                const randomNum = randomString(8, true);
                username = randomNum;
                password = randomNum;
            } else {
                // Username dan password berbeda
                username = randomString(6) + randomString(2);
                password = randomString(8);
            }

            try {
                const result = await addHotspotUser(username, password, profile, null, { routerId });
                if (result.success) {
                    generatedVouchers.push({
                        username,
                        password,
                        profile
                    });
                }
            } catch (e) {
                console.error(`Failed to create voucher ${i + 1}:`, e.message);
            }
        }

        res.json({
            success: true,
            message: `${generatedVouchers.length} auto vouchers successfully created`,
            vouchers: generatedVouchers
        });

    } catch (error) {
        console.error('Error generating auto voucher:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating auto voucher: ' + error.message
        });
    }
});

// POST: Reset online voucher settings to the first profile
router.post('/reset-voucher-online-settings', async (req, res) => {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Get the first available profile from Mikrotik
        const { getHotspotProfiles } = require('../config/mikrotik');
        const routerId = getRouterIdFromReq(req);
        const profilesResult = await getHotspotProfiles({ routerId });
        const defaultProfile = (profilesResult.success && profilesResult.data && profilesResult.data.length > 0) 
            ? profilesResult.data[0].name 
            : 'default';

        // Update all packages to use the first profile
        const packages = ['3k', '5k', '10k', '15k', '25k', '50k'];
        const updatePromises = packages.map(packageId => {
            return new Promise((resolve, reject) => {
                db.run(
                    'UPDATE voucher_online_settings SET profile = ? WHERE package_id = ?',
                    [defaultProfile, packageId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        });

        await Promise.all(updatePromises);
        db.close();

        res.json({
            success: true,
            message: `Online voucher setting successfully reset to profile: ${defaultProfile}`,
            defaultProfile: defaultProfile
        });

    } catch (error) {
        console.error('Error resetting voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed reset setting voucher online: ' + error.message
        });
    }
});

// POST: Save voucher online settings
router.post('/save-voucher-online-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data invalid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_online_settings table exists with duration columns
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_online_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    package_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL DEFAULT '',
                    profile TEXT NOT NULL,
                    digits INTEGER NOT NULL DEFAULT 5,
                    price INTEGER DEFAULT 0,
                    duration INTEGER DEFAULT 24,
                    duration_type TEXT DEFAULT 'hours',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings for each package
        const promises = Object.keys(settings).map(packageId => {
            const setting = settings[packageId];
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_online_settings
                    (package_id, name, profile, digits, price, duration, duration_type, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `;
                db.run(sql, [
                    packageId, 
                    setting.name || `${packageId} - Paket`, 
                    setting.profile, 
                    setting.digits || 5, 
                    setting.price || 0,
                    setting.duration || 24,
                    setting.duration_type || 'hours',
                    setting.enabled ? 1 : 0
                ], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);

        db.close();

        res.json({
            success: true,
            message: 'Setting voucher online saved successfully'
        });

    } catch (error) {
        console.error('Error saving voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save voucher online settings: ' + error.message
        });
    }
});

// POST: Save voucher generation settings
router.post('/save-voucher-generation-settings', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data invalid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Ensure voucher_generation_settings table exists
        await new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS voucher_generation_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT NOT NULL UNIQUE,
                    setting_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Update settings
        const promises = Object.keys(settings).map(key => {
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_generation_settings
                    (setting_key, setting_value, updated_at)
                    VALUES (?, ?, datetime('now'))
                `;
                db.run(sql, [key, settings[key]], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);
        db.close();

        res.json({
            success: true,
            message: 'Settings generate voucher saved successfully'
        });

    } catch (error) {
        console.error('Error saving voucher generation settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save settings: ' + error.message
        });
    }
});

// POST: Test voucher generation
router.post('/test-voucher-generation', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data invalid'
            });
        }

        // Generate test voucher based on settings
        const { generateTestVoucher } = require('../config/mikrotik');
        const result = await generateTestVoucher(settings);

        if (result.success) {
            res.json({
                success: true,
                username: result.username,
                password: result.password,
                message: 'Test generate voucher successful'
            });
        } else {
            res.json({
                success: false,
                message: result.message
            });
        }

    } catch (error) {
        console.error('Error testing voucher generation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed test generate voucher: ' + error.message
        });
    }
});

// POST: Save voucher online settings from /admin/hotspot/voucher page
router.post('/save-voucher-online-settings-from-voucher', async (req, res) => {
    try {
        const settings = req.body.settings;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Settings data invalid'
            });
        }

        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        // Update settings for each package
        const promises = Object.keys(settings).map(packageId => {
            const setting = settings[packageId];
            return new Promise((resolve, reject) => {
                const sql = `
                    INSERT OR REPLACE INTO voucher_online_settings
                    (package_id, name, profile, digits, price, duration, duration_type, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                `;
                db.run(sql, [
                    packageId, 
                    setting.name || `${packageId} - Paket`, 
                    setting.profile, 
                    setting.digits || 5, 
                    setting.price || 0,
                    setting.duration || 24,
                    setting.duration_type || 'hours',
                    setting.enabled ? 1 : 0
                ], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        await Promise.all(promises);

        db.close();

        res.json({
            success: true,
            message: 'Setting voucher online saved successfully'
        });

    } catch (error) {
        console.error('Error saving voucher online settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save voucher online settings: ' + error.message
        });
    }
});

module.exports = router;
