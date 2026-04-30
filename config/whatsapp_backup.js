const { Boom } = require('@hapi/boom');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const pino = require('pino');
const logger = require('./logger');
const genieacsCommands = require('./genieacs-commands');

const {
    addHotspotUser,
    addPPPoESecret,
    setPPPoEProfileeeeeeeeee,
    getResourceInfo,
    getActiveHotspotUsers,
    getActivePPPoEConnections,
    deleteHotspotUser,
    deletePPPoESecret,
    getInactivePPPoEUsers,
    getOfflinePPPoEUsers
} = require('./mikrotik');

// Import new MikroTik command handler
const mikrotikCommands = require('./mikrotik-commands');

// Import PPPoE notification command handler
const pppoeCommands = require('./pppoe-commands');

// Import addWAN module
const { handleAddWAN } = require('./addWAN');

// Import customerTag module
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');

// Import admin number from environment
const { ADMIN_NUMBER } = process.env;

// Import settings manager
const { getSetting } = require('./settingsManager');

// Function to decrypt encrypted admin number
function decryptAdminNumber(encryptedNumber) {
    try {
        // This is a simple decryption implementation using XOR with static key
        // In production, use stronger encryption methods
        const key = 'ALIJAYA_SECRET_KEY_2025';
        let result = '';
        for (let i = 0; i < encryptedNumber.length; i++) {
            result += String.fromCharCode(encryptedNumber.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return result;
    } catch (error) {
        console.error('Error decrypting admin number:', error);
        return null;
    }
}

// Read super admin number from external file (optional)
function getSuperAdminNumber() {
    const filePath = path.join(__dirname, 'superadmin.txt');
    if (!fs.existsSync(filePath)) {
        console.warn('⚠️ File superadmin.txt not found, superadmin features disabled');
        return null;
    }
    try {
        const number = fs.readFileSync(filePath, 'utf-8').trim();
        if (!number) {
            console.warn('⚠️ File superadmin.txt is empty, superadmin features disabled');
            return null;
        }
        return number;
    } catch (error) {
        console.error('❌ Error reading superadmin.txt:', error.message);
        return null;
    }
}

const superAdminNumber = getSuperAdminNumber();
let genieacsCommandsEnabled = true;

// Function to check if number is admin or super admin
function isAdminNumber(number) {
    try {
        // Remove all non-digit characters
        const cleanNumber = number.replace(/\D/g, '');
        
        // Log for debugging (only show partial number for security)
        const maskedNumber = cleanNumber.substring(0, 4) + '****' + cleanNumber.substring(cleanNumber.length - 4);
        console.log(`Checking if ${maskedNumber} is admin`);
        
        // Check if number matches super admin
        if (cleanNumber === superAdminNumber) {
            return true;
        }
        // Check if number matches ADMIN_NUMBER from environment
        const adminNumber = process.env.ADMIN_NUMBER?.replace(/\D/g, '');
        if (adminNumber && cleanNumber === adminNumber) {
            return true;
        }
        // Check if number is in TECHNICIAN_NUMBERS from environment
        const technicianNumbers = process.env.TECHNICIAN_NUMBERS?.split(',').map(n => n.trim().replace(/\D/g, '')) || [];
        if (technicianNumbers.includes(cleanNumber)) {
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error in isAdminNumber:', error);
        return false;
    }
}

// Helper to add header and footer to message
function formatWithHeaderFooter(message) {
    try {
        // Get header and footer from settings.json
        const header = getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP');
        const footer = getSetting('footer_info', 'Unlimited Internet');
        
        // Format message with header and footer
        const formattedMessage = `🏢 *${header}*

${message}

${footer}`;
        
        return formattedMessage;
    } catch (error) {
        console.error('Error formatting message with header/footer:', error);
        // Fallback to default format if there is an error
        return `🏢 *ALIJAYA BOT MANAGEMENT ISP*

${message}

Unlimited Internet`;
    }
}

// Helper to send message with header and footer
async function sendFormattedMessage(remoteJid, message, options = {}) {
    try {
        const formattedMessage = formatWithHeaderFooter(message);
        await sock.sendMessage(remoteJid, { text: formattedMessage }, options);
    } catch (error) {
        console.error('Error sending formatted message:', error);
        // Fallback to message without format if there is an error
        await sock.sendMessage(remoteJid, { text: message }, options);
    }
}

let sock = null;
let qrCodeDisplayed = false;

// Add global variables to store QR code and connection status
let whatsappStatus = {
    connected: false,
    qrCode: null,
    phoneNumber: null,
    connectedSince: null,
    status: 'disconnected'
};

// Function to set sock instance
function setSock(sockInstance) {
    sock = sockInstance;
}

// Update parameter paths
const parameterPaths = {
    rxPower: [
        'VirtualParameters.RXPower',
        'VirtualParameters.redaman',
        'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower'
    ],
    pppoeIP: [
        'VirtualParameters.pppoeIP',
        'VirtualParameters.pppIP',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress'
    ],
    ssid: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'
    ],
    uptime: [
        'VirtualParameters.getdeviceuptime',
        'InternetGatewayDevice.DeviceInfo.UpTime'
    ],
    firmware: [
        'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
        'Device.DeviceInfo.SoftwareVersion'
    ],
    // Add path for PPPoE username
    pppUsername: [
        'VirtualParameters.pppoeUsername',
        'VirtualParameters.pppUsername',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username'
    ],
    userConnected: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ],
    userConnected5G: [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations'
    ]
};

// Function to check device status
function getDeviceStatus(lastInform) {
    if (!lastInform) return false;
    const lastInformTime = new Date(lastInform).getTime();
    const currentTime = new Date().getTime();
    const diffMinutes = (currentTime - lastInformTime) / (1000 * 60);
    return diffMinutes < 5; // Online if last inform < 5 minutes
}

// Function to format uptime
function formatUptime(uptime) {
    if (!uptime) return 'N/A';
    
    const seconds = parseInt(uptime);
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    let result = '';
    if (days > 0) result += `${days} days `;
    if (hours > 0) result += `${hours} hours `;
    if (minutes > 0) result += `${minutes} minutes`;
    
    return result.trim() || '< 1 minute';
}

// Update function to get parameter value
function getParameterWithPaths(device, paths) {
    if (!device || !Array.isArray(paths)) return 'N/A';
    
    for (const path of paths) {
        const pathParts = path.split('.');
        let value = device;
        
        for (const part of pathParts) {
            if (!value || !value[part]) {
                value = null;
                break;
            }
            value = value[part];
        }
        
        if (value !== null && value !== undefined && value !== '') {
            // Handle if value is an object
            if (typeof value === 'object') {
                if (value._value !== undefined) {
                    return value._value;
                }
                if (value.value !== undefined) {
                    return value.value;
                }
            }
            return value;
        }
    }
    
    return 'N/A';
}

// Helper function to format phone number
function formatPhoneNumber(number) {
    // Remove all non-digit characters
    let cleaned = number.replace(/\D/g, '');
    
    // If starts with 0, replace with 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
    }
    
    // If 62 is not at the beginning, add it
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    
    return cleaned;
}

// Add simple encryption function
function generateWatermark() {
    const timestamp = new Date().getTime();
    const secretKey = process.env.SECRET_KEY || 'alijaya-digital-network';
    const baseString = `ADN-${timestamp}`;
    // Simple encryption (in practice use stronger encryption)
    return Buffer.from(baseString).toString('base64');
}

// Update message format with hidden watermark
function addWatermarkToMessage(message) {
    const watermark = generateWatermark();
    // Add zero-width characters to message
    return message + '\u200B' + watermark + '\u200B';
}

// Update WhatsApp connection function with better error handling
async function connectToWhatsApp() {
    try {
        console.log('Starting WhatsApp connection...');
        
        // Ensure session directory exists
        const sessionDir = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
        if (!fs.existsSync(sessionDir)) {
            try {
                fs.mkdirSync(sessionDir, { recursive: true });
                console.log(`WhatsApp session directory created: ${sessionDir}`);
            } catch (dirError) {
                console.error(`Error creating session directory: ${dirError.message}`);
                throw new Error(`Failed to create WhatsApp session directory: ${dirError.message}`);
            }
        }
        
        // Use logger with configurable level
        const logLevel = process.env.WHATSAPP_LOG_LEVEL || 'silent';
        const logger = pino({ level: logLevel });
        
        // Create socket with better configuration and error handling
        let authState;
        try {
            authState = await useMultiFileAuthState(sessionDir);
        } catch (authError) {
            console.error(`Error loading WhatsApp auth state: ${authError.message}`);
            throw new Error(`Failed to load WhatsApp authentication state: ${authError.message}`);
        }
        
        const { state, saveCreds } = authState;
        
        // Version handling with better error handling
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

        sock = makeWASocket({
            auth: state,
            logger,
            browser: ['ALIJAYA DIGITAL NETWORK', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 40000,
            defaultQueryTimeoutMs: 30000, // Timeout for query
            retryRequestDelayMs: 1000,
            version: version
        });
        


        // Handle connection updates
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Log connection update
            console.log('Connection update:', update);
            
            // Tangani QR code
            if (qr) {
                // Save QR code in clean format
                global.whatsappStatus = {
                    connected: false,
                    qrCode: qr,
                    phoneNumber: null,
                    connectedSince: null,
                    status: 'qr_code'
                };
                
                // Display QR code in terminal
                console.log('QR Code available, ready to scan');
                qrcode.generate(qr, { small: true });
            }
            
            // Handle connection
            if (connection === 'open') {
                console.log('WhatsApp connected!');
                const connectedSince = new Date();
                
                // Update status global
                global.whatsappStatus = {
                    connected: true,
                    qrCode: null,
                    phoneNumber: sock.user?.id?.split(':')[0] || null,
                    connectedSince: connectedSince,
                    status: 'connected'
                };
                
                // Set sock instance for other modules
                setSock(sock);
                
                // Set sock instance for sendMessage module
                try {
                    const sendMessageModule = require('./sendMessage');
                    sendMessageModule.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for sendMessage:', error);
                }
                
                // Set sock instance for mikrotik-commands module
                try {
                    const mikrotikCommands = require('./mikrotik-commands');
                    mikrotikCommands.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for mikrotik-commands:', error);
                }
                
                // Send message to admin that bot has connected
                try {
                    // Notification message
                    const notificationMessage = `📱 *BOT WHATSAPP ALIJAYA NETWORK*\n\n` +
                    `✅ *Status:* Bot has successfully connected\n` +
                    `📅 *Time:* ${connectedSince.toLocaleString()}\n\n` +
                    `💬 *Available Commands:*\n` +
                    `• Type *menu* to see command list\n` +
                    `• Type *admin* for admin-specific menu\n\n` +
                    `💰 *Developer Support:*\n` +
                    `• E-WALLET: 03036783333\n` +
                    `• BRI: 420601003953531 a.n WARJAYA\n\n` +
                    `👏 Thank you for using our application.\n` +
                    `🏢 *ALIJAYA DIGITAL NETWORK*`;
                    
                    // Send to admin from environment variable
                    const adminNumber = process.env.ADMIN_NUMBER;
                    if (adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${adminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                console.log(`Notification message sent to admin ${adminNumber}`);
                            } catch (error) {
                                console.error('Error sending connection notification to admin:', error);
                            }
                        }, 5000);
                    }
                    
                    // Send to main admin (from .env)
                    if (adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${adminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                const maskedEnvNumber = adminNumber.substring(0, 4) + '****' + adminNumber.substring(adminNumber.length - 4);
                                console.log(`Notification message sent to main admin ${maskedEnvNumber}`);
                            } catch (error) {
                                console.error(`Error sending connection notification to main admin:`, error);
                            }
                        }, 3000);
                    }
                    // Also send to super admin (if different from main admin)
                    const currentSuperAdminNumber = getSuperAdminNumber();
                    if (currentSuperAdminNumber && currentSuperAdminNumber !== adminNumber) {
                        setTimeout(async () => {
                            try {
                                await sock.sendMessage(`${currentSuperAdminNumber}@s.whatsapp.net`, {
                                    text: notificationMessage
                                });
                                const maskedNumber = currentSuperAdminNumber.substring(0, 4) + '****' + currentSuperAdminNumber.substring(currentSuperAdminNumber.length - 4);
                                console.log(`Notification message sent to super admin ${maskedNumber}`);
                            } catch (error) {
                                console.error(`Error sending connection notification to super admin:`, error);
                            }
                        }, 5000);
                    }
                } catch (error) {
                    console.error('Error sending connection notification:', error);
                }
            } else if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`WhatsApp connection disconnected. Attempting to reconnect: ${shouldReconnect}`);
                
                // Update status global
                global.whatsappStatus = {
                    connected: false,
                    qrCode: null,
                    phoneNumber: null,
                    connectedSince: null,
                    status: 'disconnected'
                };
                
                // Reconnect if not due to logout
                if (shouldReconnect) {
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, parseInt(process.env.RECONNECT_INTERVAL) || 5000);
                }
            }
        });
        
        // Handle credentials update
        // Event listener messages.upsert removed because this file is not used
        // Use whatsapp.js as the main file
        
        sock.ev.on('creds.update', saveCreds);
        
        return sock;
    } catch (error) {
        console.error('Error connecting to WhatsApp:', error);
        
        // Try reconnecting after interval
        setTimeout(() => {
            connectToWhatsApp();
        }, parseInt(process.env.RECONNECT_INTERVAL) || 5000);
        
        return null;
    }
}

