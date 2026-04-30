// pppoe-notifications.js - Module for managing PPPoE login/logout notifications
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getMikrotikConnection } = require('./mikrotik');
const { getSetting, setSetting } = require('./settingsManager');

// Default settings
const defaultSettings = {
    enabled: true,
    loginNotifications: true,
    logoutNotifications: true,
    includeOfflineList: true,
    maxOfflineListCount: 20,
    monitorInterval: 60000, // 1 minute
    lastActiveUsers: []
};

// Store the WhatsApp socket instance
let sock = null;
let monitorInterval = null;
let lastActivePPPoE = [];

// Set the WhatsApp socket instance
function setSock(sockInstance) {
    sock = sockInstance;
    logger.info('WhatsApp socket set in pppoe-notifications module');
}

// Function to get PPPoE notification settings from settings.json
function getPPPoENotificationSettings() {
    return getSetting('pppoe_notifications', {
        enabled: true,
        loginNotifications: true,
        logoutNotifications: true,
        includeOfflineList: true,
        maxOfflineListCount: 20,
        monitorInterval: 60000
    });
}

// Save settings to settings.json
function saveSettings(settings) {
    try {
        // Update settings.json with PPPoE notification settings
        const { getSettingsWithCache } = require('./settingsManager');
        const currentSettings = getSettingsWithCache();
        
        // Update pppoe_notifications settings
        currentSettings['pppoe_notifications.enabled'] = settings.enabled.toString();
        currentSettings['pppoe_notifications.loginNotifications'] = settings.loginNotifications.toString();
        currentSettings['pppoe_notifications.logoutNotifications'] = settings.logoutNotifications.toString();
        currentSettings['pppoe_notifications.includeOfflineList'] = settings.includeOfflineList.toString();
        currentSettings['pppoe_notifications.maxOfflineListCount'] = settings.maxOfflineListCount.toString();
        currentSettings['pppoe_notifications.monitorInterval'] = settings.monitorInterval.toString();
        
        fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
        logger.info('PPPoE notification settings saved to settings.json');
        return true;
    } catch (error) {
        logger.error(`Error saving PPPoE notification settings: ${error.message}`);
        return false;
    }
}

// Get current settings
function getSettings() {
    return getPPPoENotificationSettings();
}

// Update settings
function updateSettings(newSettings) {
    const currentSettings = getPPPoENotificationSettings();
    const updatedSettings = { ...currentSettings, ...newSettings };
    return setSetting('pppoe_notifications', updatedSettings);
}

// Enable/disable notifications
function setNotificationStatus(enabled) {
    return updateSettings({ enabled });
}

// Enable/disable login notifications
function setLoginNotifications(enabled) {
    return updateSettings({ loginNotifications: enabled });
}

// Enable/disable logout notifications
function setLogoutNotifications(enabled) {
    return updateSettings({ logoutNotifications: enabled });
}

// Get admin numbers from settings.json
function getAdminNumbers() {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        // Search admin numbers with format admins.0, admins.1, etc
        const adminNumbers = [];
        let index = 0;
        while (settings[`admins.${index}`]) {
            adminNumbers.push(settings[`admins.${index}`]);
            index++;
        }
        
        // If no format admins.0, try searching admins array
        if (adminNumbers.length === 0 && settings.admins) {
            return settings.admins;
        }
        
        return adminNumbers;
    } catch (error) {
        logger.error(`Error getting admin numbers: ${error.message}`);
        return [];
    }
}

// Get technician numbers from settings.json
async function getTechnicianNumbers() {
    try {
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        
        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);
        
        return new Promise((resolve, reject) => {
            // Get all active technician numbers from database
            const query = `
                SELECT phone, name, role 
                FROM technicians 
                WHERE is_active = 1 
                ORDER BY role, name
            `;
            
            db.all(query, [], (err, rows) => {
                db.close();
                
                if (err) {
                    logger.error(`Error getting technician numbers from database: ${err.message}`);
                    resolve([]);
                    return;
                }
                
                // Extract phone numbers
                const technicianNumbers = rows.map(row => row.phone);
                logger.info(`Found ${technicianNumbers.length} active technicians in database`);
                
                resolve(technicianNumbers);
            });
        });
    } catch (error) {
        logger.error(`Error getting technician numbers: ${error.message}`);
        return [];
    }
}

