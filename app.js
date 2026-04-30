const express = require('express');
const path = require('path');
const axios = require('axios');
const logger = require('./config/logger');
const whatsapp = require('./config/whatsapp');
const { monitorPPPoEConnections } = require('./config/mikrotik');
const fs = require('fs');
const session = require('express-session');
const { getSetting } = require('./config/settingsManager');

// Import invoice scheduler
const invoiceScheduler = require('./config/scheduler');

// Import auto GenieACS setup for development (DISABLED - using web interface)
// const { autoGenieACSSetup } = require('./config/autoGenieACSSetup');

// Import technician sync service for hot-reload
const technicianSync = {
    start() {
        const fs = require('fs');
        const sqlite3 = require('sqlite3').verbose();
        const { getSettingsWithCache } = require('./config/settingsManager');

        const db = new sqlite3.Database('./data/billing.db');

        const sync = () => {
            try {
                const settings = getSettingsWithCache();
                Object.keys(settings).filter(k => k.startsWith('technician_numbers.')).forEach(k => {
                    const phone = settings[k];
                    if (phone) {
                        db.run('INSERT OR IGNORE INTO technicians (phone, name, role, is_active, created_at) VALUES (?, ?, "technician", 1, datetime("now"))',
                            [phone, `Technician ${phone.slice(-4)}`]);
                    }
                });
                console.log('📱 Technician numbers synced from settings.json');
            } catch (e) {
                console.error('Sync error:', e.message);
            }
        };

        fs.watchFile('settings.json', { interval: 1000 }, sync);
        sync(); // Initial sync
        console.log('🔄 Technician auto-sync enabled - settings.json changes will auto-update technicians');
    }
};

// Start technician sync service
technicianSync.start();

// Initialize Express application
const app = express();

// Import route adminAuth
const { router: adminAuthRouter, adminAuth } = require('./routes/adminAuth');

// Import middleware for access control (must be imported before use)
const { blockTechnicianAccess } = require('./middleware/technicianAccessControl');

// Basic middleware - Optimized
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files with cache
app.use('/public', express.static(path.join(__dirname, 'public'), {
    maxAge: '1h', // Cache static files for 1 hour
    etag: true
}));
app.use(session({
    secret: 'secret-portal-your', // Replace with secure random string
    resave: false,
    saveUninitialized: false, // Optimized: don't save empty session
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true
    },
    name: 'admin_session' // Custom session name
}));


// Test route for debugging
app.get('/admin/test', (req, res) => {
    res.json({ message: 'Admin routes working!', timestamp: new Date().toISOString() });
});


// Use adminAuth route for /admin
app.use('/admin', adminAuthRouter);

// Import and use adminDashboard route
const adminDashboardRouter = require('./routes/adminDashboard');
app.use('/admin', blockTechnicianAccess, adminDashboardRouter);

// Import and use adminGenieacs route
const adminGenieacsRouter = require('./routes/adminGenieacs');
app.use('/admin', blockTechnicianAccess, adminGenieacsRouter);

// Import and use adminMappingNew route
const adminMappingNewRouter = require('./routes/adminMappingNew');
app.use('/admin', blockTechnicianAccess, adminMappingNewRouter);

// Import and use adminMikrotik route
const adminMikrotikRouter = require('./routes/adminMikrotik');
app.use('/admin', blockTechnicianAccess, adminMikrotikRouter);

// Import and use adminHotspot route
const adminHotspotRouter = require('./routes/adminHotspot');
app.use('/admin/hotspot', blockTechnicianAccess, adminHotspotRouter);

// Import and use adminSetting route
const { router: adminSettingRouter } = require('./routes/adminSetting');
app.use('/admin/settings', blockTechnicianAccess, adminAuth, adminSettingRouter);

// Import and use adminUpdate route
const adminUpdateRouter = require('./routes/adminUpdate');
app.use('/admin/update', blockTechnicianAccess, adminAuth, adminUpdateRouter);

// Import and use configValidation route
const configValidationRouter = require('./routes/configValidation');
app.use('/admin/config', blockTechnicianAccess, configValidationRouter);

// Import and use adminTroubleReport route
const adminTroubleReportRouter = require('./routes/adminTroubleReport');
app.use('/admin/trouble', blockTechnicianAccess, adminAuth, adminTroubleReportRouter);

// Import and use adminBilling route (moved below to avoid interfering with login route)
const adminBillingRouter = require('./routes/adminBilling');
app.use('/admin/billing', blockTechnicianAccess, adminAuth, adminBillingRouter);

// Import and use adminInstallationJobs route
const adminInstallationJobsRouter = require('./routes/adminInstallationJobs');
app.use('/admin/installations', blockTechnicianAccess, adminAuth, adminInstallationJobsRouter);