// Update handler status
async function handleStatusCommand(senderNumber, remoteJid) {
    try {
        console.log(`Running status command for ${senderNumber}`);
        
        // Search device based on sender number
        const device = await getDeviceByNumber(senderNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Device Not Found*\n\nSorry, your device was not found in our system. Please contact admin for assistance.`
            });
            return;
        }
        
        // Get device information
        const deviceId = device._id;
        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        
        // Use existing parameterPaths to get values
        // Get SSID information
        let ssid = 'N/A';
        let ssid5G = 'N/A';
        
        // Try to get SSID directly
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value) {
            ssid = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['1'].SSID._value;
        }
        
        // Try to get 5G SSID directly
        if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['5']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['5'].SSID._value;
        } else if (device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            ssid5G = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }
        
        // Use getParameterWithPaths to get value from existing parameter paths
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        const formattedRxPower = rxPower !== 'N/A' ? `${rxPower} dBm` : 'N/A';
        
        const pppUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
        const ipAddress = getParameterWithPaths(device, parameterPaths.pppoeIP);
        
        // Get connected user information
        let connectedUsers = getParameterWithPaths(device, parameterPaths.userConnected) || '0';
        let connectedUsers5G = getParameterWithPaths(device, parameterPaths.userConnected5G) || '0';
        
        // If both values are available, combine them
        let totalConnectedUsers = connectedUsers;
        if (connectedUsers !== 'N/A' && connectedUsers5G !== 'N/A' && connectedUsers5G !== '0') {
            try {
                totalConnectedUsers = (parseInt(connectedUsers) + parseInt(connectedUsers5G)).toString();
            } catch (e) {
                console.error('Error calculating total connected users:', e);
            }
        }

        // Get list of users connected to SSID 1 (2.4GHz) only, with IP if available
        let associatedDevices = [];
        try {
            // Get from AssociatedDevice (main)
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                        associatedDevices.push({ mac, hostname, ip });
                    }
                }
            }

            // Fallback: If AssociatedDevice is empty, get from Hosts.Host with IEEE802_11 interface and related to SSID 1
            if (associatedDevices.length === 0) {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            const interfaceType = entry?.InterfaceType?._value || entry?.InterfaceType || '';
                            const ssidRef = entry?.SSIDReference?._value || entry?.SSIDReference || '';
                            // Only WiFi SSID 1 (usually contains 'WLANConfiguration.1')
                            if (interfaceType === 'IEEE802_11' && (!ssidRef || ssidRef.includes('WLANConfiguration.1'))) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices SSID 1:', e);
        }
        
        // Get uptime information
        let uptime = getParameterWithPaths(device, parameterPaths.uptime);
        if (uptime !== 'N/A') {
            uptime = formatUptime(uptime);
        }
        
        // Create status message
        let statusMessage = `📊 *DEVICE STATUS*\n\n`;
        statusMessage += `🔹 *Status:* ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
        statusMessage += `🔹 *Last Online:* ${lastInform.toLocaleString()}\n`;
        statusMessage += `🔹 *WiFi 2.4GHz:* ${ssid}\n`;
        statusMessage += `🔹 *WiFi 5GHz:* ${ssid5G}\n`;
        statusMessage += `🔹 *Connected Users:* ${totalConnectedUsers}\n`;
        // Add SSID 1 user details if available
        if (associatedDevices.length > 0) {
            statusMessage += `└─ *SSID 1 (2.4GHz) User List:*\n`;
            associatedDevices.forEach((dev, idx) => {
                statusMessage += `   ${idx + 1}. ${dev.hostname} (${dev.ip}) - ${dev.mac}\n`;
            });
        } else {
            statusMessage += `└─ No WiFi users connected to SSID 1 (2.4GHz)\n`;
        }
        
        // Add RX Power with quality indicator
        if (rxPower !== 'N/A') {
            const rxValue = parseFloat(rxPower);
            let qualityIndicator = '';
            if (rxValue > -25) qualityIndicator = ' (🟢 Good)';
            else if (rxValue > -27) qualityIndicator = ' (🟠 Warning)';
            else qualityIndicator = ' (🔴 Critical)';
            statusMessage += `🔹 *RX Power:* ${formattedRxPower}${qualityIndicator}\n`;
        } else {
            statusMessage += `🔹 *RX Power:* ${formattedRxPower}\n`;
        }
        
        statusMessage += `🔹 *PPPoE Username:* ${pppUsername}\n`;
        statusMessage += `🔹 *IP Address:* ${ipAddress}\n`;
        
        // Add uptime if available
        if (uptime !== 'N/A') {
            statusMessage += `🔹 *Uptime:* ${uptime}\n`;
        }
        statusMessage += `\n`;
        
        // Add additional information
        statusMessage += `ℹ️ To change WiFi name, type:\n`;
        statusMessage += `*gantiwifi [nama]*\n\n`;
        statusMessage += `ℹ️ To change WiFi password, type:\n`;
        statusMessage += `*gantipass [password]*\n\n`;
        
        // Send status message with header and footer
        await sendFormattedMessage(remoteJid, statusMessage);
        console.log(`Status message sent to ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending status message:', error);
        
        // Send error message with header and footer
        await sendFormattedMessage(remoteJid, `❌ *Error*\n\nAn error occurred while retrieving device status. Please try again later.`);
        
        return false;
    }
}

// Function to check if number is admin or super admin
function isAdminNumber(number) {
    try {
        const cleanNumber = number.replace(/\D/g, '');
        if (cleanNumber === superAdminNumber) {
            return true;
        }
        const adminNumber = process.env.ADMIN_NUMBER?.replace(/\D/g, '');
        if (adminNumber && cleanNumber === adminNumber) {
            return true;
        }
        const technicianNumbers = process.env.TECHNICIAN_NUMBERS?.split(',').map(n => n.trim().replace(/\D/g, '')) || [];
        if (technicianNumbers.includes(cleanNumber)) {
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error in isAdminNumber:', error);
        return false;
    }
}

// Update help handler for customer
async function handleHelpCommand(remoteJid, isAdmin = false) {
    try {
        let helpMessage = `🤖 *MENU GENIEACS & MIKROTIK*\n
*General Commands:*
• 📝 *menu* — Show this menu
• 📶 *status* — Check your device status
• 🔄 *refresh* — Refresh your device data
• 📝 *gantiwifi [name]* — Change WiFi name
• 🔒 *gantipass [password]* — Change WiFi password
• 📱 *devices* — View WiFi connected devices
• 📊 *speedtest* — Device bandwidth info
• 🔧 *diagnostic* — Network diagnostics
• 📊 *history* — Connection history
• 🔄 *restart* — Restart device (requires confirmation)
• ⚠️ *factory reset* — Factory reset (requires confirmation)
`;

        if (isAdmin) {
            helpMessage += `
*Menu Admin:*

🖥️ *Device Management:*
▸ *admin* — Show admin menu
▸ *cek [number]* — Check customer ONU status
▸ *detail [number]* — Complete device details
▸ *list* — List all ONUs
▸ *cekall* — Check all ONU status

📶 *Management WiFi:*
▸ *editssid [number] [ssid]* — Edit customer SSID
▸ *editpass [number] [password]* — Edit customer WiFi password

🔧 *Kontrol Device:*
▸ *adminrestart [number]* — Restart customer device
▸ *adminfactory [number]* — Factory reset customer device

🌐 *Management Hotspot:*
▸ *addhotspot [user] [pass] [profile]* — Add user hotspot
▸ *delhotspot [user]* — Delete user hotspot
▸ *hotspot* — View active hotspot users

📡 *Management PPPoE:*
▸ *addpppoe [user] [pass] [profile] [ip]* — Add secret PPPoE
▸ *delpppoe [user]* — Delete secret PPPoE
▸ *setprofile [user] [profile]* — Edit PPPoE profile
▸ *pppoe* — View active PPPoE connections
▸ *offline* — View offline PPPoE users

🔌 *Management Interface:*
▸ *interfaces* — List all interfaces
▸ *interface [name]* — Specific interface details
▸ *enableif [name]* — Enable interface
▸ *disableif [name]* — Disable interface

🌐 *Management IP & Route:*
▸ *ipaddress* — List IP address
▸ *routes* — List routing table
▸ *dhcp* — List DHCP leases

👥 *Management User & Profileeeeeeeeee:*
▸ *users* — Summary of all users
▸ *profiles [type]* — List profile (pppoe/hotspot/all)

🛡️ *Firewall & Security:*
▸ *firewall [chain]* — List firewall rules

🔧 *Tools & Monitoring:*
▸ *ping [host] [count]* — Ping to host
▸ *logs [topics] [count]* — System logs
▸ *resource* — Info resource router
▸ *debug resource* — Debug raw resource data
▸ *clock* — Router time
▸ *identity [name]* — Router identity

⚙️ *System Management:*
▸ *reboot* — Restart router (requires confirmation)

📢 *Notifikasi PPPoE:*
▸ *pppoe on* — Enable PPPoE notifications
▸ *pppoe off* — Disable PPPoE notifications
▸ *pppoe status* — PPPoE notification status
▸ *pppoe addadmin [number]* — Add admin number
▸ *pppoe addtech [number]* — Add technician number
▸ *pppoe removeadmin [number]* — Delete admin number
▸ *pppoe removetech [number]* — Delete technician number
▸ *pppoe interval [seconds]* — Edit monitoring interval
▸ *pppoe test* — Test notification

🔌 *Management WAN:*
▸ *addwan [number] [type] [mode]* — Add WAN configuration
  ↳ Type: ppp or ip
  ↳ Mode: bridge or route
  ↳ Example: addwan 081234567890 ppp route

⚙️ *Settings Bot:*
▸ *setheader [new_header_text]* — Change bot message header
   Example: setheader ALIJAYA HOTSPOT
▸ *setfooter [new_footer_text]* — Change bot message footer
   Example: setfooter Powered by Alijaya Digital Network
▸ *setadmin [new_admin_number]* — Change main admin
   Example: setadmin 6281234567890
▸ *settechnician [number1,number2,...]* — Change technician list
   Example: settechnician 6281234567890,6289876543210
▸ *setgenieacs [url] [username] [password]* — Change GenieACS configuration
   Example: setgenieacs http://192.168.8.89:7557 admin admin
▸ *setmikrotik [host] [port] [user] [password]* — Change Mikrotik configuration
   Example: setmikrotik 192.168.8.1 8728 admin admin
`;
        }

        helpMessage += `
📱 *Bot Version:* v1.0.0
🏢 *ALIJAYA HOTSPOT*`;

        await sendFormattedMessage(remoteJid, helpMessage);
        return true;
    } catch (error) {
        console.error('Error sending help message:', error);
        return false;
    }
}

// Function to display admin menu
async function sendAdminMenuList(remoteJid) {
        try {
            console.log(`Displaying admin menu to ${remoteJid}`);
            
            // Use help message from separate file
            const adminMessage = getAdminHelpMessage();
            
            // Send admin menu message
            await sock.sendMessage(remoteJid, { text: adminMessage });
            console.log(`Admin menu message sent to ${remoteJid}`);
            
        } catch (error) {
            console.error('Error sending admin menu:', error);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nAn error occurred while displaying admin menu:\n${error.message}` 
            });
        }
}

// Update getDeviceByNumber function
async function getDeviceByNumber(number) {
    try {
        console.log(`Searching device for number ${number}`);
        
        // Clean number from non-digit characters
        let cleanNumber = number.replace(/\D/g, '');
        
        // Format number in several variations that might be used as tags
        const possibleFormats = [];
        
        // Format 1: Original cleaned number
        possibleFormats.push(cleanNumber);
        
        // Format 2: If starts with 0, try version with 62 in front (replace 0 with 62)
        if (cleanNumber.startsWith('0')) {
            possibleFormats.push('62' + cleanNumber.substring(1));
        }
        
        // Format 3: If starts with 62, try version with 0 in front (replace 62 with 0)
        if (cleanNumber.startsWith('62')) {
            possibleFormats.push('0' + cleanNumber.substring(2));
        }
        
        // Format 4: Without prefix, if there is a prefix
        if (cleanNumber.startsWith('0') || cleanNumber.startsWith('62')) {
            if (cleanNumber.startsWith('0')) {
                possibleFormats.push(cleanNumber.substring(1));
            } else if (cleanNumber.startsWith('62')) {
                possibleFormats.push(cleanNumber.substring(2));
            }
        }
        
        console.log(`Trying the following number formats: ${possibleFormats.join(', ')}`);
        
        // Try searching with all possible formats
        for (const format of possibleFormats) {
            try {
                const device = await findDeviceByTag(format);
                if (device) {
                    console.log(`Device found with number tag: ${format}`);
                    return device;
                }
            } catch (formatError) {
                console.log(`Failed to search with format ${format}: ${formatError.message}`);
                // Continue to next format
            }
        }
        
        console.log(`Device not found for number ${number} with all formats tried`);
        return null;
    } catch (error) {
        console.error('Error getting device by number:', error);
        return null;
    }
}

// Add handler for refresh button
async function handleRefreshCommand(senderNumber, remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send message that refresh process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *REFRESH PROCESS*\n\nUpdating device information...\nPlease wait a moment.` 
        });

        // Search device based on sender number
        const device = await getDeviceByNumber(senderNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *DEVICE NOT FOUND*\n\nSorry, unable to find device associated with your number.` 
            });
            return;
        }

        // Perform device refresh 
        const deviceId = device._id;
        console.log(`Refreshing device ID: ${deviceId}`);
        const refreshResult = await refreshDevice(deviceId);

        if (refreshResult.success) {
            // Wait a moment to ensure data has been updated
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Get latest data 
            try {
                const updatedDevice = await getDeviceByNumber(senderNumber);
                const model = updatedDevice.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 'N/A';
                const serialNumber = updatedDevice.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'N/A';
                const lastInform = new Date(updatedDevice._lastInform).toLocaleString();
                
                await sock.sendMessage(remoteJid, { 
                    text: `✅ *REFRESH SUCCESS*\n\n` +
                          `Device updated successfully!\n\n` +
                          `📱 *Device Details:*\n` +
                          `• Serial Number: ${serialNumber}\n` +
                          `• Model: ${model}\n` +
                          `• Last Inform: ${lastInform}\n\n` +
                          `Use *status* command to view complete device information.`
                });
            } catch (updateError) {
                console.error('Error getting updated device info:', updateError);
                
                // Still send success message even if failed to get latest info
                await sock.sendMessage(remoteJid, { 
                    text: `✅ *REFRESH SUCCESS*\n\n` +
                          `Device updated successfully!\n\n` +
                          `Use *status* command to view complete device information.`
                });
            }
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *REFRESH FAILED*\n\n` +
                      `An error occurred while updating device:\n` +
                      `${refreshResult.message || 'Unknown error'}\n\n` +
                      `Please try again later or contact admin.`
            });
        }
    } catch (error) {
        console.error('Error in handleRefreshCommand:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nAn error occurred while processing command:\n${error.message}`
        });
    }
}