// Add admin number to settings.json
function addAdminNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (!settings.admins) {
            settings.admins = [];
        }
        
        if (!settings.admins.includes(number)) {
            settings.admins.push(number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Admin number added to settings.json: ${number}`);
            return true;
        }
        return true; // Already exists
    } catch (error) {
        logger.error(`Error adding admin number: ${error.message}`);
        return false;
    }
}

// Add technician number to settings.json
function addTechnicianNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (!settings.technician_numbers) {
            settings.technician_numbers = [];
        }
        
        if (!settings.technician_numbers.includes(number)) {
            settings.technician_numbers.push(number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Technician number added to settings.json: ${number}`);
            return true;
        }
        return true; // Already exists
    } catch (error) {
        logger.error(`Error adding technician number: ${error.message}`);
        return false;
    }
}

// Remove admin number from settings.json
function removeAdminNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (settings.admins) {
            settings.admins = settings.admins.filter(n => n !== number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Admin number removed from settings.json: ${number}`);
            return true;
        }
        return true;
    } catch (error) {
        logger.error(`Error removing admin number: ${error.message}`);
        return false;
    }
}

// Remove technician number from settings.json
function removeTechnicianNumber(number) {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        if (settings.technician_numbers) {
            settings.technician_numbers = settings.technician_numbers.filter(n => n !== number);
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            logger.info(`Technician number removed from settings.json: ${number}`);
            return true;
        }
        return true;
    } catch (error) {
        logger.error(`Error removing technician number: ${error.message}`);
        return false;
    }
}

// Helper function to check WhatsApp connection
async function checkWhatsAppConnection() {
    if (!sock) {
        logger.error('WhatsApp sock instance not set');
        return false;
    }

    try {
        // Check if socket is still connected
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
            return true;
        } else {
            logger.warn('WhatsApp connection is not open');
            return false;
        }
    } catch (error) {
        logger.error(`Error checking WhatsApp connection: ${error.message}`);
        return false;
    }
}

// Helper function to format WhatsApp number
function formatWhatsAppNumber(number) {
    // Remove all non-numeric characters
    let cleanNumber = number.replace(/[^0-9]/g, '');

    // Add country code if not present
    if (cleanNumber.startsWith('0')) {
        cleanNumber = '62' + cleanNumber.substring(1); // Indonesia country code
    } else if (!cleanNumber.startsWith('62')) {
        cleanNumber = '62' + cleanNumber;
    }

    return cleanNumber + '@s.whatsapp.net';
}

// Add timeout configuration for validation function
const VALIDATION_CONFIG = {
    timeout: 5000, // 5 seconds
    maxRetries: 2
};

// Add utility function to handle timeout
function withTimeout(promise, timeoutMs, timeoutMessage = 'Operation timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`${timeoutMessage} after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

// Fix validateWhatsAppNumber function with better timeout handling
async function validateWhatsAppNumber(phoneNumber) {
    try {
        console.log(`[PPPoE-NOTIFICATION] Starting WhatsApp number validation: ${phoneNumber}`);
        
        // Check if WhatsApp socket is available and connected
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] WhatsApp socket unavailable or not connected');
            return { isValid: false, error: 'WhatsApp not connected' };
        }

        // Check if onWhatsApp function is available
        if (typeof global.whatsappSocket.onWhatsApp !== 'function') {
            console.warn('[PPPoE-NOTIFICATION] onWhatsApp function unavailable');
            return { isValid: false, error: 'onWhatsApp function unavailable' };
        }

        // Try several times if timeout occurs
        for (let attempt = 1; attempt <= VALIDATION_CONFIG.maxRetries; attempt++) {
            try {
                console.log(`[PPPoE-NOTIFICATION] Trying to validate WhatsApp number (attempt ${attempt}): ${phoneNumber}`);
                
                // Create promise with timeout
                const validationPromise = global.whatsappSocket.onWhatsApp(phoneNumber);
                
                // Add timeout
                const result = await withTimeout(validationPromise, VALIDATION_CONFIG.timeout, `WhatsApp number validation timeout at attempt ${attempt}`);
                
                console.log(`[PPPoE-NOTIFICATION] Validation successful (attempt ${attempt})`);
                return { isValid: result && result.length > 0, result };
                
            } catch (error) {
                console.warn(`[PPPoE-NOTIFICATION] Attempt ${attempt} failed:`, error.message);
                
                // If this is the last attempt, return error
                if (attempt === VALIDATION_CONFIG.maxRetries) {
                    console.error('[PPPoE-NOTIFICATION] All validation attempts failed:', error.message);
                    return { isValid: false, error: error.message };
                }
                
                // Wait a moment before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Unexpected error while validating WhatsApp number:', error.message);
        return { isValid: false, error: error.message };
    }
}

// Fix sendNotification function to handle timeout better
async function sendNotification(customer, notificationData) {
    try {
        console.log(`[PPPoE-NOTIFICATION] Sending notification to: ${customer.phone}`);
        
        // Check if WhatsApp socket is available
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] Cannot send notification: WhatsApp not connected');
            return { success: false, message: 'WhatsApp not connected' };
        }

        // Format phone number
        const formattedPhone = formatPhoneNumberForWhatsApp(customer.phone);
        if (!formattedPhone) {
            console.warn('[PPPoE-NOTIFICATION] Invalid phone number format:', customer.phone);
            return { success: false, message: 'Invalid phone number format' };
        }

        // Validate WhatsApp number with timeout handling
        const validation = await validateWhatsAppNumber(formattedPhone);
        if (!validation.isValid) {
            console.warn('[PPPoE-NOTIFICATION] WhatsApp Number invalid or cannot be validated:', customer.phone);
            return { success: false, message: 'WhatsApp Number invalid' };
        }

        // Create notification message
        const message = createNotificationMessage(customer, notificationData);
        
        // Check if sendMessage function is available
        if (typeof global.whatsappSocket.sendMessage !== 'function') {
            console.warn('[PPPoE-NOTIFICATION] sendMessage function unavailable');
            return { success: false, message: 'sendMessage function unavailable' };
        }
        
        // Add timeout for message sending
        const sendPromise = global.whatsappSocket.sendMessage(formattedPhone, { text: message });
        const result = await withTimeout(sendPromise, 10000, 'WhatsApp message sending timeout');
        
        console.log('[PPPoE-NOTIFICATION] Notification sent successfully to:', customer.phone);
        return { success: true, result };
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Failed to send WhatsApp notification to:', customer.phone, error.message);
        
        // Do not let error stop the application
        return { success: false, message: error.message };
    }
}