// Import and use adminTechnicians route
const adminTechniciansRouter = require('./routes/adminTechnicians');
app.use('/admin/technicians', blockTechnicianAccess, adminAuth, adminTechniciansRouter);

// Import and use agentAuth route
const { router: agentAuthRouter } = require('./routes/agentAuth');
app.use('/agent', agentAuthRouter);

// Import and use agent route
const agentRouter = require('./routes/agent');
app.use('/agent', agentRouter);

// Import and use adminAgents route
const adminAgentsRouter = require('./routes/adminAgents');
app.use('/admin', blockTechnicianAccess, adminAuth, adminAgentsRouter);

// Import and use adminVoucherPricing route
const adminVoucherPricingRouter = require('./routes/adminVoucherPricing');
app.use('/admin/voucher-pricing', blockTechnicianAccess, adminAuth, adminVoucherPricingRouter);

// Import and use adminCableNetwork route
const adminCableNetworkRouter = require('./routes/adminCableNetwork');
app.use('/admin/cable-network', blockTechnicianAccess, adminAuth, adminCableNetworkRouter);

// Import and use adminCollectors route
const adminCollectorsRouter = require('./routes/adminCollectors');
app.use('/admin/collectors', blockTechnicianAccess, adminCollectorsRouter);

// Import and use cache management route
const cacheManagementRouter = require('./routes/cacheManagement');
app.use('/admin/cache', blockTechnicianAccess, cacheManagementRouter);

// Import and use payment route
const paymentRouter = require('./routes/payment');
app.use('/payment', paymentRouter);

// Import and use testTroubleReport route for debugging
const testTroubleReportRouter = require('./routes/testTroubleReport');
app.use('/test/trouble', testTroubleReportRouter);

// Import and use trouble report route for customers
const troubleReportRouter = require('./routes/troubleReport');
app.use('/customer/trouble', troubleReportRouter);

// Import and use public voucher route
const { router: publicVoucherRouter } = require('./routes/publicVoucher');
app.use('/voucher', publicVoucherRouter);

// Import and use public tools route
const publicToolsRouter = require('./routes/publicTools');
app.use('/tools', publicToolsRouter);

// Add webhook endpoint for voucher payment
app.use('/webhook/voucher', publicVoucherRouter);

// Import and use API dashboard traffic route
const apiDashboardRouter = require('./routes/apiDashboard');
app.use('/api', apiDashboardRouter);

// Constants
const VERSION = '1.0.0';

// Global variable to store WhatsApp connection status
// (Persistent, because runtime status)
global.whatsappStatus = {
    connected: false,
    qrCode: null,
    phoneNumber: null,
    connectedSince: null,
    status: 'disconnected'
};

// DELETE global.appSettings
// Ensure WhatsApp session directory exists
const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    logger.info(`WhatsApp session directory created: ${sessionDir}`);
}

// Route for health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: VERSION,
        whatsapp: global.whatsappStatus.status
    });
});

// Route to get WhatsApp status
app.get('/whatsapp/status', (req, res) => {
    res.json({
        status: global.whatsappStatus.status,
        connected: global.whatsappStatus.connected,
        phoneNumber: global.whatsappStatus.phoneNumber,
        connectedSince: global.whatsappStatus.connectedSince
    });
});

// Redirect root to customer portal
app.get('/', (req, res) => {
    res.redirect('/customer/login');
});

// Import PPPoE monitoring modules
const pppoeMonitor = require('./config/pppoe-monitor');
const pppoeCommands = require('./config/pppoe-commands');

// Import GenieACS commands module
const genieacsCommands = require('./config/genieacs-commands');

// Import MikroTik commands module
const mikrotikCommands = require('./config/mikrotik-commands');

// Import RX Power Monitor module
const rxPowerMonitor = require('./config/rxPowerMonitor');

// Add view engine and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
// Placeholder icons to avoid 404 before real assets are uploaded
try {
    const staticIcons = require('./routes/staticIcons');
    app.use('/', staticIcons);
} catch (e) {
    logger.warn('staticIcons route not loaded:', e.message);
}
// Mount customer portal
const customerPortal = require('./routes/customerPortal');
app.use('/customer', customerPortal);

// Mount customer billing portal
const customerBillingRouter = require('./routes/customerBilling');
app.use('/customer/billing', customerBillingRouter);

// Import and use technician portal route
const { router: technicianAuthRouter } = require('./routes/technicianAuth');
app.use('/technician', technicianAuthRouter);
// Indonesian alias for technician
app.use('/teknisi', technicianAuthRouter);

// Import and use technician dashboard route
const technicianDashboardRouter = require('./routes/technicianDashboard');
app.use('/technician', technicianDashboardRouter);
// Indonesian alias for technician dashboard
app.use('/teknisi', technicianDashboardRouter);