// Function to perform device refresh
async function refreshDevice(deviceId) {
    try {
        console.log(`Refreshing device with ID: ${deviceId}`);
        
        // 1. Ensure deviceId is valid and properly encoded
        if (!deviceId) {
            return { success: false, message: "Device ID invalid" };
        }
        
        // 2. Try to get device first to ensure ID is valid
        const genieacsUrl = process.env.GENIEACS_URL || 'http://localhost:7557';
        
        // Check if device exists
        try {
            const checkResponse = await axios.get(`${genieacsUrl}/devices?query={"_id":"${deviceId}"}`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            if (!checkResponse.data || checkResponse.data.length === 0) {
                console.error(`Device with ID ${deviceId} not found`);
                return { success: false, message: "Device not found in system" };
            }
            
            // Ensure we use the correct ID from response
            const exactDeviceId = checkResponse.data[0]._id;
            console.log(`Using exact device ID: ${exactDeviceId}`);
            
            // Use correct URI encoding
            const encodedDeviceId = encodeURIComponent(exactDeviceId);
            
            // 3. Send refresh request with empty parameter object
            console.log(`Sending refresh task to: ${genieacsUrl}/devices/${encodedDeviceId}/tasks`);
            
            const refreshResponse = await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice" // Use root object
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log(`Refresh response status: ${refreshResponse.status}`);
            return { success: true, message: "Device updated successfully" };
            
        } catch (checkError) {
            console.error(`Error checking device: ${checkError.message}`);
            
            // Alternative approach: Send refreshObject without checking first
            console.log(`Trying alternative approach for device ${deviceId}`);
            
            try {
                // Try several URI formats for deviceId
                // 1. Try using encodeURIComponent
                const encodedDeviceId1 = encodeURIComponent(deviceId);
                // 2. Try replacing special characters manually
                const encodedDeviceId2 = deviceId.replace(/:/g, '%3A').replace(/\//g, '%2F');
                
                const attempts = [encodedDeviceId1, encodedDeviceId2, deviceId];
                
                for (const attemptedId of attempts) {
                    try {
                        console.log(`Trying refresh with ID format: ${attemptedId}`);
                        const response = await axios.post(
                            `${genieacsUrl}/devices/${attemptedId}/tasks`,
                            {
                                name: "refreshObject",
                                objectName: ""  // Empty to refresh all
                            },
                            {
                                auth: {
                                    username: process.env.GENIEACS_USERNAME,
                                    password: process.env.GENIEACS_PASSWORD
                                },
                                timeout: 5000
                            }
                        );
                        
                        console.log(`Refresh successful with ID format: ${attemptedId}`);
                        return { success: true, message: "Device updated successfully" };
                    } catch (attemptError) {
                        console.error(`Failed with ID format ${attemptedId}: ${attemptError.message}`);
                        // Continue to next attempt
                    }
                }
                
                throw new Error("All refresh attempts failed");
            } catch (altError) {
                console.error(`All refresh attempts failed: ${altError.message}`);
                throw altError;
            }
        }
        
    } catch (error) {
        console.error('Error refreshing device:', error);
        
        // Provide more specific error response
        let errorMessage = "Unknown error";
        
        if (error.response) {
            errorMessage = `Error ${error.response.status}: ${error.response.data || 'No response data'}`;
        } else if (error.request) {
            errorMessage = "No response from GenieACS server";
        } else {
            errorMessage = error.message;
        }
        
        return { 
            success: false, 
            message: `Failed to update device: ${errorMessage}` 
        };
    }
}

// Add handler for admin menu
async function handleAdminMenu(remoteJid) {
    // handleAdminMenu only calls sendAdminMenuList, no changes needed
    await sendAdminMenuList(remoteJid);
}

// Update admin check ONU handler
async function handleAdminCheckONU(remoteJid, customerNumber) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (!customerNumber) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `admincheck [customer_number]\n\n` +
                  `Example:\n` +
                  `admincheck 123456`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *SEARCHING DEVICE*\n\nSearching device for customer ${customerNumber}...\nPlease wait a moment.` 
        });

        // Search device based on customer number
        const device = await findDeviceByTag(customerNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *DEVICE NOT FOUND*\n\n` +
                      `Unable to find device for customer with number ${customerNumber}.\n\n` +
                      `Please ensure the customer number is correct and the device is registered in the system.`
            });
            return;
        }

        // Extract device information - Use the same approach as web dashboard
        // Try to get from various possible paths to ensure consistency with dashboard
        let serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 
                          device.Device?.DeviceInfo?.SerialNumber?._value || 
                          device.DeviceID?.SerialNumber || 
                          device._id?.split('-')[2] || 'Unknown';
        
        // Try to get model from various possible paths
        let modelName = device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || 
                        device.Device?.DeviceInfo?.ModelName?._value || 
                        device.DeviceID?.ProductClass || 
                        device._id?.split('-')[1] || 'Unknown';
        
        const lastInform = new Date(device._lastInform);
        const now = new Date();
        const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
        const isOnline = diffMinutes < 15;
        const statusText = isOnline ? '🟢 Online' : '🔴 Offline';
        
        // WiFi Information
        const ssid = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        const ssid5G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.SSID?._value || 'N/A';
        
        // IP Information
        const ipAddress = device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.ExternalIPAddress?._value || 'N/A';
        
        // PPPoE Information
        const pppoeUsername = 
            device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value ||
            device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value ||
            device.VirtualParameters?.pppoeUsername?._value ||
            'N/A';
        
        // Get RX Power from all possible paths
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        let rxPowerStatus = '';
        if (rxPower !== 'N/A') {
            const power = parseFloat(rxPower);
            if (power > -25) rxPowerStatus = '🟢 Good';
            else if (power > -27) rxPowerStatus = '🟠 Warning';
            else rxPowerStatus = '🔴 Critical';
        }
        
        // WiFi user information
        const users24ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.TotalAssociations?._value || 0;
        const users5ghz = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[5]?.TotalAssociations?._value || 0;
        const totalUsers = parseInt(users24ghz) + parseInt(users5ghz);

        // Get list of users connected to SSID 1 (2.4GHz)
        let associatedDevices = [];
        try {
            const assocObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.AssociatedDevice;
            if (assocObj && typeof assocObj === 'object') {
                for (const key in assocObj) {
                    if (!isNaN(key)) {
                        const entry = assocObj[key];
                        const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                        const hostname = entry?.HostName?._value || entry?.HostName || '-';
                        associatedDevices.push({ mac, hostname });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing associated devices (admin):', e);
        }
        // Fallback: if AssociatedDevice is empty, get from Hosts.Host (only WiFi/802.11)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Only display those with 802.11 interface (WiFi)
                            const iface = entry?.InterfaceType?._value || entry?.InterfaceType || entry?.Interface || '-';
                            // Ensure iface is string before calling toLowerCase()
                            if (iface && typeof iface === 'string' && iface.toLowerCase().includes('802.11')) {
                                const mac = entry?.MACAddress?._value || entry?.MACAddress || '-';
                                const hostname = entry?.HostName?._value || entry?.HostName || '-';
                                const ip = entry?.IPAddress?._value || entry?.IPAddress || '-';
                                associatedDevices.push({ mac, hostname, ip });
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing Hosts.Host (admin):', e);
            }
        }

        // Create message with complete information
        // Use serial number and model that were retrieved earlier
        // No need to change values that were already retrieved correctly

        let message = `📱 *CUSTOMER DEVICE DETAILS*\n\n`;
        message += `👤 *Customer:* ${customerNumber}\n`;
        message += `📱 *Serial Number:* ${serialNumber}\n`;
        message += `📱 *Model:* ${modelName}\n`;
        message += `📡 *Status:* ${statusText}\n`;
        message += `⏱️ *Last Seen:* ${lastInform.toLocaleString()}\n\n`;
        
        message += `🌐 *NETWORK INFORMATION*\n`;
        message += `🔹 IP Address: ${ipAddress}\n`;
        message += `🔹 PPPoE Username: ${pppoeUsername}\n`;
        message += `🔹 *RX Power:* ${rxPower ? rxPower + ' dBm' : 'N/A'}${rxPowerStatus ? ' (' + rxPowerStatus + ')' : ''}\n`;
        message += `🔹 WiFi 2.4GHz: ${ssid}\n`;
        message += `🔹 WiFi 5GHz: ${ssid5G}\n`;
        message += `🔹 User WiFi: ${totalUsers} devices\n`;
        // Add SSID 1 user details if available
        if (associatedDevices.length > 0) {
            message += `└─ *WiFi User List (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `└─ No WiFi user data (2.4GHz) available\n`;
        }
        message += `\n`;
        
        if (rxPower) {
            message += `📶 *SIGNAL QUALITY*\n`;
            message += `• RX Power: ${rxPower} dBm (${rxPowerStatus})\n\n`;
        }
        
        message += `💡 *ADMIN ACTIONS*\n`;
        message += `• Change SSID: editssid ${customerNumber} [new_name]\n`;
        message += `• Change Password: editpass ${customerNumber} [new_password]\n`;
        message += `• Refresh Device: adminrefresh ${customerNumber}`;

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleAdminCheckONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nAn error occurred while checking device:\n${error.message}`
        });
    }
}

// Function to search device by tag
async function findDeviceByTag(tag) {
    try {
        console.log(`Searching for device with tag: ${tag}`);
        
        // Try searching with direct query
        try {
            // First try with exact match query
            const exactResponse = await axios.get(`${process.env.GENIEACS_URL}/devices/?query={"_tags":"${tag}"}`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            if (exactResponse.data && exactResponse.data.length > 0) {
                console.log(`Device found with exact tag match: ${tag}`);
                return exactResponse.data[0];
            }
            
            // If not found with exact match, try with partial match
            console.log(`No exact match found for tag ${tag}, trying partial match...`);
            const partialResponse = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Search device with partial tag match
            if (partialResponse.data && partialResponse.data.length > 0) {
                for (const device of partialResponse.data) {
                    if (device._tags && Array.isArray(device._tags)) {
                        // Check if there is a tag containing the searched number
                        const matchingTag = device._tags.find(t => 
                            t === tag || // Exact match
                            t.includes(tag) || // Tag contains number
                            tag.includes(t) // Number contains tag (if tag is partial number)
                        );
                        
                        if (matchingTag) {
                            console.log(`Device found with partial tag match: ${matchingTag}`);
                            return device;
                        }
                    }
                }
            }
            
            console.log(`No device found with tag containing: ${tag}`);
            return null;
            
        } catch (queryError) {
            console.error('Error with tag query:', queryError.message);
            
            // If failed, try alternative method by getting all devices
            console.log('Trying alternative method: fetching all devices');
            const allDevicesResponse = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Search device with matching tag
            const device = allDevicesResponse.data.find(d => {
                if (!d._tags) return false;
                
                // Check if there is a matching tag
                return d._tags.some(t => 
                    t === tag || // Exact match
                    t.includes(tag) || // Tag contains number
                    tag.includes(t) // Number contains tag
                );
            });
            
            return device || null;
        }
    } catch (error) {
        console.error('Error finding device by tag:', error);
        throw error;
    }
}

// Handler for customer SSID change
async function handleChangeSSID(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change SSID request from ${senderNumber} with params:`, params);
        
        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *NUMBER NOT REGISTERED*

Oops, your number is not registered yet.
Please contact admin to register!${getSetting('footer_info', 'Unlimited Internet')}` 
            });
            return;
        }

        if (params.length < 1) {
            // Send template for WiFi name input
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *HOW TO CHANGE WIFI NAME*

 Command Format:
*gantiwifi [new_wifi_name]*

 Example:
*gantiwifi MyHome*

 WiFi name will be updated immediately
 Wait a few moments for the change to take effect
 Connected devices may disconnect${getSetting('footer_info', 'Unlimited Internet')}`,
            });
            return;
        }

        const newSSID = params.join(' ');
        const newSSID5G = `${newSSID}-5G`;

        // Send message that the request is being processed
        await sock.sendMessage(remoteJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *REQUEST IN PROGRESS*

Updating your WiFi name...
 WiFi 2.4GHz: ${newSSID}
 WiFi 5GHz: ${newSSID5G}

Please wait a moment.${getSetting('footer_info', 'Unlimited Internet')}`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update SSID 2.4GHz only at index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // only index 1 for 2.4GHz
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );

        // Update SSID 5GHz only at index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('No valid 5GHz SSID configuration found. 5GHz SSID not changed.');
        }

        // Add refresh task
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot device to apply changes
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        let responseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *WIFI NAME CHANGED SUCCESSFULLY!*

 WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            responseMessage += `\n WiFi 5GHz: ${newSSID5G}`;
        } else {
            responseMessage += `\n WiFi 5GHz: Settings not found or failed to change`;
        }

        responseMessage += `\n
Device will restart to apply changes.
Connected devices will disconnect and need to reconnect with the new WiFi name.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Unlimited Internet')}`;

        await sock.sendMessage(remoteJid, { text: responseMessage });

    } catch (error) {
        console.error('Error handling change SSID:', error);
        await sock.sendMessage(remoteJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *FAILED TO CHANGE WIFI NAME*

Oops! There was a technical issue while changing your WiFi name.
Some possible causes:
• Router is offline
• Connection issues to the server
• Name format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Unlimited Internet')}` 
        });
    }
}

// Handler for admin to change customer WiFi password
async function handleAdminEditPassword(adminJid, customerNumber, newPassword) {
    try {
        console.log(`Admin changing WiFi password for customer ${customerNumber}`);

        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(adminJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *PASSWORD TOO SHORT*

WiFi password must be at least 8 characters.
Please try again with a longer password.${getSetting('footer_info', 'Unlimited Internet')}`
            });
            return;
        }

        // Format customer number for searching in GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Searching device for number: ${formattedNumber}`);

        // Search for customer device
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *CUSTOMER NUMBER NOT FOUND*

Number ${customerNumber} is not registered in the system.
Please check the customer number again.${getSetting('footer_info', 'Unlimited Internet')}` 
            });
            return;
        }

        // Send message to admin that the request is being processed
        await sock.sendMessage(adminJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *REQUEST IN PROGRESS*

Changing WiFi password for customer ${customerNumber}...
New password: ${newPassword}

Please wait a moment.${getSetting('footer_info', 'Unlimited Internet')}`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update WiFi 2.4GHz password at index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );

        // Update WiFi 5GHz password at index 5, 6, 7, 8
        let wifi5GFound = false;
        const wifi5gIndexes = [5, 6, 7, 8];
        for (const idx of wifi5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz password using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz password using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
            }
        }

        // Add refresh task
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot device to apply changes
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Message to admin
        const adminResponseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *WIFI PASSWORD CHANGED SUCCESSFULLY!*

 *Customer:* ${customerNumber}
 *New WiFi Password:* ${newPassword}

Device will restart to apply changes.
Connected devices will disconnect and need to reconnect with the new password.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Unlimited Internet')}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });

        // Send notification to customer about WiFi password change
        try {
            // Format customer number for WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Already in JID format
            } else {
                // Format number for WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }

            // Notification message for customer
            const customerNotificationMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *NOTIFICATION OF WIFI PASSWORD CHANGE*

Hello Customer,

We inform you that your WiFi password has been changed by the admin:

 *New WiFi Password:* ${newPassword}

Device will restart to apply changes.
Connected devices will disconnect and need to reconnect with the new password.

_Notes: Save this information as documentation in case you forget your WiFi password later._${getSetting('footer_info', 'Unlimited Internet')}`;

            await sock.sendMessage(customerJid, { text: customerNotificationMessage });
            console.log(`Notification sent to customer ${customerNumber} about WiFi password change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Send message to admin that notification to customer failed
            await sock.sendMessage(adminJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *INFO*

WiFi password changed successfully, but failed to send notification to customer.
Error: ${notificationError.message}${getSetting('footer_info', 'Unlimited Internet')}` 
            });
        }

    } catch (error) {
        console.error('Error handling admin edit password:', error);
        await sock.sendMessage(adminJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *FAILED TO CHANGE WIFI PASSWORD*

Oops! There was a technical issue while changing the customer's WiFi password.
Some possible causes:
• Customer's router is offline
• Connection issues to the server
• Password format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Unlimited Internet')}` 
        });
    }
}