// Get active PPPoE connections
async function getActivePPPoEConnections() {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            logger.error('No Mikrotik connection available for PPPoE monitoring');
            return { success: false, data: [] };
        }
        
        const pppConnections = await conn.write('/ppp/active/print');
        return {
            success: true,
            data: pppConnections
        };
    } catch (error) {
        logger.error(`Error getting active PPPoE connections: ${error.message}`);
        return { success: false, data: [] };
    }
}

// Get offline PPPoE users
async function getOfflinePPPoEUsers(activeUsers) {
    try {
        const conn = await getMikrotikConnection();
        if (!conn) {
            return [];
        }
        
        const pppSecrets = await conn.write('/ppp/secret/print');
        const offlineUsers = pppSecrets.filter(secret => !activeUsers.includes(secret.name));
        return offlineUsers.map(user => user.name);
    } catch (error) {
        logger.error(`Error getting offline PPPoE users: ${error.message}`);
        return [];
    }
}

// Format login notification message
function formatLoginMessage(loginUsers, connections, offlineUsers) {
    const settings = getPPPoENotificationSettings();
    let message = `🔔 *PPPoE LOGIN NOTIFICATION*\n\n`;
    
    message += `📊 *User Login (${loginUsers.length}):*\n`;
    loginUsers.forEach((username, index) => {
        const connection = connections.find(c => c.name === username);
        message += `${index + 1}. *${username}*\n`;
        if (connection) {
            message += `   • IP: ${connection.address || 'N/A'}\n`;
            message += `   • Uptime: ${connection.uptime || 'N/A'}\n`;
        }
        message += '\n';
    });
    
    if (settings.includeOfflineList && offlineUsers.length > 0) {
        const maxCount = settings.maxOfflineListCount;
        const displayCount = Math.min(offlineUsers.length, maxCount);
        
        message += `🚫 *User Offline (${offlineUsers.length}):*\n`;
        for (let i = 0; i < displayCount; i++) {
            message += `${i + 1}. ${offlineUsers[i]}\n`;
        }
        
        if (offlineUsers.length > maxCount) {
            message += `... dan ${offlineUsers.length - maxCount} user lainnya\n`;
        }
    }
    
    message += `\n⏰ ${new Date().toLocaleString()}`;
    return message;
}