// Import and use technician cable network route
const technicianCableNetworkRouter = require('./routes/technicianCableNetwork');
app.use('/technician', technicianCableNetworkRouter);
// Indonesian alias for technician cable network
app.use('/teknisi', technicianCableNetworkRouter);

// Isolation Page - displays info from settings.json and auto-resolve name
app.get('/isolir', async (req, res) => {
    try {
        const { getSettingsWithCache, getSetting } = require('./config/settingsManager');
        const billingManager = require('./config/billing');

        const settings = getSettingsWithCache();
        const companyHeader = getSetting('company_header', 'GEMBOK');
        const adminWA = getSetting('admins.0', '6281234567890'); // format 62...
        const adminDisplay = adminWA && adminWA.startsWith('62') ? ('0' + adminWA.slice(2)) : (adminWA || '-');

        // Auto-resolve customer name: priority order -> query.nama -> PPPoE username -> session -> '-' 
        let customerName = (req.query.nama || req.query.name || '').toString().trim();
        if (!customerName) {
            // Try from session customer_username
            const sessionUsername = req.session && (req.session.customer_username || req.session.username);
            if (sessionUsername) {
                try {
                    const c = await billingManager.getCustomerByUsername(sessionUsername);
                    if (c && c.name) customerName = c.name;
                } catch { }
            }
        }
        if (!customerName) {
            // Try from PPPoE username (query pppoe / username)
            const qUser = (req.query.pppoe || req.query.username || '').toString().trim();
            if (qUser) {
                try {
                    const c = await billingManager.getCustomerByPPPoE(qUser);
                    if (c && c.name) customerName = c.name;
                } catch { }
            }
        }
        if (!customerName) {
            // Try from phone number (query phone) for fallback
            const qPhone = (req.query.phone || req.query.nohp || '').toString().trim();
            if (qPhone) {
                try {
                    const c = await billingManager.getCustomerByPhone(qPhone);
                    if (c && c.name) customerName = c.name;
                } catch { }
            }
        }
        if (!customerName) customerName = 'Customer';

        // Logo path from settings.json (served via /public or /storage pattern)
        const logoFile = settings.logo_filename || 'logo.png';
        const logoPath = `/public/img/${logoFile}`;

        // Payment accounts from settings.json (bank transfer & cash)
        const paymentAccounts = settings.payment_accounts || {};

        res.render('isolir', {
            companyHeader,
            adminWA,
            adminDisplay,
            customerName: customerName.slice(0, 64),
            logoPath,
            paymentAccounts,
            encodeURIComponent
        });
    } catch (error) {
        console.error('Error rendering isolir page:', error);
        res.status(500).send('Failed to load isolation page');
    }
});

// Import and use collector route
const { router: collectorAuthRouter } = require('./routes/collectorAuth');
app.use('/collector', collectorAuthRouter);

// Import and use collector dashboard route
const collectorDashboardRouter = require('./routes/collectorDashboard');
app.use('/collector', collectorDashboardRouter);

// Import and use update check route
const versionCheckRouter = require('./routes/versionCheck');
app.use('/api/version', versionCheckRouter);

// Initialize scheduled tasks
const scheduledTasks = require('./config/scheduledTasks');