// Handler for admin to change customer SSID
async function handleAdminEditSSID(adminJid, customerNumber, newSSID) {
    try {
        console.log(`Admin changing SSID for customer ${customerNumber} to ${newSSID}`);

        // Format customer number for searching in GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Searching device for number: ${formattedNumber}`);

        // Search for customer device
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *CUSTOMER NUMBER NOT FOUND*

Number ${customerNumber} is not registered in the system.
Please check the customer number again.${getSetting('footer_info', 'Unlimited Internet')}` 
            });
            return;
        }

        // Create 5GHz SSID based on 2.4GHz SSID
        const newSSID5G = `${newSSID}-5G`;

        // Send message to admin that the request is being processed
        await sock.sendMessage(adminJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *REQUEST IN PROGRESS*

Changing WiFi name for customer ${customerNumber}...
 WiFi 2.4GHz: ${newSSID}
 WiFi 5GHz: ${newSSID5G}

Please wait a moment.${getSetting('footer_info', 'Unlimited Internet')}`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update SSID 2.4GHz at index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );

        // Update SSID 5GHz at index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }

        // Add refresh task
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }

        // Reboot device to apply changes
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Message to admin
        let adminResponseMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *WIFI NAME CHANGED SUCCESSFULLY!*

 *Customer:* ${customerNumber}
 *New WiFi Name:*
 WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            adminResponseMessage += `\n WiFi 5GHz: ${newSSID5G}`;
        } else {
            adminResponseMessage += `\n WiFi 5GHz: Settings not found or failed to change`;
        }

        adminResponseMessage += `\n
Device will restart to apply changes.
Connected devices will disconnect and need to reconnect with the new WiFi name.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Unlimited Internet')}`;

        await sock.sendMessage(adminJid, { text: adminResponseMessage });

        // Send notification to customer about SSID change
        try {
            // Format customer number for WhatsApp
            let customerJid;
            if (customerNumber.includes('@')) {
                customerJid = customerNumber; // Already in JID format
            } else {
                // Format number for WhatsApp
                const cleanNumber = customerNumber.replace(/\D/g, '');
                customerJid = `${cleanNumber}@s.whatsapp.net`;
            }

            // Notification message for customer
            const customerNotificationMessage = `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *NOTIFICATION OF WIFI NAME CHANGE*

Hello Customer,

We inform you that your WiFi name has been changed by the admin:

 *New WiFi Name:*
 WiFi 2.4GHz: ${newSSID}`;
            
            let fullCustomerMessage = customerNotificationMessage;
            if (wifi5GFound) {
                fullCustomerMessage += `\n WiFi 5GHz: ${newSSID5G}`;
            }

            fullCustomerMessage += `\n
Device will restart to apply changes.
Connected devices will disconnect and need to reconnect with the new WiFi name.

_Notes: Save this information as documentation in case you forget your WiFi name later._${getSetting('footer_info', 'Unlimited Internet')}`;

            await sock.sendMessage(customerJid, { text: fullCustomerMessage });
            console.log(`Notification sent to customer ${customerNumber} about SSID change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Send message to admin that notification to customer failed
            await sock.sendMessage(adminJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *INFO*

WiFi name changed successfully, but failed to send notification to customer.
Error: ${notificationError.message}${getSetting('footer_info', 'Unlimited Internet')}` 
            });
        }

    } catch (error) {
        console.error('Error handling admin edit SSID:', error);
        await sock.sendMessage(adminJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *FAILED TO CHANGE WIFI NAME*

Oops! There was a technical issue while changing the customer's WiFi name.
Some possible causes:
• Customer's router is offline
• Connection issues to the server
• Name format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Unlimited Internet')}` 
        });
    }
}

// Handler for customer to change password
async function handleChangePassword(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change password request from ${senderNumber} with params:`, params);

        // Validate parameters
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *INCORRECT FORMAT*

 Command Format:
*gantipass [new_password]*

 Example:
*gantipass Password123*

 WiFi password must be at least 8 characters
 Avoid using easily guessable passwords${getSetting('footer_info', 'Unlimited Internet')}`
            });
            return;
        }

        const newPassword = params[0];

        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
 *PASSWORD TOO SHORT*

WiFi password must be at least 8 characters.
Please try again with a longer password.${getSetting('footer_info', 'Unlimited Internet')}`
            });
            return;
        }

        // Search for device based on sender number
        console.log(`Finding device for number: ${senderNumber}`);

        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *NUMBER NOT REGISTERED*

Oops, your number is not registered yet.
Please contact admin to register!${getSetting('footer_info', 'Unlimited Internet')}`
            });
            return;
        }
        
        // Get device ID
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);
        
        // Send message that request is being processed
        await sock.sendMessage(remoteJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
⏳ *REQUEST IN PROGRESS*

Updating your WiFi password...
Please wait a moment.${getSetting('footer_info', 'Unlimited Internet')}`
        });
        
        // Update WiFi password
        const result = await changePassword(deviceId, newPassword);
        
        if (result.success) {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
✅ *WIFI PASSWORD CHANGED SUCCESSFULLY!*

🔐 *New Password:* ${newPassword}

⏳ Wait a moment, the change will be active in a few moments.
📱 Connected devices may disconnect and need to reconnect with the new password.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Unlimited Internet')}`
            });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *FAILED TO CHANGE PASSWORD*

Oops! There was a technical issue while changing your WiFi password.
Some possible causes:
• Router is offline
• Connection issues to the server
• Password format not supported

Error message: ${result.message}

Please try again later!${getSetting('footer_info', 'Unlimited Internet')}`
            });
        }
    } catch (error) {
        console.error('Error handling password change:', error);
        await sock.sendMessage(remoteJid, { 
            text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
❌ *ERROR OCCURRED*

Error: ${error.message}

Please try again later or contact admin.${getSetting('footer_info', 'Unlimited Internet')}`
        });
    }
}

// Function to change WiFi password for device
async function changePassword(deviceId, newPassword) {
    try {
        console.log(`Changing password for device: ${deviceId}`);
        
        // Encode deviceId for URL
        const encodedDeviceId = encodeDeviceId(deviceId);
        
        // Get device information first
// FIX: Check if device exists in a simpler way
        // without using genieacsApi.getDeviceInfo
        
        // URL for GenieACS tasks
        const tasksUrl = `${global.appSettings.genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        
        // Create task to change password
        // Update parameters for 2.4GHz WiFi
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);
        
        // Update parameters for 5GHz WiFi
        const updatePass5Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 5GHz');
        const response5 = await axios.post(
            tasksUrl,
            updatePass5Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`5GHz password update response:`, response5.status);
        
        // Send refresh task to ensure changes are applied
        const refreshTask = {
            name: "refreshObject",
            objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
        };
        
        console.log('Sending refresh task');
        await axios.post(
            tasksUrl,
            refreshTask,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return { success: true, message: 'Password changed successfully' };
    } catch (error) {
        console.error('Error changing password:', error);
        return { 
            success: false, 
            message: error.response?.data?.message || error.message 
        };
    }
}

// Handler for admin changing customer WiFi password
async function handleAdminEditPassword(remoteJid, customerNumber, newPassword) {
    try {
        console.log(`Handling admin edit password request`);
        
        // Validate parameters
        if (!customerNumber || !newPassword) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *INCORRECT FORMAT!*\n\nCorrect format:\neditpassword [customer_number] [new_password]\n\nExample:\neditpassword 123456 password123`
            });
            return;
        }
        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Password too short!*\n\nPassword must be at least 8 characters.`
            });
            return;
        }
        
        // Search device based on customer number tag
        console.log(`Finding device for customer: ${customerNumber}`);
        
        const device = await findDeviceByTag(customerNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *Device not found!*\n\n` +
                      `Customer number "${customerNumber}" is not registered in the system.`
            });
            return;
        }
        
        // Get device ID
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);
        
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PASSWORD CHANGE PROCESS*\n\nUpdating WiFi password for customer ${customerNumber}...\nPlease wait a moment.` 
        });
        
        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(deviceId);
        
        // URL for GenieACS tasks
        const tasksUrl = `${global.appSettings.genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        
        // Create task to change password 2.4GHz
        const updatePass24Task = {
            name: "setParameterValues",
            parameterValues: [
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"],
                ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
            ]
        };
        
        console.log('Sending task to update password 2.4GHz');
        const response24 = await axios.post(
            tasksUrl,
            updatePass24Task,
            {
                auth: {
                    username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                    password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);
        
        // Try updating password for 5GHz at index 5 first
        let wifi5GFound = false;
        
        try {
            console.log('Trying to update 5GHz password using config index 5');
            const updatePass5Task = {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase", newPassword, "xsd:string"],
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            };
            
            await axios.post(
                tasksUrl,
                updatePass5Task,
                {
                    auth: {
                        username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                        password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully updated 5GHz password using config index 5');
            wifi5GFound = true;
        } catch (error5) {
            console.error('Error updating 5GHz password with index 5:', error5.message);
            
            // Trying with other indices besides 2 (3, 4, 6)
            const alternativeIndexes = [3, 4, 6];
            
            for (const idx of alternativeIndexes) {
                if (wifi5GFound) break;
                
                try {
                    console.log(`Trying to update 5GHz password using config index ${idx}`);
                    const updatePassAltTask = {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"],
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.PreSharedKey.1.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    };
                    
                    await axios.post(
                        tasksUrl,
                        updatePassAltTask,
                        {
                            auth: {
                                username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                                password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log(`Successfully updated 5GHz password using config index ${idx}`);
                    wifi5GFound = true;
                    break;
                } catch (error) {
                    console.error(`Error updating 5GHz password with index ${idx}:`, error.message);
                }
            }
            
            // If index 5 and alternatives (3, 4, 6) fail, leave SSID 5GHz unchanged
            if (!wifi5GFound) {
                try {
                    console.log('Last resort: trying to update 5GHz password using config index 2');
                    const updatePass2Task = {
                        name: "setParameterValues",
                        parameterValues: [
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase", newPassword, "xsd:string"],
                            ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase", newPassword, "xsd:string"]
                        ]
                    };
                    
                    await axios.post(
                        tasksUrl,
                        updatePass2Task,
                        {
                            auth: {
                                username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                                password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                            },
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    console.log('Successfully updated 5GHz password using config index 2');
                    wifi5GFound = true;
                } catch (error2) {
                    console.error('Error updating 5GHz password with index 2:', error2.message);
                }
            }
        }
        
        // Send refresh task to ensure changes are applied
        try {
            await axios.post(
                tasksUrl,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: global.appSettings.genieacsUsername || process.env.GENIEACS_USERNAME,
                        password: global.appSettings.genieacsPassword || process.env.GENIEACS_PASSWORD
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Get SSID information from device for notification
        const ssid24G = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'WiFi 2.4GHz';
        
        // Response to admin
        let responseMessage = `✅ *WIFI PASSWORD SUCCESSFULLY CHANGED!*\n\n` +
              `Customer: ${customerNumber}\n` +
              `New password: ${newPassword}\n\n`;
              
        if (wifi5GFound) {
            responseMessage += `Password changed successfully for WiFi 2.4GHz and 5GHz.\n\n`;
        } else {
            responseMessage += `Password changed successfully for WiFi 2.4GHz.\n` +
                              `WiFi 5GHz: Settings not found or failed to change.\n\n`;
        }
        
        responseMessage += `Changes will be applied in a few minutes.`;
        
        // Try to send notification to customer
        let notificationSent = false;
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                console.log(`Sending password change notification to customer: ${customerNumber}`);
                
                // Format phone number
                const formattedNumber = formatPhoneNumber(customerNumber);
                
                // Create notification message for customer
                const notificationMessage = `🏢 *${COMPANY_HEADER || ''}*
                
📢 *WIFI PASSWORD CHANGE INFORMATION*

Dear valued customer,

Your WiFi password has been changed by system administrator. Here are the change details:

📶 *WiFi Name:* ${ssid24G}
🔐 *New Password:* ${newPassword}

Please use this new password to connect to your WiFi network.
Changes will be applied in a few minutes.${FOOTER_INFO || ''}`;

                // Send message using sock
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, { 
                    text: notificationMessage 
                });
                
                console.log(`Password change notification sent to customer: ${customerNumber}`);
                notificationSent = true;
                
                responseMessage += `\nNotification already sent to customer.`;
            } catch (notificationError) {
                console.error(`Failed to send notification to customer: ${customerNumber}`, notificationError);
                responseMessage += `\n\n⚠️ *Warning:* Failed to send notification to customer.\n` +
                                  `Error: ${notificationError.message}`;
            }
        }

        // Send response to admin
        await sock.sendMessage(remoteJid, { text: responseMessage });
        
    } catch (error) {
        console.error('Error handling admin password change:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *An error occurred!*\n\n` +
                  `Error: ${error.message}\n\n` +
                  `Please try again later.`
        });
    }
}

// Handler for admin edit customer SSID
async function handleAdminEditSSID(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    console.log(`Processing adminssid command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `editssid [customer_number] [new_wifi_name]\n\n` +
                  `Example:\n` +
                  `editssid 123456 RumahBaru`
        });
        return;
    }

    // Get customer number from first parameter
    const customerNumber = params[0];
    
    // Combine all parameters after customer number as new SSID
    // This handles cases where SSID consists of multiple words
    const newSSID = params.slice(1).join(' ');
    const newSSID5G = `${newSSID}-5G`;

    console.log(`Attempting to change SSID for customer ${customerNumber} to "${newSSID}"`);

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *SSID CHANGE PROCESS*\n\nChanging WiFi name for customer ${customerNumber}...\nPlease wait a moment.` 
        });

        // Search device based on customer number
        const device = await findDeviceByTag(customerNumber);
        
        if (!device) {
            console.log(`Device not found for customer number: ${customerNumber}`);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *DEVICE NOT FOUND*\n\n` +
                      `Unable to find device for customer with number ${customerNumber}.\n\n` +
                      `Please ensure the customer number is correct and the device is registered in the system.`
            });
            return;
        }

        console.log(`Device found for customer ${customerNumber}: ${device._id}`);

        // Get current SSID for reference
        const currentSSID = device.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[1]?.SSID?._value || 'N/A';
        console.log(`Current SSID: ${currentSSID}`);
        
        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);
        
        // Update SSID 2.4GHz only at index 1
        await axios.post(
            `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // only index 1 for 2.4GHz
            },
            {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            }
        );
        
        // Update SSID 5GHz only at index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    }
                );
                console.log(`Successfully updated 5GHz SSID using config index ${idx}`);
                wifi5GFound = true;
            } catch (error) {
                console.error(`Error updating 5GHz SSID with index ${idx}:`, error.message);
            }
        }
        if (!wifi5GFound) {
            console.warn('No valid 5GHz SSID configuration found. 5GHz SSID not changed.');
        }
        
        // Add refresh task
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        
        // Reboot device to apply changes
        try {
            await axios.post(
                `${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: process.env.GENIEACS_USERNAME,
                        password: process.env.GENIEACS_PASSWORD
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        let responseMessage = `✅ *SSID CHANGE SUCCESSFUL*\n\n` +
                      `WiFi name for customer ${customerNumber} changed successfully!\n\n` +
                      `• Old SSID: ${currentSSID}\n` +
                      `• New SSID: ${newSSID}\n`;
                      
        if (wifi5GFound) {
            responseMessage += `• SSID 5GHz: ${newSSID5G}\n\n`;
        } else {
            responseMessage += `• SSID 5GHz: Settings not found or failed to change\n\n`;
        }
        
        responseMessage += `Device WiFi will restart in a moment. Customer needs to reconnect their devices to the new WiFi network.`;

        await sock.sendMessage(remoteJid, { text: responseMessage });
        
        // Send notification to customer if customer number is phone number
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                const formattedNumber = formatPhoneNumber(customerNumber);
                
                let notificationMessage = `✅ *WIFI NAME CHANGE*\n\n` +
                                          `Dear valued customer,\n\n` +
                                          `We inform you that your WiFi name has been changed:\n\n` +
                                          `• New WiFi Name: ${newSSID}\n`;
                                          
                if (wifi5GFound) {
                    notificationMessage += `• WiFi Name 5GHz: ${newSSID5G}\n\n`;
                }
                
                notificationMessage += `Device WiFi will restart in a moment. Please reconnect your devices to the new WiFi network.\n\n` +
                                      `If you have any questions, please reply to this message.`;
                
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, { 
                    text: notificationMessage
                });
                console.log(`Notification sent to customer: ${customerNumber}`);
            } catch (notifyError) {
                console.error('Error notifying customer:', notifyError);
            }
        }
    } catch (error) {
        console.error('Error in handleAdminEditSSID:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nAn error occurred while changing WiFi name:\n${error.message}`
        });
    }
}

// Function to change SSID
async function changeSSID(deviceId, newSSID) {
    try {
        console.log(`Changing SSID for device ${deviceId} to "${newSSID}"`);
        
        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(deviceId);
        
        // Implementation to change SSID through GenieACS
        // Edit SSID 2.4GHz
        try {
            console.log(`Setting 2.4GHz SSID to "${newSSID}"`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // only index 1 for 2.4GHz
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Edit 5GHz SSID by adding -5G suffix
            console.log(`Setting 5GHz SSID to "${newSSID}-5G"`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", `${newSSID}-5G`, "xsd:string"]
                ]
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            // Commit perubahan
            console.log(`Rebooting device to apply changes`);
            await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                name: "reboot"
            }, {
                auth: {
                    username: process.env.GENIEACS_USERNAME,
                    password: process.env.GENIEACS_PASSWORD
                }
            });
            
            console.log(`SSID change successful`);
            return { success: true, message: "SSID changed successfully" };
        } catch (apiError) {
            console.error(`API Error: ${apiError.message}`);
            
            // Try alternative method if first method fails
            if (apiError.response && apiError.response.status === 404) {
                console.log(`Trying alternative path for device ${deviceId}`);
                
                try {
                    // Try alternative path for 2.4GHz
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.1.SSID", newSSID, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    // Try with alternative path for 5GHz
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.2.SSID", `${newSSID}-5G`, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    // Commit perubahan
                    await axios.post(`${process.env.GENIEACS_URL}/devices/${encodedDeviceId}/tasks`, {
                        name: "reboot"
                    }, {
                        auth: {
                            username: process.env.GENIEACS_USERNAME,
                            password: process.env.GENIEACS_PASSWORD
                        }
                    });
                    
                    console.log(`SSID change successful using alternative path`);
                    return { success: true, message: "SSID changed successfully (using alternative path)" };
                } catch (altError) {
                    console.error(`Alternative path also failed: ${altError.message}`);
                    throw altError;
                }
            } else {
                throw apiError;
            }
        }
    } catch (error) {
        console.error('Error changing SSID:', error);
        return { 
            success: false, 
            message: error.response ? 
                `${error.message} (Status: ${error.response.status})` : 
                error.message 
        };
    }
}