// Format logout notification message
function formatLogoutMessage(logoutUsers, offlineUsers) {
    const settings = getPPPoENotificationSettings();
    let message = `🚪 *PPPoE LOGOUT NOTIFICATION*\n\n`;
    
    message += `📊 *User Logout (${logoutUsers.length}):*\n`;
    logoutUsers.forEach((username, index) => {
        message += `${index + 1}. *${username}*\n`;
    });
    
    if (settings.includeOfflineList && offlineUsers.length > 0) {
        const maxCount = settings.maxOfflineListCount;
        const displayCount = Math.min(offlineUsers.length, maxCount);
        
        message += `\n🚫 *Total User Offline (${offlineUsers.length}):*\n`;
        for (let i = 0; i < displayCount; i++) {
            message += `${i + 1}. ${offlineUsers[i]}\n`;
        }
        
        if (offlineUsers.length > maxCount) {
            message += `... dan ${offlineUsers.length - maxCount} user lainnya\n`;
        }
    }
    
    message += `\n⏰ ${new Date().toLocaleString()}`;
    return message;
}

// Function to send PPPoE login notification
async function sendLoginNotification(connection) {
    try {
        console.log('[PPPoE-NOTIFICATION] Sending login notification for:', connection.name);
        
        // Get notification settings
        const settings = getPPPoENotificationSettings();
        
        // If notifications are disabled, stop the process
        if (!settings.enabled) {
            console.log('[PPPoE-NOTIFICATION] Notifications disabled, skipping sending');
            return { success: false, message: 'Notifications disabled' };
        }
        
        // If login notifications are disabled, stop the process
        if (!settings.loginNotifications) {
            console.log('[PPPoE-NOTIFICATION] Login notifications disabled, skipping sending');
            return { success: false, message: 'Login notifications disabled' };
        }
        
        // Get list of admin and technician numbers
        const adminNumbers = getAdminNumbers();
        const technicianNumbers = getTechnicianNumbers();
        const allRecipients = [...new Set([...adminNumbers, ...technicianNumbers])];
        
        // If no recipients, stop the process
        if (allRecipients.length === 0) {
            console.log('[PPPoE-NOTIFICATION] No notification recipients, skipping sending');
            return { success: false, message: 'No notification recipients' };
        }
        
        // Create notification message
        let message = `🔔 *PPPoE LOGIN NOTIFICATION*\n\n`;
        if (connection.routerName || connection.routerId) {
            message += `🧭 *Router:* ${connection.routerName || connection.routerId}\n`;
        }
        message += `👤 *User:* ${connection.name}\n`;
        message += `📍 *IP Address:* ${connection.address || 'N/A'}\n`;
        message += `📈 *Uptime:* ${connection.uptime || 'N/A'}\n`;
        if (connection.comment) {
            message += `📝 *Comment:* ${connection.comment}\n`;
        }
        message += `\n⏰ *Time:* ${new Date().toLocaleString('en-PK')}`;
        
        // Send notification to all recipients
        const results = [];
        for (const phoneNumber of allRecipients) {
            try {
                const result = await sendNotificationToNumber(phoneNumber, message);
                results.push({ phoneNumber, success: result.success, message: result.message });
            } catch (sendError) {
                console.error(`[PPPoE-NOTIFICATION] Failed to send notification to ${phoneNumber}:`, sendError.message);
                results.push({ phoneNumber, success: false, message: sendError.message });
            }
        }
        
        console.log(`[PPPoE-NOTIFICATION] Login notification sent to ${results.filter(r => r.success).length} of ${results.length} recipients`);
        return { success: true, results };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Error sending login notification:', error.message);
        return { success: false, message: error.message };
    }
}

