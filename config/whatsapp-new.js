const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const logger = require('./logger');

// Import modules that have been created
const WhatsAppCore = require('./whatsapp-core');
const WhatsAppCommands = require('./whatsapp-commands');
const WhatsAppMessageHandlers = require('./whatsapp-message-handlers');

// Import other required modules
const genieacsCommands = require('./genieacs-commands');
const mikrotikCommands = require('./mikrotik-commands');
const pppoeCommands = require('./pppoe-commands');
const { handleAddWAN } = require('./addWAN');
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');
const billingCommands = require('./billing-commands');
const whatsappNotifications = require('./whatsapp-notifications');
const { getSetting } = require('./settingsManager');

// Initialize modules
const whatsappCore = new WhatsAppCore();
const whatsappCommands = new WhatsAppCommands(whatsappCore);
const messageHandlers = new WhatsAppMessageHandlers(whatsappCore, whatsappCommands);

// Global variable for WhatsApp status
global.whatsappStatus = whatsappCore.getWhatsAppStatus();

// Function for WhatsApp connection
async function connectToWhatsApp() {
    try {
        console.log('Starting WhatsApp connection...');
        
        // Create session directory
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
            console.log(`WhatsApp session directory created: ${sessionDir}`);
        }
        
        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Configure logging
        const logLevel = getSetting('whatsapp_log_level', 'silent');
        const pinoLogger = pino({ level: logLevel });
        
        // Create WhatsApp socket with better version handling
        let version;
        try {
            const versionResult = await fetchLatestBaileysVersion();
            // Handle various return value types
            if (Array.isArray(versionResult)) {
                version = versionResult;
            } else if (versionResult && Array.isArray(versionResult.version)) {
                version = versionResult.version;
            } else {
                // Fallback to default version if fetching fails
                version = [2, 3000, 1023223821];
            }
            console.log(`📱 Using WhatsApp Web version: ${version.join('.')}`);
        } catch (error) {
            console.warn(`⚠️ Failed to fetch latest WhatsApp version, using fallback:`, error.message);
            version = [2, 3000, 1023223821];
        }

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            logger: pinoLogger,
            browser: ['NBB Wifiber Bot', 'Chrome', '1.0.0'],
            version: version
        });
        
        // Set socket to all modules
        whatsappCore.setSock(sock);
        whatsappCommands.setSock(sock);
        
        // Set socket to other modules
        genieacsCommands.setSock(sock);
        mikrotikCommands.setSock(sock);
        pppoeCommands.setSock(sock);
        
        // Set socket ke notification manager
        try {
            whatsappNotifications.setSock(sock);
        } catch (error) {
            console.error('Error setting sock for WhatsApp notifications:', error);
        }
        
        // Event handlers
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                // Generate QR code
                qrcode.generate(qr, { small: true });
                whatsappCore.updateStatus({ qrCode: qr, status: 'qr_generated' });
                console.log('QR Code generated, please scan');
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error instanceof Boom) && 
                                      (lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut);
                
                console.log(`WhatsApp connection disconnected. Attempting to reconnect: ${shouldReconnect}`);
                
                whatsappCore.updateStatus({ 
                    connected: false, 
                    status: 'disconnected',
                    qrCode: null 
                });
                
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 30000); // 30 seconds delay
                }
            }
            
            if (connection === 'open') {
                console.log('WhatsApp connected!');
                
                // Update status
                whatsappCore.updateStatus({
                    connected: true,
                    status: 'connected',
                    phoneNumber: sock.user?.id?.split(':')[0],
                    connectedSince: new Date(),
                    qrCode: null
                });
                
                // Send notification to admin - DISABLED
                // await sendAdminNotifications(sock);
                
                // Handle welcome message for super admin
                await messageHandlers.handleSuperAdminWelcome(sock);
                
                logger.info('WhatsApp connected successfully');
                
                // Initialize monitoring if needed
                initializeMonitoring();
            }
        });

        return sock;
    } catch (error) {
        logger.error('Error connecting to WhatsApp:', error);
        setTimeout(connectToWhatsApp, 30000); // Retry after 30 seconds
    }
}