// Update list ONU handler
async function handleListONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *SEARCHING DEVICE*\n\nRetrieving ONT device list...\nPlease wait a moment.` 
        });

        // Get device list from GenieACS
        const devices = await getAllDevices();
        
        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, { 
                text: `ℹ️ *NO DEVICES*\n\nNo ONT devices are registered in the system.` 
            });
            return;
        }

        // Limit number of devices displayed to avoid message being too long
        const maxDevices = 20;
        const displayedDevices = devices.slice(0, maxDevices);
        const remainingCount = devices.length - maxDevices;

        // Create message with device list
        let message = `📋 *ONT DEVICE LIST*\n`;
        message += `Total: ${devices.length} devices\n\n`;

        displayedDevices.forEach((device, index) => {
            // Helper function to get parameters with multiple paths
            const getParameterWithPaths = (device, paths) => {
                if (!device || !paths || !Array.isArray(paths)) return 'Unknown';

                for (const path of paths) {
                    try {
                        const pathParts = path.split('.');
                        let current = device;

                        for (const part of pathParts) {
                            if (current && typeof current === 'object') {
                                current = current[part];
                            } else {
                                break;
                            }
                        }

                        // Handle GenieACS parameter format
                        if (current && typeof current === 'object' && current._value !== undefined) {
                            const value = current._value;
                            // Make sure it's a string and not an object
                            if (typeof value === 'string' && value.trim() !== '') {
                                return value;
                            }
                        }

                        // Handle direct value - make sure it's a string
                        if (current !== null && current !== undefined && typeof current === 'string' && current.trim() !== '') {
                            return current;
                        }
                    } catch (error) {
                        // Continue to next path
                    }
                }
                return 'Unknown';
            };

            // Parameter paths for Serial Number
            const serialPaths = [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber',
                'Device.DeviceInfo.SerialNumber'
            ];

            // Parameter paths for Model Name
            const modelPaths = [
                'InternetGatewayDevice.DeviceInfo.ModelName',
                'Device.DeviceInfo.ModelName'
            ];

            const serialNumber = getParameterWithPaths(device, serialPaths);
            const modelName = getParameterWithPaths(device, modelPaths);

            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;
            const statusText = isOnline ? '🟢 Online' : '🔴 Offline';

            const tags = device._tags || [];
            const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';

            message += `${index + 1}. *${customerInfo}*\n`;
            message += `   • SN: ${serialNumber}\n`;
            message += `   • Model: ${modelName}\n`;
            message += `   • Status: ${statusText}\n`;
            message += `   • Last Seen: ${lastInform.toLocaleString()}\n\n`;
        });

        if (remainingCount > 0) {
            message += `...and ${remainingCount} other devices.\n`;
            message += `Use web admin panel to view complete list.`;
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleListONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nAn error occurred while fetching device list:\n${error.message}`
        });
    }
}

// Function to fetch all devices
async function getAllDevices() {
    try {
        // Implementation to fetch all devices from GenieACS
        const response = await axios.get(`${process.env.GENIEACS_URL}/devices`, {
            auth: {
                username: process.env.GENIEACS_USERNAME,
                password: process.env.GENIEACS_PASSWORD
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting all devices:', error);
        throw error;
    }
}

// Add handler for check all ONU (detail)
async function handleCheckAllONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔍 *CHECKING ALL DEVICES*\n\nCurrently checking status of all ONT devices...\nThis process may take some time.` 
        });

        // Get device list from GenieACS
        const devices = await getAllDevices();
        
        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, { 
                text: `ℹ️ *NO DEVICES*\n\nNo ONT devices are registered in the system.` 
            });
            return;
        }

        // Calculate device statistics
        let onlineCount = 0;
        let offlineCount = 0;
        let criticalRxPowerCount = 0;
        let warningRxPowerCount = 0;

        devices.forEach(device => {
            // Check online/offline status
            const lastInform = new Date(device._lastInform);
            const now = new Date();
            const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
            const isOnline = diffMinutes < 15;
            
            if (isOnline) {
                onlineCount++;
            } else {
                offlineCount++;
            }

            // Cek RX Power
            const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
            if (rxPower) {
                const power = parseFloat(rxPower);
                if (power <= parseFloat(process.env.RX_POWER_CRITICAL || -27)) {
                    criticalRxPowerCount++;
                } else if (power <= parseFloat(process.env.RX_POWER_WARNING || -25)) {
                    warningRxPowerCount++;
                }
            }
        });

        // Create message with statistics
        let message = `📊 *DEVICE STATUS REPORT*\n\n`;
        message += `📱 *Total Devices:* ${devices.length}\n\n`;
        message += `🟢 *Online:* ${onlineCount} (${Math.round(onlineCount/devices.length*100)}%)\n`;
        message += `🔴 *Offline:* ${offlineCount} (${Math.round(offlineCount/devices.length*100)}%)\n\n`;
        message += `📶 *Signal Status:*\n`;
        message += `🟠 *Warning:* ${warningRxPowerCount} devices\n`;
        message += `🔴 *Critical:* ${criticalRxPowerCount} devices\n\n`;
        
        // Add list of devices with issues
        if (criticalRxPowerCount > 0) {
            message += `*DEVICES WITH CRITICAL SIGNAL:*\n`;
            let count = 0;
            
            for (const device of devices) {
                const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
                if (rxPower && parseFloat(rxPower) <= parseFloat(process.env.RX_POWER_CRITICAL || -27)) {
                    const tags = device._tags || [];
                    const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                    const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                    
                    message += `${++count}. *${customerInfo}* (${serialNumber}): ${rxPower} dBm\n`;
                    
                    // Limit number of devices displayed
                    if (count >= 5) {
                        message += `...and ${criticalRxPowerCount - 5} other devices.\n`;
                        break;
                    }
                }
            }
            message += `\n`;
        }

        // Add list of recently offline devices
        if (offlineCount > 0) {
            message += `*RECENTLY OFFLINE DEVICES:*\n`;
            
            // Sort devices by last online time
            const offlineDevices = devices
                .filter(device => {
                    const lastInform = new Date(device._lastInform);
                    const now = new Date();
                    const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
                    return diffMinutes >= 15;
                })
                .sort((a, b) => new Date(b._lastInform) - new Date(a._lastInform));
            
            // Show 5 most recently offline devices
            const recentOfflineDevices = offlineDevices.slice(0, 5);
            recentOfflineDevices.forEach((device, index) => {
                const tags = device._tags || [];
                const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                const lastInform = new Date(device._lastInform);
                
                message += `${index + 1}. *${customerInfo}* (${serialNumber})\n`;
                message += `   Last Seen: ${lastInform.toLocaleString()}\n`;
            });
            
            if (offlineCount > 5) {
                message += `...and ${offlineCount - 5} other offline devices.\n`;
            }
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleCheckAllONU:', error);
        await sock.sendMessage(remoteJid, { 
            text: `❌ *ERROR*\n\nAn error occurred while checking device:\n${error.message}`
        });
    }
}

// Handler to delete hotspot user
async function handleDeleteHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `delhotspot [username]\n\n` +
                  `Example:\n` +
                  `• delhotspot user123`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *HOTSPOT USER DELETION PROCESS*\n\nDeleting hotspot user...\nPlease wait a moment.` 
        });

        const [username] = params;
        console.log(`Deleting hotspot user: ${username}`);
        
        // Call function to delete hotspot user
        const result = await deleteHotspotUser(username);
        console.log(`Hotspot user delete result:`, result);

        // Create response message
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'SUCCESSFULLY' : 'FAILED'} TO DELETE HOTSPOT USER*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}`;

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delhotspot command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try sending again if failed
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeleteHotspotUser:', error);
        
        // Send error message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR DELETING HOTSPOT USER*\n\n` +
                          `An error occurred while deleting hotspot user:\n` +
                          `${error.message || 'Unknown error'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler to delete PPPoE secret
async function handleDeletePPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 1) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `delpppoe [username]\n\n` +
                  `Example:\n` +
                  `• delpppoe user123`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PPPoE SECRET DELETION PROCESS*\n\nDeleting PPPoE secret...\nPlease wait a moment.` 
        });

        const [username] = params;
        console.log(`Deleting PPPoE secret: ${username}`);
        
        const resultBool = await deletePPPoESecret(username);
        console.log(`PPPoE secret delete result:`, resultBool);

        let responseMessage = '';
        if (resultBool) {
            responseMessage = `✅ *SUCCESSFULLY DELETED PPPoE SECRET*\n\nUser deleted successfully from Mikrotik.\n\n• Username: ${username}`;
        } else {
            responseMessage = `❌ *FAILED TO DELETE PPPoE SECRET*\n\nUser not found or failed to delete from Mikrotik.\n\n• Username: ${username}`;
        }

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try sending again if failed
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleDeletePPPoESecret:', error);
        
        // Send error message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR DELETING PPPoE SECRET*\n\n` +
                          `An error occurred while deleting PPPoE secret:\n` +
                          `${error.message || 'Unknown error'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler to add hotspot user
async function handleAddHotspotUser(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    console.log(`Processing addhotspot command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `addhotspot [username] [password] [profile]\n\n` +
                  `Example:\n` +
                  `• addhotspot user123 pass123\n` +
                  `• addhotspot user123 pass123 default`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *HOTSPOT USER ADDITION PROCESS*\n\nAdding hotspot user...\nPlease wait a moment.` 
        });

        const [username, password, profile = "default"] = params;
        console.log(`Adding hotspot user: ${username} with profile: ${profile}`);
        
        // Call function to add hotspot user
        const result = await addHotspotUser(username, password, profile);
        console.log(`Hotspot user add result:`, result);

        // Create response message
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'SUCCESSFULLY' : 'FAILED'} TO ADD HOTSPOT USER*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}\n` +
                               `• Password: ${password}\n` +
                               `• Profile: ${profile}`;

        // Send response message with timeout to ensure message is sent
        setTimeout(async () => {
            try {
                console.log(`Sending response message for addhotspot command:`, responseMessage);
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent successfully`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try sending again if failed
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500); // Wait 1.5 seconds before sending response
        
    } catch (error) {
        console.error('Error in handleAddHotspotUser:', error);
        
        // Send error message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR ADDING HOTSPOT USER*\n\n` +
                          `An error occurred while adding hotspot user:\n` +
                          `${error.message || 'Unknown error'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler to add PPPoE secret
async function handleAddPPPoESecret(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `addpppoe [username] [password] [profile] [ip]\n\n` +
                  `Example:\n` +
                  `• addpppoe user123 pass123\n` +
                  `• addpppoe user123 pass123 default\n` +
                  `• addpppoe user123 pass123 default 10.0.0.1`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PPPoE SECRET ADDITION PROCESS*\n\nAdding PPPoE secret...\nPlease wait a moment.` 
        });

        const [username, password, profile = "default", localAddress = ""] = params;
        console.log(`Adding PPPoE secret: ${username} with profile: ${profile}, IP: ${localAddress || 'from pool'}`);
        
        const result = await addPPPoESecret(username, password, profile, localAddress);
        console.log(`PPPoE secret add result:`, result);

        // Create response message
        const responseMessage = `${result.success ? '✅' : '❌'} *${result.success ? 'SUCCESSFULLY' : 'FAILED'} TO ADD PPPoE SECRET*\n\n` +
                               `${result.message}\n\n` +
                               `• Username: ${username}\n` +
                               `• Profile: ${profile}\n` +
                               `• IP: ${localAddress || 'Using IP from pool'}`;

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for addpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try sending again if failed
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleAddPPPoESecret:', error);
        
        // Send error message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR ADDING PPPoE SECRET*\n\n` +
                          `An error occurred while adding PPPoE secret:\n` +
                          `${error.message || 'Unknown error'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler to change PPPoE profile
async function handleChangePPPoEProfileeeeeeeeee(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, { 
            text: `❌ *WRONG FORMAT*\n\n` +
                  `Correct format:\n` +
                  `setprofile [username] [new-profile]\n\n` +
                  `Example:\n` +
                  `setprofile user123 premium`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, { 
            text: `🔄 *PPPoE PROFILE CHANGE PROCESS*\n\nChanging PPPoE profile...\nPlease wait a moment.` 
        });

        const [username, newProfileeeeeeeeee] = params;
        console.log(`Changing PPPoE profile for user ${username} to ${newProfileeeeeeeeee}`);
        
        // Switch to setPPPoEProfile (correct function from mikrotik.js)
        const result = await setPPPoEProfileeeeeeeeee(username, newProfileeeeeeeeee);
        console.log(`PPPoE profile change result:`, result);

        // Create response message
        const responseMessage = `${result ? '✅ SUCCESS' : '❌ FAILED'} CHANGING PPPoE PROFILE\n\n` +
                               `• Username: ${username}\n` +
                               `• New Profile: ${newProfileeeeeeeeee}`;

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for setprofile command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try sending again if failed
                setTimeout(async () => {
                    try {
                        await sock.sendMessage(remoteJid, { text: responseMessage });
                        console.log(`Response message sent on second attempt`);
                    } catch (retryError) {
                        console.error('Error sending response message on retry:', retryError);
                    }
                }, 2000);
            }
        }, 1500);
    } catch (error) {
        console.error('Error in handleChangePPPoEProfileeeeeeeeee:', error);
        
        // Send error message
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { 
                    text: `❌ *ERROR CHANGING PPPoE PROFILE*\n\n` +
                          `An error occurred while changing PPPoE profile:\n` +
                          `${error.message || 'Unknown error'}`
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }, 1500);
    }
}

// Handler for resource monitoring
async function handleResourceInfo(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send processing message
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Processing Request*\n\nCurrently fetching router resource information...`
        });

        // Import mikrotik module
        const mikrotik = require('./mikrotik');

        // Get resource information
        const result = await mikrotik.getResourceInfo();

        if (result.success) {
            const data = result.data;

            // Format CPU info
            let cpuInfo = `💻 *CPU*\n• Load: ${data.cpuLoad}%\n`;
            if (data.cpuCount > 0) cpuInfo += `• Count: ${data.cpuCount}\n`;
            if (data.cpuFrequency > 0) cpuInfo += `• Frequency: ${data.cpuFrequency} MHz\n`;

            // Format Memory info with handling of unavailable data
            let memoryInfo = `💾 *MEMORY*\n`;
            if (data.totalMemory > 0) {
                const memUsagePercent = ((data.memoryUsed / data.totalMemory) * 100).toFixed(1);
                memoryInfo += `• Free: ${data.memoryFree.toFixed(2)} MB\n`;
                memoryInfo += `• Total: ${data.totalMemory.toFixed(2)} MB\n`;
                memoryInfo += `• Used: ${data.memoryUsed.toFixed(2)} MB\n`;
                memoryInfo += `• Usage: ${memUsagePercent}%\n`;
            } else {
                memoryInfo += `• Status: ⚠️ Data unavailable\n`;
            }

            // Format Disk info
            let diskInfo = `💿 *DISK*\n`;
            if (data.totalDisk > 0) {
                const diskUsagePercent = ((data.diskUsed / data.totalDisk) * 100).toFixed(1);
                diskInfo += `• Total: ${data.totalDisk.toFixed(2)} MB\n`;
                diskInfo += `• Free: ${data.diskFree.toFixed(2)} MB\n`;
                diskInfo += `• Used: ${data.diskUsed.toFixed(2)} MB\n`;
                diskInfo += `• Usage: ${diskUsagePercent}%\n`;
            } else {
                diskInfo += `• Status: ⚠️ Data unavailable\n`;
            }

            // Format System info
            let systemInfo = `⏰ *UPTIME*\n• ${data.uptime}\n\n`;
            systemInfo += `🔧 *SYSTEM INFO*\n`;
            if (data.model !== 'N/A') systemInfo += `• Model: ${data.model}\n`;
            if (data.architecture !== 'N/A') systemInfo += `• Architecture: ${data.architecture}\n`;
            if (data.version !== 'N/A') systemInfo += `• Version: ${data.version}\n`;
            if (data.boardName !== 'N/A') systemInfo += `• Board: ${data.boardName}\n`;

            const message = `📊 *INFO RESOURCE ROUTER*\n\n${cpuInfo}\n${memoryInfo}\n${diskInfo}\n${systemInfo}`;

            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\n${result.message}\n\nPlease try again later.`
            });
        }
    } catch (error) {
        console.error('Error handling resource info command:', error);

        // Send error message
        try {
            await sock.sendMessage(remoteJid, {
                text: `❌ *ERROR*\n\nAn error occurred while fetching resource information: ${error.message}\n\nPlease try again later.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Handler to view active hotspot users
async function handleActiveHotspotUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send processing message
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Processing Request*\n\nCurrently fetching active hotspot user list...`
        });
        
        console.log('Fetching active hotspot users');
        
        // Import mikrotik module
        const mikrotik = require('./mikrotik');
        
        // Get active hotspot user list
        const result = await mikrotik.getActiveHotspotUsers();

        if (result.success) {
            let message = '👥 *ACTIVE HOTSPOT USER LIST*\n\n';
            
            if (result.data.length === 0) {
                message += 'No active hotspot users';
            } else {
                result.data.forEach((user, index) => {
                    // Helper function for parsing bytes
                    const parseBytes = (value) => {
                        if (value === null || value === undefined || value === '') return 0;

                        // If already a number
                        if (typeof value === 'number') return value;

                        // If a string, parse as integer
                        if (typeof value === 'string') {
                            const parsed = parseInt(value.replace(/[^0-9]/g, ''));
                            return isNaN(parsed) ? 0 : parsed;
                        }

                        return 0;
                    };

                    const bytesIn = parseBytes(user['bytes-in']);
                    const bytesOut = parseBytes(user['bytes-out']);

                    message += `${index + 1}. *User: ${user.user || 'N/A'}*\n` +
                              `   • IP: ${user.address || 'N/A'}\n` +
                              `   • Uptime: ${user.uptime || 'N/A'}\n` +
                              `   • Download: ${(bytesIn/1024/1024).toFixed(2)} MB\n` +
                              `   • Upload: ${(bytesOut/1024/1024).toFixed(2)} MB\n\n`;
                });
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nPlease try again later.`
            });
        }
    } catch (error) {
        console.error('Error handling active hotspot users command:', error);
        
        // Send error message
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nAn error occurred while fetching active hotspot user list: ${error.message}\n\nPlease try again later.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Fix handleActivePPPoE function
async function handleActivePPPoE(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send processing message
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Processing Request*\n\nCurrently fetching active PPPoE connection list...`
        });
        
        console.log('Fetching active PPPoE connections');
        
        // Import mikrotik module
        const mikrotik = require('./mikrotik');
        
        // Get active PPPoE connection list
        const result = await mikrotik.getActivePPPoEConnections();

        if (result.success) {
            let message = '📡 *ACTIVE PPPoE CONNECTION LIST*\n\n';
            
            if (result.data.length === 0) {
                message += 'No active PPPoE connections';
            } else {
                result.data.forEach((conn, index) => {
                    message += `${index + 1}. *User: ${conn.name}*\n` +
                              `   • Service: ${conn.service}\n` +
                              `   • IP: ${conn.address}\n` +
                              `   • Uptime: ${conn.uptime}\n` +
                              `   • Encoding: ${conn.encoding}\n\n`;
                });
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nPlease try again later.`
            });
        }
    } catch (error) {
        console.error('Error handling active PPPoE connections command:', error);
        
        // Send error message
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nAn error occurred while fetching active PPPoE connection list: ${error.message}\n\nPlease try again later.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Add function to get offline user list
async function handleOfflineUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send processing message
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Processing Request*\n\nCurrently fetching offline PPPoE user list...`
        });
        
        console.log('Fetching offline PPPoE users');
        
        // Import mikrotik module
        const mikrotik = require('./mikrotik');
        
        // Get offline PPPoE user list
        const result = await mikrotik.getInactivePPPoEUsers();

        if (result.success) {
            let message = `📊 *OFFLINE PPPoE USER LIST*\n\n`;
            message += `Total User: ${result.totalSecrets}\n`;
            message += `Active Users: ${result.totalActive} (${((result.totalActive/result.totalSecrets)*100).toFixed(2)}%)\n`;
            message += `Offline Users: ${result.totalInactive} (${((result.totalInactive/result.totalSecrets)*100).toFixed(2)}%)\n\n`;
            
            if (result.data.length === 0) {
                message += 'No offline PPPoE users';
            } else {
                // Limit number of users displayed to avoid message being too long
                const maxUsers = 30;
                const displayUsers = result.data.slice(0, maxUsers);
                
                displayUsers.forEach((user, index) => {
                    message += `${index + 1}. *${user.name}*${user.comment ? ` (${user.comment})` : ''}\n`;
                });
                
                if (result.data.length > maxUsers) {
                    message += `\n... and ${result.data.length - maxUsers} other users`;
                }
            }
            
            await sock.sendMessage(remoteJid, { text: message });
        } else {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\n${result.message}\n\nPlease try again later.`
            });
        }
    } catch (error) {
        console.error('Error handling offline users command:', error);
        
        // Send error message
        try {
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nAn error occurred while getting offline user list: ${error.message}\n\nPlease try again later.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

const sendMessage = require('./sendMessage');

// Export module
module.exports = {
    setSock,
    handleAddHotspotUser,
    handleAddPPPoESecret,
    handleChangePPPoEProfileeeeeeeeee,
    handleResourceInfo,
    handleActiveHotspotUsers,
    handleActivePPPoE,
    handleDeleteHotspotUser,
    handleDeletePPPoESecret,
    connectToWhatsApp,
    sendMessage,
    getWhatsAppStatus,
    deleteWhatsAppSession,
    getSock,
    handleOfflineUsers,
    updateConfig
};

// Function to check if command is related to WiFi/SSID
function isWifiCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const wifiKeywords = [
        'gantiwifi', 'ubahwifi', 'changewifi', 'wifi', 
        'gantissid', 'ubahssid', 'ssid',
        'namawifi', 'updatewifi', 'wifiname', 'namessid',
        'setwifi', 'settingwifi', 'changewifiname'
    ];
    
    // Remove 'editssid' and 'editwifi' from regular WiFi command list
    // because this is an admin-specific command
    return wifiKeywords.includes(command);
}

// Function to check if command is related to password
function isPasswordCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const passwordKeywords = [
        'gantipass', 'ubahpass', 'editpass', 'changepass', 'password',
        'gantisandi', 'ubahsandi', 'editsandi', 'sandi',
        'changepassword', 'newpassword', 'setpassword', 'resetpassword',
        'gantipw', 'ubahpw', 'editpw', 'pw', 'pass',
        'gantipassword', 'ubahpassword', 'editpassword',
        'passwordwifi', 'wifipassword', 'passw', 'passwordwifi'
    ];
    
    return passwordKeywords.includes(command);
}