// Function to send PPPoE logout notification
async function sendLogoutNotification(connection) {
    try {
        console.log('[PPPoE-NOTIFICATION] Sending logout notification for:', connection.name);
        
        // Get notification settings
        const settings = getPPPoENotificationSettings();
        
        // If notifications are disabled, stop the process
        if (!settings.enabled) {
            console.log('[PPPoE-NOTIFICATION] Notifications disabled, skipping sending');
            return { success: false, message: 'Notifications disabled' };
        }
        
        // If logout notifications are disabled, stop the process
        if (!settings.logoutNotifications) {
            console.log('[PPPoE-NOTIFICATION] Logout notifications disabled, skipping sending');
            return { success: false, message: 'Logout notifications disabled' };
        }
        
        // Get list of admin and technician numbers
        const adminNumbers = getAdminNumbers();
        const technicianNumbers = getTechnicianNumbers();
        const allRecipients = [...new Set([...adminNumbers, ...technicianNumbers])];
        
        // If no recipients, stop the process
        if (allRecipients.length === 0) {
            console.log('[PPPoE-NOTIFICATION] No notification recipients, skipping sending');
            return { success: false, message: 'No notification recipients' };
        }
        
        // Create notification message
        let message = `🚪 *PPPoE LOGOUT NOTIFICATION*\n\n`;
        if (connection.routerName || connection.routerId) {
            message += `🧭 *Router:* ${connection.routerName || connection.routerId}\n`;
        }
        message += `👤 *User:* ${connection.name}\n`;
        if (connection.comment) {
            message += `📝 *Comment:* ${connection.comment}\n`;
        }
        message += `\n⏰ *Time:* ${new Date().toLocaleString('en-PK')}`;
        
        // Send notification to all recipients
        const results = [];
        for (const phoneNumber of allRecipients) {
            try {
                const result = await sendNotificationToNumber(phoneNumber, message);
                results.push({ phoneNumber, success: result.success, message: result.message });
            } catch (sendError) {
                console.error(`[PPPoE-NOTIFICATION] Failed to send notification to ${phoneNumber}:`, sendError.message);
                results.push({ phoneNumber, success: false, message: sendError.message });
            }
        }
        
        console.log(`[PPPoE-NOTIFICATION] Logout notification sent to ${results.filter(r => r.success).length} of ${results.length} recipients`);
        return { success: true, results };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Error sending logout notification:', error.message);
        return { success: false, message: error.message };
    }
}

// Function to send notification to specific number
async function sendNotificationToNumber(phoneNumber, message) {
    try {
        // Check if WhatsApp socket is available
        if (!global.whatsappSocket || !global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-NOTIFICATION] WhatsApp not connected');
            return { success: false, message: 'WhatsApp not connected' };
        }
        
        // Format phone number
        const formattedPhone = formatWhatsAppNumber(phoneNumber);
        if (!formattedPhone) {
            console.warn('[PPPoE-NOTIFICATION] Invalid phone number format:', phoneNumber);
            return { success: false, message: 'Invalid phone number format' };
        }
        
        // Send message
        await global.whatsappSocket.sendMessage(formattedPhone, { text: message });
        console.log('[PPPoE-NOTIFICATION] Message sent to:', phoneNumber);
        return { success: true, message: 'Message sent' };
        
    } catch (error) {
        console.error('[PPPoE-NOTIFICATION] Failed to send message to:', phoneNumber, error.message);
        return { success: false, message: error.message };
    }
}

module.exports = {
    setSock,
    getPPPoENotificationSettings,
    // Add alias for compatibility:
    getSettings: getPPPoENotificationSettings,
    setNotificationStatus,
    setLoginNotifications,
    setLogoutNotifications,
    getAdminNumbers,
    getTechnicianNumbers,
    addAdminNumber,
    addTechnicianNumber,
    removeAdminNumber,
    removeTechnicianNumber,
    sendNotification,
    sendLoginNotification,
    sendLogoutNotification,
    getActivePPPoEConnections,
    getOfflinePPPoEUsers,
    formatLoginMessage,
    formatLogoutMessage
};