// Initialize WhatsApp and PPPoE monitoring
try {
    whatsapp.connectToWhatsApp().then(sock => {
        if (sock) {
            // Set sock instance for whatsapp
            whatsapp.setSock(sock);

            // Make WhatsApp socket globally available
            global.whatsappSocket = sock;
            global.getWhatsAppSocket = () => sock;

            // Set sock instance for PPPoE monitoring
            pppoeMonitor.setSock(sock);

            // Initialize Agent WhatsApp Commands
            const AgentWhatsAppIntegration = require('./config/agentWhatsAppIntegration');
            const agentWhatsApp = new AgentWhatsAppIntegration(whatsapp);
            agentWhatsApp.initialize();

            console.log('🤖 Agent WhatsApp Commands initialized');
            pppoeCommands.setSock(sock);

            // Set sock instance for GenieACS commands
            genieacsCommands.setSock(sock);

            // Set sock instance for MikroTik commands
            mikrotikCommands.setSock(sock);

            // Set sock instance for RX Power Monitor
            rxPowerMonitor.setSock(sock);
            // Set sock instance for trouble report
            const troubleReport = require('./config/troubleReport');
            troubleReport.setSockInstance(sock);

            // Initialize scheduled tasks
            scheduledTasks.initialize();

            // Initialize database tables for legacy databases without agent feature
            const initAgentTables = () => {
                return new Promise((resolve, reject) => {
                    try {
                        // AgentManager already has createTables() that automatically creates all agent tables
                        const AgentManager = require('./config/agentManager');
                        const agentManager = new AgentManager();
                        console.log('✅ Agent tables created/verified by AgentManager');
                        resolve();
                    } catch (error) {
                        console.error('Error initializing agent tables:', error);
                        reject(error);
                    }
                });
            };

            // Call init after database connected
            initAgentTables().then(() => {
                console.log('Database initialization completed successfully');
            }).catch((err) => {
                console.error('Database initialization failed:', err);
            });

            // Initialize PPPoE monitoring if MikroTik is configured
            if (getSetting('mikrotik_host') && getSetting('mikrotik_user') && getSetting('mikrotik_password')) {
                pppoeMonitor.initializePPPoEMonitoring().then(() => {
                    logger.info('PPPoE monitoring initialized');
                }).catch((err) => {
                    logger.error('Error initializing PPPoE monitoring:', err);
                });
            }

            // Initialize Interval Manager (replaces individual monitoring systems)
            try {
                const intervalManager = require('./config/intervalManager');
                intervalManager.initialize();
                logger.info('Interval Manager initialized with all monitoring systems');
            } catch (err) {
                logger.error('Error initializing Interval Manager:', err);
            }
        }
    }).catch(err => {
        logger.error('Error connecting to WhatsApp:', err);
    });

    // Start legacy PPPoE monitoring if configured (fallback)
    if (getSetting('mikrotik_host') && getSetting('mikrotik_user') && getSetting('mikrotik_password')) {
        monitorPPPoEConnections().catch(err => {
            logger.error('Error starting legacy PPPoE monitoring:', err);
        });
    }
} catch (error) {
    logger.error('Error initializing services:', error);
}

// Initialize Telegram Bot
try {
    const telegramBot = require('./config/telegramBot');

    // Start bot if enabled
    telegramBot.start().then(() => {
        logger.info('Telegram bot initialization completed');
    }).catch(err => {
        logger.error('Error starting Telegram bot:', err);
    });
} catch (error) {
    logger.error('Error initializing Telegram bot:', error);
}

// Add longer delay for WhatsApp reconnect
const RECONNECT_DELAY = 30000; // 30 seconds

// Function to start server only on port configured in settings.json
function startServer(portToUse) {
    // Ensure port is number
    const port = parseInt(portToUse);
    if (isNaN(port) || port < 1 || port > 65535) {
        logger.error(`Invalid port: ${portToUse}`);
        process.exit(1);
    }

    logger.info(`Starting server on configured port: ${port}`);
    logger.info(`Port taken from settings.json - no fallback to alternative port`);

    // Only use port from settings.json, no fallback
    try {
        const server = app.listen(port, () => {
            logger.info(`✅ Server successfully running on port ${port}`);
            logger.info(`🌐 Web Portal available at: http://localhost:${port}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            // Update global.appSettings.port with successfully used port
            // global.appSettings.port = port.toString(); // Delete this
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`❌ ERROR: Port ${port} is already used by another application!`);
                logger.error(`💡 Solution: Stop the application using port ${port} or change the port in settings.json`);
                logger.error(`🔍 Check applications using port: netstat -ano | findstr :${port}`);
            } else {
                logger.error('❌ Error starting server:', err.message);
            }
            process.exit(1);
        });
    } catch (error) {
        logger.error(`❌ Error occurred while starting server:`, error.message);
        process.exit(1);
    }
}

// Start server with port from settings.json
const port = getSetting('server_port', 4555);
logger.info(`Attempting to start server on configured port: ${port}`);

// Start server with port from configuration
startServer(port);

// Auto setup GenieACS DNS for development (DISABLED - using web interface)
// setTimeout(async () => {
//     try {
//        logger.info('🚀 Starting auto setup GenieACS DNS for development...');
//         const result = await autoGenieACSSetup.runAutoSetup();
//         
//         if (result.success) {
//             logger.info('✅ Auto GenieACS DNS setup successful');
//             if (result.data) {
//                 logger.info(`📋 Server IP: ${result.data.serverIP}`);
//                 logger.info(`📋 GenieACS URL: ${result.data.genieacsUrl}`);
//                 logger.info(`📋 Script Mikrotik: ${result.data.mikrotikScript}`);
//             }
//         } else {
//             logger.warn(`⚠️  Auto GenieACS DNS setup: ${result.message}`);
//         }
//     } catch (error) {
//         logger.error('❌ Error in auto GenieACS DNS setup:', error);
//     }
// }, 15000); // Delay 15 seconds after server start

// Add command to add customer number to GenieACS tag
const { addCustomerTag } = require('./config/customerTag');

// Export app for testing
module.exports = app;