// Function to send welcome message
async function sendWelcomeMessage(remoteJid, isAdmin = false) {
    try {
        console.log(`Sending welcome message to ${remoteJid}, isAdmin: ${isAdmin}`);
        
        // Welcome message
        let welcomeMessage = `👋 *Welcome to WhatsApp Bot ${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP') || 'ISP Monitor'}*\n\n`;
        
        if (isAdmin) {
            welcomeMessage += `Hello Admin! You can use various commands to manage the system.\n\n`;
        } else {
            welcomeMessage += `Hello Customer! You can use this bot to manage your device.\n\n`;
        }
        
        welcomeMessage += `Type *menu* to see the list of available commands.\n\n`;
        
        // Add footer
        welcomeMessage += `🏢 *${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP') || 'ISP Monitor'}*\n`;
        welcomeMessage += `${getSetting('footer_info', 'Unlimited Internet') || ''}`;
        
        // Send welcome message
        await sock.sendMessage(remoteJid, { text: welcomeMessage });
        console.log(`Welcome message sent to ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending welcome message:', error);
        return false;
    }
}

// Function to encode device ID
function encodeDeviceId(deviceId) {
    // Ensure deviceId is a string
    const idString = String(deviceId);
    
    // Encode URL components separately
    return idString.split('/').map(part => encodeURIComponent(part)).join('/');
}

// Function to get WhatsApp status
function getWhatsAppStatus() {
    try {
        // Use global.whatsappStatus if available
        if (global.whatsappStatus) {
            return global.whatsappStatus;
        }
        
        if (!sock) {
            return {
                connected: false,
                status: 'disconnected',
                qrCode: null
            };
        }

        if (sock.user) {
            return {
                connected: true,
                status: 'connected',
                phoneNumber: sock.user.id.split(':')[0],
                connectedSince: new Date()
            };
        }

        return {
            connected: false,
            status: 'connecting',
            qrCode: null
        };
    } catch (error) {
        console.error('Error getting WhatsApp status:', error);
        return {
            connected: false,
            status: 'error',
            error: error.message,
            qrCode: null
        };
    }
}

// Function to delete WhatsApp session
async function deleteWhatsAppSession() {
    try {
        const sessionDir = process.env.WHATSAPP_SESSION_PATH || './whatsapp-session';
        const fs = require('fs');
        const path = require('path');
        
        // Delete all files in session directory
        if (fs.existsSync(sessionDir)) {
            const files = fs.readdirSync(sessionDir);
            for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
            }
            console.log(`Deleting ${files.length} WhatsApp session files`);
        }
        
        console.log('WhatsApp session deleted successfully');
        
        // Reset status
        global.whatsappStatus = {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'session_deleted'
        };
        
        // Restart koneksi WhatsApp
        if (sock) {
            try {
                sock.logout();
            } catch (error) {
                console.log('Error saat logout:', error);
            }
        }
        
        // Restart connection after 2 seconds
        setTimeout(() => {
            connectToWhatsApp();
        }, 2000);
        
        return { success: true, message: 'WhatsApp session deleted successfully' };
    } catch (error) {
        console.error('Error deleting WhatsApp session:', error);
        return { success: false, message: error.message };
    }
}

// Add this function above module.exports
function getSock() {
    return sock;
}

// Function to handle incoming messages with better error handling and logging
async function handleIncomingMessage(sock, message) {
    // Send welcome message to super admin when application first runs
    if (!global.superAdminWelcomeSent && getSetting('superadmin_welcome_enabled', true)) {
        try {
            await sock.sendMessage(superAdminNumber + '@s.whatsapp.net', {
                text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}
👋 *Welcome*

WhatsApp Bot application successfully run.

Donation Account For Application Development
# 4206 01 003953 53 1 BRI an WARJAYA

E-Wallet : 03036783333

${getSetting('footer_info', 'Unlimited Internet')}`
            });
            global.superAdminWelcomeSent = true;
            console.log('Welcome message sent to super admin');
        } catch (err) {
            console.error('Failed to send welcome message to super admin:', err);
        }
    }
    try {
        // Validate input
        if (!message || !message.key) {
            logger.warn('Invalid message received', { message: typeof message });
            return;
        }
        
        // Extract message information
        const remoteJid = message.key.remoteJid;
        if (!remoteJid) {
            logger.warn('Message without remoteJid received', { messageKey: message.key });
            return;
        }
        
        // Skip if message is from group and not from admin
        if (remoteJid.includes('@g.us')) {
            logger.debug('Message from group received', { groupJid: remoteJid });
            const participant = message.key.participant;
            if (!participant || !isAdminNumber(participant.split('@')[0])) {
                logger.debug('Group message not from admin, ignoring', { participant });
                return;
            }
            logger.info('Group message from admin, processing', { participant });
        }
        
        // Check message type and extract text
        let messageText = '';
        if (!message.message) {
            logger.debug('Message without content received', { messageType: 'unknown' });
            return;
        }
        
        if (message.message.conversation) {
            messageText = message.message.conversation;
            logger.debug('Conversation message received');
        } else if (message.message.extendedTextMessage) {
            messageText = message.message.extendedTextMessage.text;
            logger.debug('Extended text message received');
        } else {
            // Unsupported message type
            logger.debug('Unsupported message type received', { 
                messageTypes: Object.keys(message.message) 
            });
            return;
        }
        
        // Extract sender number with error handling
        let senderNumber;
        try {
            senderNumber = remoteJid.split('@')[0];
        } catch (error) {
            logger.error('Error extracting sender number', { remoteJid, error: error.message });
            return;
        }
        
        logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
        logger.debug(`Message content`, { sender: senderNumber, message: messageText });
        
        // Check if sender is admin
        const isAdmin = isAdminNumber(senderNumber);
        logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });
        
        // If message is empty, ignore
        if (!messageText.trim()) {
            logger.debug('Empty message, ignoring');
            return;
        }
        