// Function to send notification to admin
async function sendAdminNotifications(sock) {
    try {
        const companyHeader = getSetting('company_header', '📱 NBB Wifiber');
        const companyHeaderShort = companyHeader.length > 20 ? companyHeader.substring(0, 20) + '...' : companyHeader;
        
        // Notification to all admins
        const admins = getSetting('admins', []);
        const settings = getSetting('admins', {});
        
        // Add admin from numeric key
        Object.keys(settings).forEach(key => {
            if (key.match(/^\d+$/) && settings[key]) {
                admins.push(settings[key]);
            }
        });
        
        const notificationMessage = `📋 *BOT WHATSAPP ${companyHeaderShort}*\n\n` +
                                  `✅ WhatsApp bot successfully connected!\n` +
                                  `🕐 Time: ${new Date().toLocaleString('en-PK')}\n` +
                                  `🌐 Status: Online\n\n` +
                                  `Type *admin* to see complete menu.`;
        
        for (const adminNumber of admins) {
            try {
                const adminJid = whatsappCore.createJID(adminNumber);
                if (adminJid) {
                    await sock.sendMessage(adminJid, { text: notificationMessage });
                    console.log(`Notification sent to admin: ${adminNumber}`);
                }
            } catch (error) {
                console.error(`Failed to send notification to admin ${adminNumber}:`, error);
            }
        }
        
        // Notification to super admin
        const superAdminNumber = whatsappCore.getSuperAdmin();
        if (superAdminNumber) {
            try {
                const superAdminJid = whatsappCore.createJID(superAdminNumber);
                if (superAdminJid) {
                    const startupMessage = `📋 *BOT WHATSAPP ${companyHeaderShort}*\n\n` +
                                          `🚀 *STARTUP SUCCESSFUL!*\n\n` +
                                          `WhatsApp bot has been successfully started and connected.\n` +
                                          `🕐 Time: ${new Date().toLocaleString('en-PK')}\n` +
                                          `🌐 Status: Online\n\n` +
                                          `All services are ready to use.`;
                    
                    await sock.sendMessage(superAdminJid, { text: startupMessage });
                    console.log('Startup notification sent to super admin');
                }
            } catch (error) {
                console.error(`Failed to send startup notification to super admin:`, error);
            }
        }
        
    } catch (error) {
        console.error('Error sending admin notifications:', error);
    }
}

// Function to initialize monitoring
function initializeMonitoring() {
    try {
        // Initialize PPPoE monitoring if MikroTik is configured
        if (getSetting('mikrotik_host') && getSetting('mikrotik_user') && getSetting('mikrotik_password')) {
            const { monitorPPPoEConnections } = require('./mikrotik');
            monitorPPPoEConnections().then(() => {
                logger.info('PPPoE monitoring initialized');
            }).catch(err => {
                logger.error('Error initializing PPPoE monitoring:', err);
            });
        }
        
        // Initialize RX Power monitoring
        try {
            const rxPowerMonitor = require('./rxPowerMonitor');
            rxPowerMonitor.setSock(whatsappCore.getSock());
            rxPowerMonitor.startRXPowerMonitoring();
            logger.info('RX Power monitoring initialized');
        } catch (err) {
            logger.error('Error initializing RX Power monitoring:', err);
        }
        
    } catch (error) {
        logger.error('Error initializing services:', error);
    }
}

// Function to get WhatsApp status
function getWhatsAppStatus() {
    return whatsappCore.getWhatsAppStatus();
}

// Function to delete WhatsApp session
async function deleteWhatsAppSession() {
    try {
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
            }
            console.log(`Deleting ${files.length} WhatsApp session files`);
        }
        
        console.log('WhatsApp session deleted successfully');
        
        // Reset status
        whatsappCore.updateStatus({
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        });
        
        // Restart connection
        setTimeout(() => {
            console.log('Restarting WhatsApp connection...');
            connectToWhatsApp();
        }, 5000);
        
        return { success: true, message: 'WhatsApp session deleted successfully' };
    } catch (error) {
        console.error('Error deleting WhatsApp session:', error);
        return { success: false, message: error.message };
    }
}

// Export required functions
module.exports = {
    connectToWhatsApp,
    getWhatsAppStatus,
    deleteWhatsAppSession,
    whatsappCore,
    whatsappCommands,
    messageHandlers
};