// Process command
const command = messageText.trim().toLowerCase();

        // Handler setheader
if (command.startsWith('setheader ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change header!*');
return;
}
            const newHeader = messageText.split(' ').slice(1).join(' ');
            if (!newHeader) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsetheader [new_header_text]');
                return;
            }
            const settingsPath = path.join(__dirname, '../settings.json');
            let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            settings.company_header = newHeader;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            updateConfig({ companyHeader: newHeader });
            await sendFormattedMessage(remoteJid, `✅ *Header changed successfully to:*\n${newHeader}`);
            return;
        }

        // Handler setfooter
if (command.startsWith('setfooter ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change footer!*');
return;
}
            const newFooter = messageText.split(' ').slice(1).join(' ');
            if (!newFooter) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsetfooter [new_footer_text]');
return;
}
            const settingsPath = path.join(__dirname, '../settings.json');
            let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            settings.footer_info = newFooter;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            updateConfig({ footerInfo: newFooter });
            await sendFormattedMessage(remoteJid, `✅ *Footer changed successfully to:*\n${newFooter}`);
return;
}

        // Handler setadmin
        if (command.startsWith('setadmin ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change admin number!*');
                return;
            }
            const newAdmin = messageText.split(' ').slice(1).join(' ').replace(/\D/g, '');
            if (!newAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsetadmin [new_admin_number]');
                return;
            }
            let settings = getAppSettings();
            settings.admin_number = newAdmin;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Admin number changed successfully to:*\n${newAdmin}`);
            return;
        }

        // Handler settechnician
        if (command.startsWith('settechnician ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change technician!*');
                return;
            }
            const newTechs = messageText.split(' ').slice(1).join(' ').split(',').map(n => n.trim().replace(/\D/g, '')).filter(Boolean);
            if (!newTechs.length) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsettechnician [number1,number2,...]');
                return;
            }
            let settings = getAppSettings();
            settings.technician_numbers = newTechs;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Technician numbers changed successfully to:*\n${newTechs.join(', ')}`);
            return;
        }

        // Handler setgenieacs
        if (command.startsWith('setgenieacs ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change GenieACS config!*');
                return;
            }
const params = messageText.split(' ').slice(1);
            if (params.length < 3) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsetgenieacs [url] [username] [password]');
return;
}
            let settings = getAppSettings();
            settings.genieacs_url = params[0];
            settings.genieacs_username = params[1];
            settings.genieacs_password = params.slice(2).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *GenieACS configuration changed successfully!*`);
return;
}

        // Handler setmikrotik
        if (command.startsWith('setmikrotik ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '❌ *Only admin can change Mikrotik config!*');
                return;
            }
            const params = messageText.split(' ').slice(1);
            if (params.length < 4) {
                await sendFormattedMessage(remoteJid, '❌ *Wrong format!*\n\nsetmikrotik [host] [port] [user] [password]');
                return;
            }
            let settings = getAppSettings();
            settings.mikrotik_host = params[0];
            settings.mikrotik_port = params[1];
            settings.mikrotik_user = params[2];
            settings.mikrotik_password = params.slice(3).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `✅ *Mikrotik configuration changed successfully!*`);
            return;
}
        
// Command to enable/disable GenieACS (admin only)
// This command is always processed regardless of genieacsCommandsEnabled status
        
        // Command to disable GenieACS messages (admin only)
        if (command.toLowerCase() === 'genieacs stop' && isAdmin) {
    console.log(`Admin ${senderNumber} disabling GenieACS messages`);
    genieacsCommandsEnabled = false;
            await sendFormattedMessage(remoteJid, `✅ *GENIEACS MESSAGES DISABLED*


GenieACS messages have been disabled. Contact admin to re-enable.`);
    return;
}

        // Command to re-enable GenieACS messages (admin only)
        if (command.toLowerCase() === 'genieacs start060111' && isAdmin) {
            console.log(`Admin ${senderNumber} activating GenieACS messages`);
            genieacsCommandsEnabled = true;
            await sendFormattedMessage(remoteJid, `✅ *GENIEACS MESSAGES ACTIVATED*


GenieACS messages have been reactivated.`);
            return;
        }
        
        // If GenieACS is disabled, ignore all commands except from number 6281947215703
        if (!genieacsCommandsEnabled && senderNumber !== '6281947215703') {
            // Only number 6281947215703 can use bot when GenieACS is disabled
            console.log(`Message ignored because GenieACS is disabled and not from special number: ${senderNumber}`);
            return;
        }
        
        // GenieACS stop command (super admin only)
        if (command === 'genieacs stop') {
            if (senderNumber === superAdminNumber) {
                // Logic to stop GenieACS
                genieacsCommandsEnabled = false;
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n✅ *GenieACS successfully stopped by Super Admin.*${getSetting('footer_info', 'Unlimited Internet')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n❌ *Only Super Admin can run this command!*${getSetting('footer_info', 'Unlimited Internet')}` });
            }
            return;
        }
        // GenieACS start command (super admin only)
        if (command === 'genieacs start060111') {
            if (senderNumber === superAdminNumber) {
                genieacsCommandsEnabled = true;
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n✅ *GenieACS successfully activated by Super Admin.*${getSetting('footer_info', 'Unlimited Internet')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n❌ *Only Super Admin can run this command!*${getSetting('footer_info', 'Unlimited Internet')}` });
            }
            return;
        }
        // Menu command (replace help)
        if (command === 'menu' || command === '!menu' || command === '/menu') {
            console.log(`Running menu command for ${senderNumber}`);
            await handleHelpCommand(remoteJid, isAdmin);
            return;
        }
        
        // Perintah status
        if (command === 'status' || command === '!status' || command === '/status') {
            console.log(`Running status command for ${senderNumber}`);
            await handleStatusCommand(senderNumber, remoteJid);
            return;
        }
        
        // Refresh command
        if (command === 'refresh' || command === '!refresh' || command === '/refresh') {
            console.log(`Running refresh command for ${senderNumber}`);
            await handleRefreshCommand(senderNumber, remoteJid);
            return;
        }
        
        // Admin command
        if ((command === 'admin' || command === '!admin' || command === '/admin') && isAdmin) {
            console.log(`Running admin command for ${senderNumber}`);
            await handleAdminMenu(remoteJid);
            return;
        }
        
        // Command to enable/disable GenieACS moved above

        // Factory reset command (for customer)
        if (command === 'factory reset' || command === '!factory reset' || command === '/factory reset') {
            console.log(`Running factory reset command for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleFactoryReset(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Factory reset confirmation command
        if (command === 'confirm factory reset' || command === '!confirm factory reset' || command === '/confirm factory reset') {
            console.log(`Running factory reset confirmation for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleFactoryResetConfirmation(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Connected devices command
        if (command === 'devices' || command === '!devices' || command === '/devices' ||
            command === 'connected' || command === '!connected' || command === '/connected') {
            console.log(`Running connected devices command for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleConnectedDevices(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Speed test / bandwidth command
        if (command === 'speedtest' || command === '!speedtest' || command === '/speedtest' ||
            command === 'bandwidth' || command === '!bandwidth' || command === '/bandwidth') {
            console.log(`Running speed test command for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleSpeedTest(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Network diagnostics command
        if (command === 'diagnostic' || command === '!diagnostic' || command === '/diagnostic' ||
            command === 'diagnosa' || command === '!diagnosa' || command === '/diagnosa') {
            console.log(`Running network diagnostics command for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleNetworkDiagnostic(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Connection history command
        if (command === 'history' || command === '!history' || command === '/history' ||
            command === 'riwayat' || command === '!riwayat' || command === '/riwayat') {
            console.log(`Running connection history command for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleConnectionHistory(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Admin alias: cekstatus [number] or cekstatus[number]
        if (isAdmin && (command.startsWith('cekstatus ') || command.startsWith('cekstatus'))) {
            let customerNumber = '';
            if (command.startsWith('cekstatus ')) {
                customerNumber = messageText.trim().split(' ')[1];
            } else {
                // Handle without space, e.g., cekstatus081321960111
                customerNumber = command.replace('cekstatus','').trim();
            }
            if (customerNumber && /^\d{8,}$/.test(customerNumber)) {
                await handleAdminCheckONU(remoteJid, customerNumber);
                return;
            } else {
                await sock.sendMessage(remoteJid, {
                    text: `❌ *WRONG FORMAT*\n\nCorrect format:\ncekstatus [customer_number]\n\nExample:\ncekstatus 081234567890`
                });
                return;
            }
        }
        
        // Change WiFi command
        if (isWifiCommand(command)) {
            console.log(`Running change WiFi command for ${senderNumber}`);
            const params = messageText.split(' ').slice(1);
            
            // If admin uses gantiwifi command with format: gantiwifi [customer_number] [ssid]
            if (isAdmin && params.length >= 2) {
                // Assume first parameter as customer number
                const customerNumber = params[0];
                const ssidParams = params.slice(1);
                console.log(`Admin using gantiwifi for customer ${customerNumber}`);
                await handleAdminEditSSID(remoteJid, customerNumber, ssidParams.join(' '));
            } else {
                // Regular customer or admin format doesn't match
                await handleChangeSSID(senderNumber, remoteJid, params);
            }
            return;
        }
        
        // Perintah ganti password
        if (isPasswordCommand(command.split(' ')[0])) {
            console.log(`Running change password command for ${senderNumber}`);
            const params = messageText.split(' ').slice(1);
            
            // If admin uses gantipassword command with format: gantipassword [customer_number] [password]
            if (isAdmin && params.length >= 2) {
                // Assume first parameter as customer number
                const customerNumber = params[0];
                const password = params[1];
                console.log(`Admin using gantipassword for customer ${customerNumber}`);
                await handleAdminEditPassword(remoteJid, customerNumber, password);
            } else {
                // Regular customer or admin format doesn't match
                await handleChangePassword(senderNumber, remoteJid, params);
            }
            return;
        }
        
        // If admin, check other admin commands
        if (isAdmin) {
            // Check ONU command
            if (command.startsWith('cek ') || command.startsWith('!cek ') || command.startsWith('/cek ')) {
                const customerNumber = command.split(' ')[1];
                if (customerNumber) {
                    console.log(`Running check ONU command for customer ${customerNumber}`);
                    await handleAdminCheckONU(remoteJid, customerNumber);
                    return;
                }
            }
            
            // Edit SSID command
            if (command.toLowerCase().startsWith('editssid ') || command.toLowerCase().startsWith('!editssid ') || command.toLowerCase().startsWith('/editssid ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running edit SSID command for ${params[0]}`);
                    await handleAdminEditSSID(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `editssid [customer_number] [new_ssid]\n\n` +
                              `Example:\n` +
                              `editssid 123456 RumahKu`
                    });
                    return;
                }
            }
            
            // Edit password command
            if (command.toLowerCase().startsWith('editpass ') || command.toLowerCase().startsWith('!editpass ') || command.toLowerCase().startsWith('/editpass ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running edit password command for ${params[0]}`);
                    await handleAdminEditPassword(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `editpass [customer_number] [new_password]\n\n` +
                              `Example:\n` +
                              `editpass 123456 password123`
                    });
                    return;
                }
            }

            // Admin device detail command
            if (command.toLowerCase().startsWith('detail ') || command.toLowerCase().startsWith('!detail ') || command.toLowerCase().startsWith('/detail ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running admin detail command for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminDeviceDetail(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `detail [customer_number]\n\n` +
                              `Example:\n` +
                              `detail 081234567890`
                    });
                    return;
                }
            }

            // Admin command restart customer device
            if (command.toLowerCase().startsWith('adminrestart ') || command.toLowerCase().startsWith('!adminrestart ') || command.toLowerCase().startsWith('/adminrestart ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running admin restart command for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminRestartDevice(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `adminrestart [customer_number]\n\n` +
                              `Example:\n` +
                              `adminrestart 081234567890`
                    });
                    return;
                }
            }

            // Admin factory reset customer device command
            if (command.toLowerCase().startsWith('adminfactory ') || command.toLowerCase().startsWith('!adminfactory ') || command.toLowerCase().startsWith('/adminfactory ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running admin factory reset command for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminFactoryReset(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `adminfactory [customer_number]\n\n` +
                              `Example:\n` +
                              `adminfactory 081234567890`
                    });
                    return;
                }
            }

            // Admin factory reset confirmation command
            if (command.toLowerCase().startsWith('confirm admin factory reset ') || command.toLowerCase().startsWith('!confirm admin factory reset ') || command.toLowerCase().startsWith('/confirm admin factory reset ')) {
                const params = messageText.split(' ').slice(4); // Skip "confirm admin factory reset"
                if (params.length >= 1) {
                    console.log(`Running admin factory reset confirmation for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminFactoryResetConfirmation(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                }
            }

            // PPPoE notification management command
            if (command.toLowerCase().startsWith('pppoe ') || command.toLowerCase().startsWith('!pppoe ') || command.toLowerCase().startsWith('/pppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    const subCommand = params[0].toLowerCase();

                    switch (subCommand) {
                        case 'on':
                        case 'enable':
                            console.log(`Admin enabled PPPoE notification`);
                            await pppoeCommands.handleEnablePPPoENotifications(remoteJid);
                            return;

                        case 'off':
                        case 'disable':
                            console.log(`Admin disabled PPPoE notification`);
                            await pppoeCommands.handleDisablePPPoENotifications(remoteJid);
                            return;

                        case 'status':
                            console.log(`Admin viewing PPPoE notification status`);
                            await pppoeCommands.handlePPPoEStatus(remoteJid);
                            return;

                        case 'addadmin':
                            if (params.length >= 2) {
                                console.log(`Admin adding PPPoE admin number: ${params[1]}`);
                                await pppoeCommands.handleAddAdminNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `❌ *WRONG FORMAT*\n\nFormat: pppoe addadmin [number]\nExample: pppoe addadmin 081234567890`
                                });
                            }
                            return;

                        case 'addtech':
                        case 'addtechnician':
                            if (params.length >= 2) {
                                console.log(`Admin adding PPPoE technician number: ${params[1]}`);
                                await pppoeCommands.handleAddTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `❌ *WRONG FORMAT*\n\nFormat: pppoe addtech [number]\nExample: pppoe addtech 081234567890`
                                });
                            }
                            return;

                        case 'interval':
                            if (params.length >= 2) {
                                console.log(`Admin changing PPPoE interval: ${params[1]}`);
                                await pppoeCommands.handleSetInterval(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `❌ *WRONG FORMAT*\n\nFormat: pppoe interval [seconds]\nExample: pppoe interval 60`
                                });
                            }
                            return;

                        case 'test':
                            console.log(`Admin testing PPPoE notification`);
                            await pppoeCommands.handleTestNotification(remoteJid);
                            return;

                        case 'removeadmin':
                        case 'deladmin':
                            if (params.length >= 2) {
                                console.log(`Admin deleting PPPoE admin number: ${params[1]}`);
                                await pppoeCommands.handleRemoveAdminNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `❌ *WRONG FORMAT*\n\nFormat: pppoe removeadmin [number]\nExample: pppoe removeadmin 081234567890`
                                });
                            }
                            return;

                        case 'removetech':
                        case 'deltech':
                        case 'removetechnician':
                        case 'deltechnician':
                            if (params.length >= 2) {
                                console.log(`Admin deleting PPPoE technician number: ${params[1]}`);
                                await pppoeCommands.handleRemoveTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `❌ *WRONG FORMAT*\n\nFormat: pppoe removetech [number]\nExample: pppoe removetech 081234567890`
                                });
                            }
                            return;

                        default:
                            await sock.sendMessage(remoteJid, {
                                text: `❌ *UNKNOWN COMMAND*\n\n` +
                                      `Available PPPoE commands:\n` +
                                      `• pppoe on - Enable notification\n` +
                                      `• pppoe off - Disable notification\n` +
                                      `• pppoe status - View status\n` +
                                      `• pppoe addadmin [number] - Add admin\n` +
                                      `• pppoe addtech [number] - Add technician\n` +
                                      `• pppoe removeadmin [number] - Delete admin\n` +
                                      `• pppoe removetech [number] - Delete technician\n` +
                                      `• pppoe interval [seconds] - Edit interval\n` +
                                      `• pppoe test - Test notification`
                            });
                            return;
                    }
                }
            }
            
            // List ONU command
            if (command === 'list' || command === '!list' || command === '/list') {
                console.log(`Running list ONU command`);
                await handleListONU(remoteJid);
                return;
            }
            
            // Check all ONU command
            if (command === 'cekall' || command === '!cekall' || command === '/cekall') {
                console.log(`Running check all ONU command`);
                await handleCheckAllONU(remoteJid);
                return;
            }
            
            // Delete hotspot user command
            if (command.startsWith('delhotspot ') || command.startsWith('!delhotspot ') || command.startsWith('/delhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running delete hotspot user command ${params[0]}`);
                    await handleDeleteHotspotUser(remoteJid, params);
                    return;
                }
            }
            
            // Delete PPPoE secret command
            if (command.startsWith('delpppoe ') || command.startsWith('!delpppoe ') || command.startsWith('/delpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running delete PPPoE secret command ${params[0]}`);
                    await handleDeletePPPoESecret(remoteJid, params);
                    return;
                }
            }
            
            // Add hotspot user command
            if (command.startsWith('addhotspot ') || command.startsWith('!addhotspot ') || command.startsWith('/addhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running add hotspot user command ${params[0]}`);
                    await handleAddHotspotUser(remoteJid, params);
                    return;
                }
            }
            
            // Add PPPoE secret command
            if (command.startsWith('addpppoe ') || command.startsWith('!addpppoe ') || command.startsWith('/addpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running add PPPoE secret command ${params[0]}`);
                    await handleAddPPPoESecret(remoteJid, params);
                    return;
                }
            }
            
            // Change PPPoE profile command
            if (command.startsWith('setprofile ') || command.startsWith('!setprofile ') || command.startsWith('/setprofile ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running change PPPoE profile command ${params[0]}`);
                    await handleChangePPPoEProfileeeeeeeeee(remoteJid, params);
                    return;
                }
            }
            
            // Resource info command
            if (command === 'resource' || command === '!resource' || command === '/resource') {
                console.log(`Running resource info command`);
                await handleResourceInfo(remoteJid);
                return;
            }
            
            // Add WAN command
            if (command.startsWith('addwan ') || command.startsWith('!addwan ') || command.startsWith('/addwan ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 3) {
                    console.log(`Running add WAN command for ${params[0]}`);
                    await handleAddWAN(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `addwan [customer_number] [wan_type] [connection_mode]\n\n` +
                              `WAN Type: ppp or ip\n` +
                              `Connection Mode: bridge or route\n\n` +
                              `Example:\n` +
                              `addwan 081234567890 ppp route\n` +
                              `addwan 081234567890 ppp bridge\n` +
                              `addwan 081234567890 ip bridge`
                    });
                    return;
                }
            }
            
            // Perintah tambah tag customer
            if (command.startsWith('addtag ') || command.startsWith('!addtag ') || command.startsWith('/addtag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running add tag command for device ${params[0]}`);
                    await addCustomerTag(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `addtag [device_id] [customer_number]\n\n` +
                              `Example:\n` +
                              `addtag 202BC1-BM632w-000000 081234567890`
                    });
                    return;
                }
            }
            
            // Add customer tag based on PPPoE Username
            if (command.startsWith('addpppoe_tag ') || command.startsWith('!addpppoe_tag ') || command.startsWith('/addpppoe_tag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running add tag command for PPPoE Username ${params[0]}`);
                    await addTagByPPPoE(remoteJid, params, sock); // <-- ADD sock here!
                    return;
                } else {
                    await sock.sendMessage(remoteJid, { 
                        text: `❌ *WRONG FORMAT!*\n\n` +
                              `Correct format:\n` +
                              `addpppoe_tag [pppoe_username] [customer_number]\n\n` +
                              `Example:\n` +
                              `addpppoe_tag user123 081234567890`
                    });
                    return;
                }
            }
            
            // Active hotspot users command
            if (command === 'hotspot' || command === '!hotspot' || command === '/hotspot') {
                console.log(`Running active hotspot users command`);
                await handleActiveHotspotUsers(remoteJid);
                return;
            }
            
            // Active PPPoE connections command
            if (command === 'pppoe' || command === '!pppoe' || command === '/pppoe') {
                console.log(`Running active PPPoE connections command`);
                await handleActivePPPoE(remoteJid);
                return;
            }
            
            // Offline PPPoE users command
            if (command === 'offline' || command === '!offline' || command === '/offline') {
                console.log(`Running offline PPPoE users command`);
                await handleOfflineUsers(remoteJid);
                return;
            }

            // List interfaces command
            if (command === 'interfaces' || command === '!interfaces' || command === '/interfaces') {
                console.log(`Running list interfaces command`);
                await mikrotikCommands.handleInterfaces(remoteJid);
                return;
            }

            // Interface detail command
            if (command.startsWith('interface ') || command.startsWith('!interface ') || command.startsWith('/interface ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running interface detail command for ${params[0]}`);
                    await mikrotikCommands.handleInterfaceDetail(remoteJid, params);
                    return;
                }
            }

            // Enable interface command
            if (command.startsWith('enableif ') || command.startsWith('!enableif ') || command.startsWith('/enableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running enable interface command for ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, true);
                    return;
                }
            }

            // Disable interface command
            if (command.startsWith('disableif ') || command.startsWith('!disableif ') || command.startsWith('/disableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running disable interface command for ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, false);
                    return;
                }
            }

            // List IP addresses command
            if (command === 'ipaddress' || command === '!ipaddress' || command === '/ipaddress') {
                console.log(`Running list IP addresses command`);
                await mikrotikCommands.handleIPAddresses(remoteJid);
                return;
            }

            // Routing table command
            if (command === 'routes' || command === '!routes' || command === '/routes') {
                console.log(`Running routing table command`);
                await mikrotikCommands.handleRoutes(remoteJid);
                return;
            }

            // DHCP leases command
            if (command === 'dhcp' || command === '!dhcp' || command === '/dhcp') {
                console.log(`Running DHCP leases command`);
                await mikrotikCommands.handleDHCPLeases(remoteJid);
                return;
            }

            // Ping command
            if (command.startsWith('ping ') || command.startsWith('!ping ') || command.startsWith('/ping ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running ping command for ${params[0]}`);
                    await mikrotikCommands.handlePing(remoteJid, params);
                    return;
                }
            }

            // System logs command
            if (command === 'logs' || command === '!logs' || command === '/logs' ||
                command.startsWith('logs ') || command.startsWith('!logs ') || command.startsWith('/logs ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running system logs command`);
                await mikrotikCommands.handleSystemLogs(remoteJid, params);
                return;
            }

            // Profiles command
            if (command === 'profiles' || command === '!profiles' || command === '/profiles' ||
                command.startsWith('profiles ') || command.startsWith('!profiles ') || command.startsWith('/profiles ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running profiles command`);
                await mikrotikCommands.handleProfileeeeeeeeees(remoteJid, params);
                return;
            }

            // Firewall command
            if (command === 'firewall' || command === '!firewall' || command === '/firewall' ||
                command.startsWith('firewall ') || command.startsWith('!firewall ') || command.startsWith('/firewall ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running firewall command`);
                await mikrotikCommands.handleFirewall(remoteJid, params);
                return;
            }

            // All users command
            if (command === 'users' || command === '!users' || command === '/users') {
                console.log(`Running all users command`);
                await mikrotikCommands.handleAllUsers(remoteJid);
                return;
            }

            // Clock router command
            if (command === 'clock' || command === '!clock' || command === '/clock') {
                console.log(`Running clock router command`);
                await mikrotikCommands.handleRouterClock(remoteJid);
                return;
            }

            // Identity router command
            if (command === 'identity' || command === '!identity' || command === '/identity' ||
                command.startsWith('identity ') || command.startsWith('!identity ') || command.startsWith('/identity ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running identity router command`);
                await mikrotikCommands.handleRouterIdentity(remoteJid, params);
                return;
            }

            // Restart router command
            if (command === 'reboot' || command === '!reboot' || command === '/reboot') {
                console.log(`Running restart router command`);
                await mikrotikCommands.handleRestartRouter(remoteJid);
                return;
            }

            // Restart confirmation command
            if (command === 'confirm restart' || command === '!confirm restart' || command === '/confirm restart') {
                console.log(`Running restart router confirmation`);
                await mikrotikCommands.handleConfirmRestart(remoteJid);
                return;
            }

            // Debug resource command (admin only)
            if (command === 'debug resource' || command === '!debug resource' || command === '/debug resource') {
                console.log(`Admin running debug resource`);
                await mikrotikCommands.handleDebugResource(remoteJid);
                return;
            }
            
            // WiFi info command
            if (command === 'info wifi' || command === '!info wifi' || command === '/info wifi') {
                console.log(`Running WiFi info command for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleWifiInfo(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Change WiFi name command
            if (command.startsWith('gantiwifi ') || command.startsWith('!gantiwifi ') || command.startsWith('/gantiwifi ')) {
                console.log(`Running change WiFi name command for ${senderNumber}`);
                const newSSID = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiSSID(remoteJid, senderNumber, newSSID);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Change WiFi password command
            if (command.startsWith('gantipass ') || command.startsWith('!gantipass ') || command.startsWith('/gantipass ')) {
                console.log(`Running change WiFi password command for ${senderNumber}`);
                const newPassword = messageText.split(' ').slice(1).join(' ');
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleChangeWifiPassword(remoteJid, senderNumber, newPassword);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Device status command
            if (command === 'status' || command === '!status' || command === '/status') {
                console.log(`Running device status command for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleDeviceStatus(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Device restart command
            if (command === 'restart' || command === '!restart' || command === '/restart') {
                console.log(`Running device restart command for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartDevice(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Device restart confirmation
            if ((command === 'ya' || command === 'iya' || command === 'yes') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Device restart confirmation for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, true);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
            
            // Cancel device restart
            if ((command === 'tidak' || command === 'no' || command === 'batal' || command === 'cancel') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Canceling device restart for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, false);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }
        }
        
        // If message is not recognized as command, just ignore
        console.log(`Message not recognized as command: ${messageText}`);
        // Do nothing for messages that are not commands
        
    } catch (error) {
        console.error('Error handling incoming message:', error);
        
        // Try to send error message to sender
        try {
            if (sock && message && message.key && message.key.remoteJid) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: `❌ *ERROR*\n\nAn error occurred while processing message: ${error.message}\n\nPlease try again later.`
                });
            }
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Add in function declaration section before 
    // Function to display customer menu
    async function sendCustomerMenu(remoteJid) {
        try {
            console.log(`Displaying customer menu to ${remoteJid}`);
            
            // Use help message from separate file
            const customerMessage = getCustomerHelpMessage();
            
            // Send customer menu message
            await sock.sendMessage(remoteJid, { text: customerMessage });
            console.log(`Customer menu message sent to ${remoteJid}`);
            
        } catch (error) {
            console.error('Error sending customer menu:', error);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nAn error occurred while displaying customer menu:\n${error.message}` 
            });
        }
    }

module.exports

// Function to display admin menu
async function handleAdminMenu(remoteJid) {
    try {
        console.log(`Displaying admin menu to ${remoteJid}`);
        
        // Admin menu message
        let adminMessage = `👨‍💼 *MENU ADMIN*\n\n`;
        
        adminMessage += `*Admin Commands:*\n`;
        adminMessage += `• 📋 *list* — List all ONUs\n`;
        adminMessage += `• 🔍 *cekall* — Check status of all ONUs\n`;
        adminMessage += `• 🔍 *cek [number]* — Check customer ONU status\n`;
        adminMessage += `• 📶 *editssid [number] [ssid]* — Edit customer SSID\n`;
        adminMessage += `• 🔒 *editpass [number] [password]* — Edit customer WiFi password\n\n`;
        
        // GenieACS status (without showing commands)
        adminMessage += `*System Status:*\n`;
        adminMessage += `• ${genieacsCommandsEnabled ? '✅' : '❌'} *GenieACS:* ${genieacsCommandsEnabled ? 'Active' : 'Inactive'}\n\n`;
        
        // Add footer
        adminMessage += `🏢 *${getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP') || 'ISP Monitor'}*\n`;
        adminMessage += `${getSetting('footer_info', 'Unlimited Internet') || ''}`;
        
        // Send admin menu message
        await sock.sendMessage(remoteJid, { text: adminMessage });
        console.log(`Admin menu message sent to ${remoteJid}`);
        
        return true;
    } catch (error) {
        console.error('Error sending admin menu:', error);
        return false;
    }
}

// Function to get SSID value from device
function getSSIDValue(device, configIndex) {
    try {
        // Try method 1: Using bracket notation for WLANConfiguration
        if (device.InternetGatewayDevice && 
            device.InternetGatewayDevice.LANDevice && 
            device.InternetGatewayDevice.LANDevice['1'] && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex] && 
            device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID) {
            
            const ssidObj = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID;
            if (ssidObj._value !== undefined) {
                return ssidObj._value;
            }
        }
        
        // Try method 2: Using getParameterWithPaths
        const ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${configIndex}.SSID`;
        const ssidValue = getParameterWithPaths(device, [ssidPath]);
        if (ssidValue && ssidValue !== 'N/A') {
            return ssidValue;
        }
        
        // Try method 3: Search entire object
        for (const key in device) {
            if (device[key]?.LANDevice?.['1']?.WLANConfiguration?.[configIndex]?.SSID?._value) {
                return device[key].LANDevice['1'].WLANConfiguration[configIndex].SSID._value;
            }
        }
        
        // Try method 4: Search in virtual parameters
        if (device.VirtualParameters?.SSID?._value) {
            return device.VirtualParameters.SSID._value;
        }
        
        if (configIndex === '5' && device.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['2']?.SSID?._value) {
            return device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration['2'].SSID._value;
        }
        
        return 'N/A';
    } catch (error) {
        console.error(`Error getting SSID for config ${configIndex}:`, error);
        return 'N/A';
    }
}

const settingsPath = path.join(__dirname, '../settings.json');

function getAppSettings() {
    try {
        // Use existing settingsManager
        const { getAllSettings } = require('./settingsManager');
const { getAdminHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage } = require('./help-messages');

        return getAllSettings();
    } catch (e) {
        console.error('Error getting app settings:', e);
        return {};
    }
}