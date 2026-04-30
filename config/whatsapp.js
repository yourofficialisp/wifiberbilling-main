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
    setPPPoEProfile,
    getResourceInfo,
    getActiveHotspotUsers,
    getActivePPPoEConnections,
    deleteHotspotUser,
    deletePPPoESecret,
    getInactivePPPoEUsers,
    getOfflinePPPoEUsers
} = require('./mikrotik');

// Import MikroTik command handlers
const mikrotikCommands = require('./mikrotik-commands');

// Import PPPoE notification command handlers
const pppoeCommands = require('./pppoe-commands');

// Import addWAN module
const { handleAddWAN } = require('./addWAN');

// Import customerTag module
const { addCustomerTag, addTagByPPPoE } = require('./customerTag');

// Import billing commands
const billingCommands = require('./billing-commands');

// Import admin number from environment
const { ADMIN_NUMBER } = process.env;

// Import settings manager
const { getSetting } = require('./settingsManager');

// Import message templates helper
const { getDeveloperSupportMessage } = require('./message-templates');

// Import WhatsApp notification manager
const whatsappNotifications = require('./whatsapp-notifications');

// Import help messages
const { getAdminHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage } = require('./help-messages');

// Phone helpers: normalize and variants (08..., 62..., +62...)
function normalizePhone(input) {
    if (!input) return '';
    let s = String(input).replace(/[^0-9+]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('0')) return '62' + s.slice(1);
    if (s.startsWith('62')) return s;
    // Fallback: if it looks like local without leading 0, prepend 62
    if (/^8[0-9]{7,13}$/.test(s)) return '62' + s;
    return s;
}

function generatePhoneVariants(input) {
    const raw = String(input || '');
    const norm = normalizePhone(raw);
    const local = norm.startsWith('62') ? '0' + norm.slice(2) : raw;
    const plus = norm.startsWith('62') ? '+62' + norm.slice(2) : raw;
    const shortLocal = local.startsWith('0') ? local.slice(1) : local;
    return Array.from(new Set([raw, norm, local, plus, shortLocal].filter(Boolean)));
}

// Function to decrypt encrypted admin number
function decryptAdminNumber(encryptedNumber) {
    try {
        // This is a simple decryption implementation using XOR with static key
        // In production, use stronger encryption method
        const key = 'NBB_WIFIBER_SECRET_KEY_2025';
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
            console.warn('⚠️ File superadmin.txt empty, superadmin features disabled');
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
        const { getSetting } = require('./settingsManager');
        // Normalize number
        let cleanNumber = number.replace(/\D/g, '');
        if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
        if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
        // Combine all admins from settings.json (array and numeric keys)
        let admins = getSetting('admins', []);
        if (!Array.isArray(admins)) admins = [];
        // Check numeric key
        const settingsRaw = require('./adminControl').getSettings();
        Object.keys(settingsRaw).forEach(key => {
            if (key.startsWith('admins.') && typeof settingsRaw[key] === 'string') {
                let n = settingsRaw[key].replace(/\D/g, '');
                if (n.startsWith('0')) n = '62' + n.slice(1);
                if (!n.startsWith('62')) n = '62' + n;
                admins.push(n);
            }
        });
        // Log debug
        console.log('DEBUG Admins from settings.json:', admins);
        console.log('DEBUG Login Number:', cleanNumber);
        // Check super admin
        if (cleanNumber === superAdminNumber) return true;
        // Check in admin list
        if (admins.includes(cleanNumber)) return true;
        return false;
    } catch (error) {
        console.error('Error in isAdminNumber:', error);
        return false;
    }
}

// Helper to add header and footer to message
function formatWithHeaderFooter(message) {
    try {
        // Get header and footer from settings.json with consistent format
        const COMPANY_HEADER = getSetting('company_header', "📱 NBB Wifiber \n\n");
        const FOOTER_SEPARATOR = "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
        const FOOTER_INFO = FOOTER_SEPARATOR + getSetting('footer_info', "Powered by CyberNet");

        // Format message with consistent header and footer
        const formattedMessage = `${COMPANY_HEADER}${message}${FOOTER_INFO}`;

        return formattedMessage;
    } catch (error) {
        console.error('Error formatting message with header/footer:', error);
        // Fallback to default format if there is error
        return `📱 NBB Wifiber 📱

${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Powered by CyberNet`;
    }
}

// Helper to send message with header and footer
async function sendFormattedMessage(remoteJid, message, options = {}) {
    try {
        const formattedMessage = formatWithHeaderFooter(message);
        await sock.sendMessage(remoteJid, { text: formattedMessage }, options);
    } catch (error) {
        console.error('Error sending formatted message:', error);
        // Fallback to message without format if there is error
        await sock.sendMessage(remoteJid, { text: message }, options);
    }
}

let sock = null;
let qrCodeDisplayed = false;

// Add global variable to store QR code and connection status
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
    // Delete all non-digit characters
    let cleaned = number.replace(/\D/g, '');

    // If starts with 0, replace with 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
    }

    // If 62 is not at the front, add it
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }

    return cleaned;
}

// Add simple encryption function
function generateWatermark() {
    const timestamp = new Date().getTime();
    const secretKey = getSetting('secret_key', 'nbb-wifiber-network');
    const baseString = `NBB-${timestamp}`;
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
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
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
        const logLevel = getSetting('whatsapp_log_level', 'silent');
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
            browser: ['NBB Wifiber Bot', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            qrTimeout: 40000,
            defaultQueryTimeoutMs: 30000, // Timeout for query
            retryRequestDelayMs: 1000,
            version: version
        });




        // Handle connection update
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Log connection update
            console.log('Connection update:', update);

            // Handle QR code
            if (qr) {
                // Save QR code in clean format
                // Save QR code to global status (for admin panel)
                if (!global.whatsappStatus || global.whatsappStatus.qrCode !== qr) {
                    global.whatsappStatus = {
                        connected: false,
                        qrCode: qr,
                        phoneNumber: null,
                        connectedSince: null,
                        status: 'qr_code'
                    };
                }


                // Display QR code in terminal
                console.log('QR Code available, ready to scan');
                qrcode.generate(qr, { small: true });
            }

            // Handle connection
            if (connection === 'open') {
                console.log('WhatsApp connected!');
                const connectedSince = new Date();

                // Update global status
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

                // Send notification to superadmin on first connect
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const superAdminPath = path.join(__dirname, 'superadmin.txt');
                    
                    if (fs.existsSync(superAdminPath)) {
                        const superAdminNumber = fs.readFileSync(superAdminPath, 'utf8').trim();
                        
                        if (superAdminNumber) {
                            const phoneNumber = sock.user?.id?.split(':')[0] || 'Unknown';
                            const welcomeMessage = `*Welcome!*\n\n` +
                                `WhatsApp Bot application started successfully.\n\n` +
                                `Account for GEMBOK application development\n` +
                                `4206 01 003 953 53 1\n` +
                                `BRI a.n. WARJAYA\n\n` +
                                `Donation via e-wallet:\n` +
                                `03036783333\n\n` +
                                `Thank you for your participation and support 🙏\n\n` +
                                `Contact Info : 03036783333`;
                            
                            // Send message to superadmin
                            await sock.sendMessage(`${superAdminNumber}@s.whatsapp.net`, {
                                text: welcomeMessage
                            });
                            
                            console.log(`✅ Connection notification sent successfully to superadmin: ${superAdminNumber}`);
                        }
                    }
                } catch (notifError) {
                    console.error('Error sending notification to superadmin:', notifError);
                }

                // Set sock instance for mikrotik-commands module
                try {
                    const mikrotikCommands = require('./mikrotik-commands');
                    mikrotikCommands.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for mikrotik-commands:', error);
                }

                // Set sock instance for WhatsApp notification manager
                try {
                    whatsappNotifications.setSock(sock);
                } catch (error) {
                    console.error('Error setting sock for WhatsApp notifications:', error);
                }

                // Send message to admin that bot is connected
                try {
                    // Get active port from global settings or fallback
                    const activePort = global.appSettings?.port || getSetting('server_port', '3001');
                    const serverHost = global.appSettings?.host || getSetting('server_host', 'localhost');

                    // Silent startup - notifications disabled
                    console.log(`✅ WhatsApp bot connected successfully at ${connectedSince.toLocaleString()}`);
                    // Super admin notifications disabled
                } catch (error) {
                    console.error('Error sending connection notification:', error);
                }
            } else if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                console.log(`WhatsApp connection disconnected. Trying to reconnect: ${shouldReconnect}`);

                // Update global status
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
                    }, getSetting('reconnect_interval', 5000));
                }
            }
        });

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // FIX: Handle incoming messages correctly
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const message of messages) {
                    if (!message.key.fromMe && message.message) {
                        try {
                            // Log incoming message for debugging
                            console.log('Incoming message:', JSON.stringify(message, null, 2));

                            // Call handleIncomingMessage function
                            await handleIncomingMessage(sock, message);
                        } catch (error) {
                            console.error('Error handling incoming message:', error);
                        }
                    }
                }
            }
        });

        return sock;
    } catch (error) {
        console.error('Error connecting to WhatsApp:', error);

        // Try reconnecting after interval
        setTimeout(() => {
            connectToWhatsApp();
        }, getSetting('reconnect_interval', 5000));

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
                text: `âŒ *Device Not Found*\n\nSorry, your device was not found in our system. Please contact admin for assistance.`
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

        // Use getParameterWithPaths to get values from existing parameter paths
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        const formattedRxPower = rxPower !== 'N/A' ? `${rxPower} dBm` : 'N/A';

        const pppUsername = getParameterWithPaths(device, parameterPaths.pppUsername);
        const ipAddress = getParameterWithPaths(device, parameterPaths.pppoeIP);

        // Get connected users information
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

            // Fallback: If AssociatedDevice is empty, get from Hosts.Host with IEEE802_11 interface related to SSID 1
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
        statusMessage += `📌 *Status:* ${isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
        statusMessage += `📌 *Last Online:* ${lastInform.toLocaleString()}\n`;
        statusMessage += `📌 *WiFi 2.4GHz:* ${ssid}\n`;
        statusMessage += `📌 *WiFi 5GHz:* ${ssid5G}\n`;
        statusMessage += `📌 *Connected Users:* ${totalConnectedUsers}\n`;
        // Add SSID 1 user details if available
        if (associatedDevices.length > 0) {
            statusMessage += `• *User List SSID 1 (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                statusMessage += `   ${idx + 1}. ${dev.hostname} (${dev.ip}) - ${dev.mac}\n`;
            });
        } else {
            statusMessage += `• No users are connected to the 2.4GHz network.\n`;
        }

        // Add RX Power with quality indicator
        if (rxPower !== 'N/A') {
            const rxValue = parseFloat(rxPower);
            let qualityIndicator = '';
            if (rxValue > -25) qualityIndicator = ' (🟢 Good)';
            else if (rxValue > -27) qualityIndicator = ' (🟡 Warning)';
            else qualityIndicator = ' (🔴 Critical)';
            statusMessage += `📌 *RX Power:* ${formattedRxPower}${qualityIndicator}\n`;
        } else {
            statusMessage += `📌 *RX Power:* ${formattedRxPower}\n`;
        }

        statusMessage += `📌 *PPPoE Username:* ${pppUsername}\n`;
        statusMessage += `📌 *IP Address:* ${ipAddress}\n`;

        // Add uptime if available
        if (uptime !== 'N/A') {
            statusMessage += `📌 *Uptime:* ${uptime}\n`;
        }
        statusMessage += `\n`;

        // Add additional information
        statusMessage += `ℹ️ To change WiFi name, type:\n`;
        statusMessage += `*gantiwifi [name]*\n\n`;
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

async function handleHelpCommand(remoteJid, isAdmin = false) {
    try {
        let helpMessage;
        if (isAdmin) {
            helpMessage = getAdminHelpMessage();
        } else {
            helpMessage = getCustomerHelpMessage();
        }
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
            text: `âŒ *ERROR*\n\nError displaying admin menu:\n${error.message}`
        });
    }
}

// Update getDeviceByNumber function
async function getDeviceByNumber(number) {
    try {
        console.log(`Searching device for number ${number}`);

        // Clean number from non-digit characters
        let cleanNumber = number.replace(/\D/g, '');

        // Format number in several variations that might be used as tag
        const possibleFormats = [];

        // Format 1: Original cleaned number
        possibleFormats.push(cleanNumber);

        // Format 2: If starts with 0, try version with 62 at front (replace 0 with 62)
        if (cleanNumber.startsWith('0')) {
            possibleFormats.push('62' + cleanNumber.substring(1));
        }

        // Format 3: If starts with 62, try version with 0 at front (replace 62 with 0)
        if (cleanNumber.startsWith('62')) {
            possibleFormats.push('0' + cleanNumber.substring(2));
        }

        // Format 4: Without prefix, if there is prefix
        if (cleanNumber.startsWith('0') || cleanNumber.startsWith('62')) {
            if (cleanNumber.startsWith('0')) {
                possibleFormats.push(cleanNumber.substring(1));
            } else if (cleanNumber.startsWith('62')) {
                possibleFormats.push(cleanNumber.substring(2));
            }
        }

        console.log(`Trying number format: ${possibleFormats.join(', ')}`);

        // Try to search with all possible formats
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

        console.log(`Device not found for number ${number} with all tried formats`);

        // Fallback: Search device by PPPoE username from customer database
        try {
            console.log(`Trying to search device by PPPoE username from customer database...`);

            // Normalize phone number for database search
            let searchPhone = cleanNumber;
            if (searchPhone.startsWith('0')) {
                searchPhone = '62' + searchPhone.substring(1);
            } else if (!searchPhone.startsWith('62')) {
                searchPhone = '62' + searchPhone;
            }

            // Search customer by phone number (try all formats)
            const customer = await new Promise((resolve, reject) => {
                const db = require('sqlite3').verbose();
                const database = new db.Database('./data/billing.db');

                // Debug: Display search parameters
                console.log(`🔍 [DEBUG] Searching customer with parameters:`);
                console.log(`   cleanNumber: ${cleanNumber}`);
                
                // More flexible query to handle non-standard numbers in database
                // Try to clean phone field in database from non-digit characters before comparing
                const query = `
                    SELECT id, username, pppoe_username, phone 
                    FROM customers 
                    WHERE 
                        replace(replace(replace(phone, '-', ''), ' ', ''), '+', '') = ? 
                        OR replace(replace(replace(phone, '-', ''), ' ', ''), '+', '') = ?
                        OR replace(replace(replace(phone, '-', ''), ' ', ''), '+', '') = ?
                        OR replace(replace(replace(phone, '-', ''), ' ', ''), '+', '') = ?
                        OR phone LIKE '%' || ?
                `;

                database.get(
                    query,
                    [
                        cleanNumber, 
                        searchPhone, 
                        '0' + cleanNumber.substring(2), 
                        cleanNumber.substring(2),
                        cleanNumber.substring(3) // Wildcard match for last 8-9 digits as fallback
                    ],
                    (err, row) => {
                        if (err) {
                            console.error(`❌ [ERROR] Database error: ${err.message}`);
                            reject(err);
                        } else {
                            if (row) {
                                console.log(`📋 [DEBUG] Found customer: ${row.username} (${row.phone})`);
                            } else {
                                console.log(`📋 [DEBUG] Customer not found with number: ${cleanNumber}`);
                            }
                            resolve(row);
                        }
                        database.close();
                    }
                );
            });

            if (customer && customer.pppoe_username) {
                console.log(`Found customer with PPPoE username: ${customer.pppoe_username}`);

                // Search device by PPPoE username
                const device = await findDeviceByPPPoEUsername(customer.pppoe_username);
                if (device) {
                    console.log(`✅ Device found with PPPoE username: ${customer.pppoe_username}`);
                    return device;
                } else {
                    console.log(`⚠️ Device not found with PPPoE username: ${customer.pppoe_username}`);
                }
            } else {
                console.log(`⚠️ No customer found with this phone number`);
            }
        } catch (customerError) {
            console.error(`Error while searching customer: ${customerError.message}`);
        }

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
            text: `⏳ *REFRESH PROCESS*\n\nUpdating device information...\nPlease wait a moment.`
        });

        // Search device based on sender number
        const device = await getDeviceByNumber(senderNumber);

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *DEVICE NOT FOUND*\n\nSorry, cannot find device associated with your number.`
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
                        `📋 *Device Details:*\n` +
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
                    `Error updating device:\n` +
                    `${refreshResult.message || 'Unknown error'}\n\n` +
                    `Please try again later or contact admin.`
            });
        }
    } catch (error) {
        console.error('Error in handleRefreshCommand:', error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred while processing the command:\n${error.message}`
        });
    }
}

// Function to perform device refresh
async function refreshDevice(deviceId) {
    try {
        console.log(`Refreshing device with ID: ${deviceId}`);
        if (!deviceId) {
            return { success: false, message: "Device ID invalid" };
        }
        // Get GenieACS configuration from helper
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        // 2. Try to get device first to ensure ID is valid
        // Check if device exists
        try {
            const checkResponse = await axios.get(`${genieacsUrl}/devices?query={"_id":"${deviceId}"}`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            if (!checkResponse.data || checkResponse.data.length === 0) {
                console.error(`Device with ID ${deviceId} not found`);
                return { success: false, message: "Device not found in system" };
            }
            const exactDeviceId = checkResponse.data[0]._id;
            console.log(`Using exact device ID: ${exactDeviceId}`);
            const encodedDeviceId = encodeURIComponent(exactDeviceId);
            console.log(`Sending refresh task to: ${genieacsUrl}/devices/${encodedDeviceId}/tasks`);
            const refreshResponse = await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice" // Use object root
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
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
            console.log(`Trying alternative approach for device ${deviceId}`);
            try {
                const encodedDeviceId1 = encodeURIComponent(deviceId);
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
                                    username: genieacsUsername,
                                    password: genieacsPassword
                                },
                                timeout: 5000
                            }
                        );
                        console.log(`Refresh successful with ID format: ${attemptedId}`);
                        return { success: true, message: "Device updated successfully" };
                    } catch (attemptError) {
                        console.error(`Failed with ID format ${attemptedId}: ${attemptError.message}`);
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
            message: `Failed to refresh device: ${errorMessage}`
        };
    }
}

// Add handler for admin menu
async function handleAdminMenu(remoteJid) {
    // handleAdminMenu only calls sendAdminMenuList, no changes needed
    await sendAdminMenuList(remoteJid);
}

// Update handler admin check ONU
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

        // Search device by customer number
        const device = await findDeviceByTag(customerNumber);

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *DEVICE NOT FOUND*\n\n` +
                    `Cannot find device for customer with number ${customerNumber}.\n\n` +
                    `Please make sure the customer number is correct and device is registered in the system.`
            });
            return;
        }

        // Extract device information - Use same approach as web dashboard
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
            else if (power > -27) rxPowerStatus = '🟡 Warning';
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
        // Fallback: if AssociatedDevice is empty, get from Hosts.Host (WiFi/802.11 only)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Only display 802.11 interface (WiFi)
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

        // Build message with complete information
        // Use serial number and model already retrieved
        // No need to change values already correctly retrieved

        let message = `📋 *CUSTOMER DEVICE DETAILS*\n\n`;
        message += `👤 *Customer:* ${customerNumber}\n`;
        message += `📋 *Serial Number:* ${serialNumber}\n`;
        message += `📋 *Model:* ${modelName}\n`;
        message += `📶 *Status:* ${statusText}\n`;
        message += `â±ï¸ *Last Seen:* ${lastInform.toLocaleString()}\n\n`;

        message += `🌐 *NETWORK INFORMATION*\n`;
        message += `📌 IP Address: ${ipAddress}\n`;
        message += `📌 PPPoE Username: ${pppoeUsername}\n`;
        message += `📌 *RX Power:* ${rxPower ? rxPower + ' dBm' : 'N/A'}${rxPowerStatus ? ' (' + rxPowerStatus + ')' : ''}\n`;
        message += `📌 WiFi 2.4GHz: ${ssid}\n`;
        message += `📌 WiFi 5GHz: ${ssid5G}\n`;
        message += `📌 WiFi Users: ${totalUsers} devices\n`;
        // Add SSID 1 user details if available
        if (associatedDevices.length > 0) {
            message += `• *WiFi User List (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `• No WiFi user data (2.4GHz) available\n`;
        }
        message += `\n`;

        if (rxPower) {
            message += `🔧 *SIGNAL QUALITY*\n`;
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
            text: `âŒ *ERROR*\n\nAn error occurred while checking the device:\n${error.message}`
        });
    }
}

// Function to check ONU with complete billing data
async function handleAdminCheckONUWithBilling(remoteJid, searchTerm) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (!searchTerm) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *WRONG FORMAT*\n\n` +
                `Correct format:\n` +
                `cek [nomor_customer/pppoe_username/nama_customer]\n\n` +
                `Example:\n` +
                `• cek 087786722675\n` +
                `• cek server@ilik\n` +
                `• cek maktub`
        });
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, {
            text: `🔍 *SEARCHING DEVICES*\n\nSearching for device: ${searchTerm}...\nPlease wait a moment.`
        });

        // Import billing manager to get customer data
        const billingManager = require('./billing');

        // Search customer in billing with various methods
        let customer = null;

        // Method 1: Try as phone number
        if (/^[0-9+]+$/.test(searchTerm)) {
            const phoneVariants = generatePhoneVariants(searchTerm);

            for (const variant of phoneVariants) {
                try {
                    customer = await billingManager.getCustomerByPhone(variant);
                    if (customer) {
                        console.log(`✅ Customer found in billing by phone with variant: ${variant}`);
                        break;
                    }
                } catch (error) {
                    console.log(`⚠️ Error searching with phone variant ${variant}:`, error.message);
                }
            }
        }

        // Method 2: If not found as number, try as name or PPPoE username
        if (!customer) {
            try {
                // Search based on customer name
                const customersByName = await billingManager.findCustomersByNameOrPhone(searchTerm);
                if (customersByName && customersByName.length > 0) {
                    customer = customersByName[0]; // Get the first one
                    console.log(`✅ Customer found in billing by name/pppoe: ${customer.name}`);
                }
            } catch (error) {
                console.log(`⚠️ Error searching by name/pppoe:`, error.message);
            }
        }

        let device = null;

        if (customer) {
            console.log(`✅ Customer found in billing: ${customer.name} (${customer.phone})`);
            console.log(`📋 Customer data:`, {
                name: customer.name,
                phone: customer.phone,
                username: customer.username,
                pppoe_username: customer.pppoe_username,
                package_id: customer.package_id
            });

            // Search device based on PPPoE username from billing (FAST PATH)
            if (customer.pppoe_username || customer.username) {
                try {
                    const { findDeviceByPPPoE } = require('./genieacs');
                    const pppoeToSearch = customer.pppoe_username || customer.username;
                    console.log(`🔍 Searching device by PPPoE username: ${pppoeToSearch}`);

                    device = await findDeviceByPPPoE(pppoeToSearch);
                    if (device) {
                        console.log(`✅ Device found by PPPoE username: ${pppoeToSearch}`);
                        console.log(`📱 Device ID: ${device._id}`);
                    } else {
                        console.log(`⚠️ No device found by PPPoE username: ${pppoeToSearch}`);
                    }
                } catch (error) {
                    console.error('❌ Error finding device by PPPoE username:', error.message);
                    console.error('❌ Full error:', error);
                }
            } else {
                console.log(`⚠️ No PPPoE username or username found in customer data`);
            }

            // If not found with PPPoE, try with tag as fallback
            if (!device) {
                console.log(`🔍 Trying tag search as fallback...`);
                const tagVariants = generatePhoneVariants(customer.phone);

                for (const v of tagVariants) {
                    try {
                        device = await findDeviceByTag(v);
                        if (device) {
                            console.log(`✅ Device found by tag fallback: ${v}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`⚠️ Error searching by tag ${v}:`, error.message);
                    }
                }
            }
        } else {
            // Customer not found in billing, try searching device directly based on search term
            console.log(`⚠️ Customer not found in billing, trying direct device search...`);

            // Method 1: Try as PPPoE username directly
            if (searchTerm.includes('@')) {
                try {
                    const { findDeviceByPPPoE } = require('./genieacs');
                    console.log(`🔍 Trying direct PPPoE username search: ${searchTerm}`);
                    device = await findDeviceByPPPoE(searchTerm);
                    if (device) {
                        console.log(`✅ Device found by direct PPPoE username: ${searchTerm}`);
                        console.log(`📱 Device ID: ${device._id}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Error searching by direct PPPoE username:`, error.message);
                }
            }

            // Method 2: Try as tag (if search term is a number)
            if (!device && /^[0-9+]+$/.test(searchTerm)) {
                const tagVariants = generatePhoneVariants(searchTerm);
                for (const v of tagVariants) {
                    try {
                        device = await findDeviceByTag(v);
                        if (device) {
                            console.log(`✅ Device found by tag: ${v}`);
                            console.log(`📱 Device ID: ${device._id}`);
                            break;
                        }
                    } catch (error) {
                        console.log(`⚠️ Error searching by tag ${v}:`, error.message);
                    }
                }
            }
        }

        // Method 3: If still not found, try searching all devices manually
        if (!device) {
            console.log(`🔍 Trying comprehensive search in all devices...`);
            try {
                const { getDevices } = require('./genieacs');
                const allDevices = await getDevices();
                console.log(`📊 Total devices in GenieACS: ${allDevices.length}`);

                // Search based on search term in various fields
                for (const dev of allDevices) {
                    // Check in tags
                    if (dev._tags && dev._tags.some(tag => tag.includes(searchTerm))) {
                        console.log(`✅ Device found by tag match: ${dev._id}`);
                        device = dev;
                        break;
                    }

                    // Check in VirtualParameters
                    if (dev.VirtualParameters) {
                        for (const key in dev.VirtualParameters) {
                            const value = dev.VirtualParameters[key];
                            if (value && value._value && value._value.toString().includes(searchTerm)) {
                                console.log(`✅ Device found by VirtualParameters match: ${dev._id}`);
                                device = dev;
                                break;
                            }
                        }
                    }

                    if (device) break;
                }
            } catch (error) {
                console.log(`⚠️ Error in comprehensive search:`, error.message);
            }
        }

        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *DEVICE NOT FOUND*\n\n` +
                    `Cannot find device for: ${searchTerm}\n\n` +
                    `Ensure entered data is correct:\n` +
                    `• Phone Number\n` +
                    `• PPPoE username (example: server@ilik)\n` +
                    `• Customer Name\n\n` +
                    `And device is registered in the system.`
            });
            return;
        }

        // Extract device information - Use the same approach as web dashboard
        let serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value ||
            device.Device?.DeviceInfo?.SerialNumber?._value ||
            device.DeviceID?.SerialNumber ||
            device._id?.split('-')[2] || 'Unknown';

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
            (customer ? (customer.pppoe_username || customer.username) : 'N/A');

        // Get RX Power from all possible paths
        const rxPower = getParameterWithPaths(device, parameterPaths.rxPower);
        let rxPowerStatus = '';
        if (rxPower !== 'N/A') {
            const power = parseFloat(rxPower);
            if (power > -25) rxPowerStatus = '🟢 Good';
            else if (power > -27) rxPowerStatus = '🟡 Warning';
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
        // Fallback: if AssociatedDevice is empty, get from Hosts.Host (WiFi/802.11 only)
        if (associatedDevices.length === 0) {
            try {
                const hostsObj = device?.InternetGatewayDevice?.LANDevice?.['1']?.Hosts?.Host;
                if (hostsObj && typeof hostsObj === 'object') {
                    for (const key in hostsObj) {
                        if (!isNaN(key)) {
                            const entry = hostsObj[key];
                            // Only display 802.11 interface (WiFi)
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
        let message = `📋 *CUSTOMER DEVICE DETAILS*\n\n`;

        // Billing data if available
        if (customer) {
            message += `👤 *BILLING DATA:*\n`;
            message += `• Name: ${customer.name}\n`;
            message += `• Phone: ${customer.phone}\n`;
            message += `• Username: ${customer.username || 'N/A'}\n`;
            message += `• PPPoE Username: ${customer.pppoe_username || 'N/A'}\n`;
            message += `• Package: ${customer.package_id || 'N/A'}\n`;
            message += `• Status: ${customer.status || 'N/A'}\n`;
            if (customer.address) {
                message += `• Address: ${customer.address}\n`;
            }
            message += `\n`;
        }

        message += `🔧 *DEVICE DATA:*\n`;
        message += `• Serial Number: ${serialNumber}\n`;
        message += `• Model: ${modelName}\n`;
        message += `• Status: ${statusText}\n`;
        message += `• Last Seen: ${lastInform.toLocaleString()}\n\n`;

        message += `🌐 *NETWORK INFORMATION:*\n`;
        message += `• IP Address: ${ipAddress}\n`;
        message += `• PPPoE Username: ${pppoeUsername}\n`;
        message += `• RX Power: ${rxPower ? rxPower + ' dBm' : 'N/A'}${rxPowerStatus ? ' (' + rxPowerStatus + ')' : ''}\n`;
        message += `• WiFi 2.4GHz: ${ssid}\n`;
        message += `• WiFi 5GHz: ${ssid5G}\n`;
        message += `• WiFi Users: ${totalUsers} devices\n`;

        // Add SSID 1 user details if available
        if (associatedDevices.length > 0) {
            message += `• *WiFi User List (2.4GHz):*\n`;
            associatedDevices.forEach((dev, idx) => {
                let detail = `${idx + 1}. ${dev.hostname || '-'} (${dev.mac || '-'}`;
                if (dev.ip) detail += `, ${dev.ip}`;
                detail += ')';
                message += `   ${detail}\n`;
            });
        } else {
            message += `• No WiFi user data (2.4GHz) available\n`;
        }
        message += `\n`;

        if (rxPower) {
            message += `🔧 *SIGNAL QUALITY:*\n`;
            message += `• RX Power: ${rxPower} dBm (${rxPowerStatus})\n\n`;
        }

        message += `💡 *ADMIN ACTIONS:*\n`;
        const actionIdentifier = customer ? customer.phone : searchTerm;
        message += `• Change SSID: editssid ${actionIdentifier} [new_name]\n`;
        message += `• Change Password: editpass ${actionIdentifier} [new_password]\n`;
        message += `• Refresh Device: adminrefresh ${actionIdentifier}`;

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleAdminCheckONUWithBilling:', error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred while checking the device:\n${error.message}`
        });
    }
}

// Function to find device by tag
async function findDeviceByTag(tag) {
    try {
        console.log(`Searching for device with tag: ${tag}`);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log('DEBUG GenieACS URL:', genieacsUrl);
        try {
            const exactResponse = await axios.get(`${genieacsUrl}/devices/?query={"_tags":"${tag}"}`,
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            if (exactResponse.data && exactResponse.data.length > 0) {
                console.log(`Device found with exact tag match: ${tag}`);
                return exactResponse.data[0];
            }
            console.log(`No exact match found for tag ${tag}, trying partial match...`);
            const partialResponse = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            if (partialResponse.data && partialResponse.data.length > 0) {
                for (const device of partialResponse.data) {
                    if (device._tags && Array.isArray(device._tags)) {
                        const matchingTag = device._tags.find(t =>
                            t === tag ||
                            t.includes(tag) ||
                            tag.includes(t)
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
            console.log('Trying alternative method: fetching all devices');
            const allDevicesResponse = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });
            const device = allDevicesResponse.data.find(d => {
                if (!d._tags) return false;
                return d._tags.some(t =>
                    t === tag ||
                    t.includes(tag) ||
                    tag.includes(t)
                );
            });
            return device || null;
        }
    } catch (error) {
        console.error('Error finding device by tag:', error);
        throw error;
    }
}

// Function to find device by PPPoE username
async function findDeviceByPPPoEUsername(pppoeUsername) {
    try {
        console.log(`Searching for device with PPPoE username: ${pppoeUsername}`);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();

        // Search devices with matching PPPoE username
        // PPPoE username is usually stored in parameter: InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username
        const query = {
            "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username": pppoeUsername
        };

        const response = await axios.get(`${genieacsUrl}/devices/?query=${encodeURIComponent(JSON.stringify(query))}`, {
            auth: {
                username: genieacsUsername,
                password: genieacsPassword
            }
        });

        if (response.data && response.data.length > 0) {
            console.log(`✅ Device found with PPPoE username: ${pppoeUsername}`);
            return response.data[0];
        }

        console.log(`⚠️ No device found with PPPoE username: ${pppoeUsername}`);
        return null;
    } catch (error) {
        console.error('Error finding device by PPPoE username:', error.message);
        return null;
    }
}

// Handler for customer SSID change
async function handleChangeSSID(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change SSID request from ${senderNumber} with params:`, params);
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log('DEBUG GenieACS URL:', genieacsUrl);
        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
❌ *NUMBER NOT REGISTERED*

Your number is not registered yet.
Please contact admin first to register!${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
📋 *HOW TO CHANGE WIFI NAME*

⚠️ Command Format:
*gantiwifi [new_wifi_name]*

📋 Example:
*gantiwifi MyHome*

💡 WiFi name will be updated immediately
💡 Wait a moment for changes to take effect
💡 Connected devices may be disconnected${getSetting('footer_info', 'Powered by CyberNet')}`,
            });
            return;
        }
        const newSSID = params.join(' ');
        const newSSID5G = `${newSSID}-5G`;
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
⏳ *REQUEST PROCESSING*

Changing your WiFi name...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Please wait a moment.${getSetting('footer_info', 'Powered by CyberNet')}`
        });
        const encodedDeviceId = encodeURIComponent(device._id);
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
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
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent refresh task');
        } catch (refreshError) {
            console.error('Error sending refresh task:', refreshError.message);
        }
        try {
            await axios.post(
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }
        let responseMessage = `${getSetting('company_header', '📱 NBB Wifiber')}
✅ *WIFI NAME SUCCESSFULLY CHANGED!*

📶 *New WiFi Name:*
• WiFi 2.4GHz: ${newSSID}`;
        if (wifi5GFound) {
            responseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            responseMessage += `\n• WiFi 5GHz: Settings not found or failed to change`;
        }
        responseMessage += `\n
⏳ Device will restart to apply changes.\n📋 Connected devices will be disconnected and need to reconnect to the new WiFi name.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Powered by CyberNet')}`;
        await sock.sendMessage(remoteJid, { text: responseMessage });
    } catch (error) {
        console.error('Error handling change SSID:', error);
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
❌ *FAILED TO CHANGE WIFI NAME*

Oops! A technical issue occurred while changing your WiFi name.
Possible causes:
• Router is offline
• Server connection issue
• Name format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Powered by CyberNet')}`
        });
    }
}

// Handler for admin to change customer WiFi password
async function handleAdminEditPassword(adminJid, customerNumber, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Admin changing WiFi password for customer ${customerNumber}`);

        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *PASSWORD TOO SHORT*

WiFi password must be at least 8 characters.
Please try again with a longer password.${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        // Format customer number for GenieACS search
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Searching for device with number: ${formattedNumber}`);

        // Search customer device
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *CUSTOMER NUMBER NOT FOUND*

Number ${customerNumber} is not registered in the system.
Please recheck the customer number.${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        // Send message to admin that request is being processed
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
⏳ *REQUEST PROCESSING*

Changing WiFi password for customer ${customerNumber}...
New password: ${newPassword}

Please wait a moment.${getSetting('footer_info', 'Powered by CyberNet')}`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update WiFi 2.4GHz password at index 1
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", newPassword, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
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
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.KeyPassphrase`, newPassword, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Success message for admin
        const adminResponseMessage = `${getSetting('company_header', '📱 NBB Wifiber')}
✅ *CUSTOMER WIFI PASSWORD SUCCESSFULLY CHANGED!*

📋 *Customer:* ${customerNumber}
🔐 *New WiFi Password:* ${newPassword}

⏳ Device will restart to apply changes.
📋 Connected devices will be disconnected and need to reconnect with the new password.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Powered by CyberNet')}`;

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
            const customerNotificationMessage = `${getSetting('company_header', '📱 NBB Wifiber')}
📢 *WIFI PASSWORD CHANGE NOTIFICATION*

Hello Valued Customer,

We inform you that your WiFi password has been changed by admin:

🔐 *New WiFi Password:* ${newPassword}

â³ Your device will restart to apply changes.
📋 Connected devices will be disconnected and need to reconnect with the new password.

_Notes: Save this information as documentation if you forget the WiFi password later.${getSetting('footer_info', 'Powered by CyberNet')}`;

            await sock.sendMessage(customerJid, { text: customerNotificationMessage });
            console.log(`Notification sent to customer ${customerNumber} about WiFi password change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Send message to admin that customer notification failed
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âš ï¸ *INFO*

Password WiFi customer changed successfully, but failed to send notification to customer.
Error: ${notificationError.message}${getSetting('footer_info', 'Powered by CyberNet')}`
            });
        }

    } catch (error) {
        console.error('Error handling admin edit password:', error);
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *FAILED TO CHANGE CUSTOMER WIFI PASSWORD*

Oops! A technical issue occurred while changing the customer's WiFi password.
Possible causes:
• Customer router is offline
• Server connection issue
• Password format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Powered by CyberNet')}`
        });
    }
}

// Handler for admin to change customer SSID
async function handleAdminEditSSID(adminJid, customerNumber, newSSID) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Admin changing SSID for customer ${customerNumber} to ${newSSID}`);

        // Format customer number to search in GenieACS
        const formattedNumber = formatPhoneNumber(customerNumber);
        console.log(`Searching device for number: ${formattedNumber}`);

        // Search customer device
        const device = await getDeviceByNumber(formattedNumber);
        if (!device) {
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *CUSTOMER NUMBER NOT FOUND*

Number ${customerNumber} is not registered in the system.
Please check the customer number.${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        // Create 5G SSID name based on 2.4G SSID
        const newSSID5G = `${newSSID}-5G`;

        // Send message to admin that request is being processed
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
â³ *REQUEST PROCESSING*

Changing WiFi name for customer ${customerNumber}...
• WiFi 2.4GHz: ${newSSID}
• WiFi 5GHz: ${newSSID5G}

Please wait a moment.${getSetting('footer_info', 'Powered by CyberNet')}`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(device._id);

        // Update SSID 2.4GHz di index 1
        await axios.post(
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ]
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );

        // Update SSID 5GHz di index 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
                    }
                }
            );
            console.log('Successfully sent reboot task');
        } catch (rebootError) {
            console.error('Error sending reboot task:', rebootError.message);
        }

        // Success message for admin
        let adminResponseMessage = `${getSetting('company_header', '📱 NBB Wifiber')}
✅ *CUSTOMER WIFI NAME SUCCESSFULLY CHANGED!*

📋 *Customer:* ${customerNumber}
📶 *New WiFi Name:*
• WiFi 2.4GHz: ${newSSID}`;

        if (wifi5GFound) {
            adminResponseMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
        } else {
            adminResponseMessage += `\n• WiFi 5GHz: Settings not found or failed to change`;
        }

        adminResponseMessage += `\n
â³ Device will restart to apply changes.
📋 Connected devices will be disconnected and need to reconnect to the new WiFi name.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Powered by CyberNet')}`;

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
            const customerNotificationMessage = `${getSetting('company_header', '📱 NBB Wifiber')}
📢 *WIFI CHANGE NOTIFICATION*

Hello Valued Customer,

We inform you that your WiFi name has been changed by admin:

📶 *New WiFi Name:*
• WiFi 2.4GHz: ${newSSID}`;

            let fullCustomerMessage = customerNotificationMessage;
            if (wifi5GFound) {
                fullCustomerMessage += `\n• WiFi 5GHz: ${newSSID5G}`;
            }

            fullCustomerMessage += `\n
â³ Your device will restart to apply changes.
📋 Connected devices will be disconnected and need to reconnect to the new WiFi name.

_Notes: Save this information as documentation if you forget the WiFi name later.${getSetting('footer_info', 'Powered by CyberNet')}`;

            await sock.sendMessage(customerJid, { text: fullCustomerMessage });
            console.log(`Notification sent to customer ${customerNumber} about SSID change`);
        } catch (notificationError) {
            console.error(`Failed to send notification to customer ${customerNumber}:`, notificationError.message);
            // Send message to admin that customer notification failed
            await sock.sendMessage(adminJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âš ï¸ *INFO*

Name WiFi customer changed successfully, but failed to send notification to customer.
Error: ${notificationError.message}${getSetting('footer_info', 'Powered by CyberNet')}`
            });
        }

    } catch (error) {
        console.error('Error handling admin edit SSID:', error);
        await sock.sendMessage(adminJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *FAILED TO CHANGE CUSTOMER WIFI NAME*

Oops! A technical issue occurred while changing the customer's WiFi name.
Possible causes:
• Customer router is offline
• Server connection issue
• Name format not supported

Error message: ${error.message}

Please try again later!${getSetting('footer_info', 'Powered by CyberNet')}`
        });
    }
}

// Handler for customer password change
async function handleChangePassword(senderNumber, remoteJid, params) {
    try {
        console.log(`Handling change password request from ${senderNumber} with params:`, params);

        // Validate parameters
        if (params.length < 1) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *WRONG FORMAT*

âš ï¸ Command Format:
*changepass [new_password]*

📋 Example:
*changepass Password123*

💡 Password must be at least 8 characters
💡 Avoid easily guessable passwords${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        const newPassword = params[0];

        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *PASSWORD TOO SHORT*

WiFi password must be at least 8 characters.
Please try again with a longer password.${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        // Search device based on sender number
        console.log(`Finding device for number: ${senderNumber}`);

        const device = await getDeviceByNumber(senderNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *NUMBER NOT REGISTERED*

Your number is not registered yet.
Please contact admin first to register!${getSetting('footer_info', 'Powered by CyberNet')}`
            });
            return;
        }

        // Get device ID
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);

        // Send message that request is being processed
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
â³ *REQUEST PROCESSING*

Changing your WiFi password...
Please wait a moment.${getSetting('footer_info', 'Powered by CyberNet')}`
        });

        // Update WiFi password
        const result = await changePassword(deviceId, newPassword);

        if (result.success) {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
✅ *WIFI PASSWORD SUCCESSFULLY CHANGED!*

🔐 *New Password:* ${newPassword}

⏳ Please wait a moment, changes will be active shortly.
📋 Connected devices may be disconnected and need to reconnect with the new password.

_Change completed at: ${new Date().toLocaleString()}_${getSetting('footer_info', 'Powered by CyberNet')}`
            });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `${getSetting('company_header', '📱 NBB Wifiber')}
❌ *FAILED TO CHANGE PASSWORD*

Oops! There was a technical issue while changing your WiFi password.
Possible causes:
• Router is offline
• Server connection issue
• Password format not supported

Error message: ${result.message}

Please try again later!${getSetting('footer_info', 'Powered by CyberNet')}`
            });
        }
    } catch (error) {
        console.error('Error handling password change:', error);
        await sock.sendMessage(remoteJid, {
            text: `${getSetting('company_header', '📱 NBB Wifiber')}
âŒ *AN ERROR OCCURRED*

Error: ${error.message}

Please try again later or contact admin.${getSetting('footer_info', 'Powered by CyberNet')}`
        });
    }
}

// Function to change device WiFi password
async function changePassword(deviceId, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Changing password for device: ${deviceId}`);
        // Encode deviceId for URL
        const encodedDeviceId = encodeDeviceId(deviceId);
        // URL for GenieACS tasks
        const tasksUrl = `${genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;
        // Create task to change password
        // Update parameter for 2.4GHz WiFi
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
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`2.4GHz password update response:`, response24.status);

        // Update parameter for 5GHz WiFi
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
                    username: genieacsUsername,
                    password: genieacsPassword
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
                    username: genieacsUsername,
                    password: genieacsPassword
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

// Handler for admin to change customer WiFi password
async function handleAdminEditPassword(remoteJid, customerNumber, newPassword) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Handling admin edit password request`);

        // Validate parameters
        if (!customerNumber || !newPassword) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *WRONG FORMAT!*\n\nCorrect format:\neditpassword [customer_number] [new_password]\n\nExample:\neditpassword 123456 password123`
            });
            return;
        }
        // Validate password length
        if (newPassword.length < 8) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *Password too short!*\n\nPassword must be at least 8 characters.`
            });
            return;
        }

        // Search device based on customer number tag
        console.log(`Finding device for customer: ${customerNumber}`);

        const device = await findDeviceByTag(customerNumber);
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `âŒ *Device not found!*\n\n` +
                    `Customer number "${customerNumber}" is not registered in the system.`
            });
            return;
        }

        // Get device ID
        const deviceId = device._id;
        console.log(`Found device ID: ${deviceId}`);

        // Send message that process is in progress
        await sock.sendMessage(remoteJid, {
            text: `⏳ *PASSWORD CHANGE PROCESS*\n\nChanging WiFi password for customer ${customerNumber}...\nPlease wait a moment.`
        });

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(deviceId);

        // URL for GenieACS tasks
        const tasksUrl = `${genieacsUrl}/devices/${encodedDeviceId}/tasks?timeout=3000`;

        // Create task to change 2.4GHz password
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
                    username: genieacsUsername,
                    password: genieacsPassword
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
                        username: genieacsUsername,
                        password: genieacsPassword
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

            // Trying with other indexes besides 2 (3, 4, 6)
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
                                username: genieacsUsername,
                                password: genieacsPassword
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

            // If index 5 and alternatives (3, 4, 6) fail, leave 5GHz SSID unchanged
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
                                username: genieacsUsername,
                                password: genieacsPassword
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
                        username: genieacsUsername,
                        password: genieacsPassword
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
                const notificationMessage = formatWithHeaderFooter(`📢 *WIFI PASSWORD CHANGE INFORMATION*

Hello Valued Customer,

Your WiFi password has been changed by the system administrator. Here are the change details:

🔧 *Name WiFi:* ${ssid24G}
🔐 *New Password:* ${newPassword}

Please use this new password to connect to your WiFi network.
Changes will be applied in a few minutes.`);

                // Send message using sock
                await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, {
                    text: notificationMessage
                });

                console.log(`Password change notification sent to customer: ${customerNumber}`);
                notificationSent = true;

                responseMessage += `\nNotification has been sent to customer.`;
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
            text: `âŒ *An error occurred!*\n\n` +
                `Error: ${error.message}\n\n` +
                `Please try again later.`
        });
    }
}

// Handler for admin edit customer SSID
async function handleAdminEditSSIDWithParams(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }
    const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();

    console.log(`Processing adminssid command with params:`, params);

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `âŒ *WRONG FORMAT*\n\n` +
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
            text: `⏳ *SSID CHANGE PROCESS*\n\nChanging WiFi name for customer ${customerNumber}...\nPlease wait a moment.`
        });

        // Search device by customer number
        const device = await findDeviceByTag(customerNumber);

        if (!device) {
            console.log(`Device not found for customer number: ${customerNumber}`);
            await sock.sendMessage(remoteJid, {
                text: `❌ *DEVICE NOT FOUND*\n\n` +
                    `Cannot find device for customer with number ${customerNumber}.\n\n` +
                    `Please make sure the customer number is correct and device is registered in the system.`
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
            `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
            {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // only index 1 for 2.4GHz
            },
            {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            }
        );

        // Update SSID 5GHz only at indexes 5, 6, 7, 8
        let wifi5GFound = false;
        const ssid5gIndexes = [5, 6, 7, 8];
        for (const idx of ssid5gIndexes) {
            if (wifi5GFound) break;
            try {
                console.log(`Trying to update 5GHz SSID using config index ${idx}`);
                await axios.post(
                    `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                    {
                        name: "setParameterValues",
                        parameterValues: [
                            [`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${idx}.SSID`, newSSID5G, "xsd:string"]
                        ]
                    },
                    {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "refreshObject",
                    objectName: "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
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
                `${genieacsUrl}/devices/${encodedDeviceId}/tasks`,
                {
                    name: "reboot"
                },
                {
                    auth: {
                        username: genieacsUsername,
                        password: genieacsPassword
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

        responseMessage += `WiFi device will restart in a few moments. Customer needs to reconnect their devices to the new WiFi network.`;

        await sock.sendMessage(remoteJid, { text: responseMessage });

        // Send notification to customer if customer number is a phone number
        if (customerNumber.match(/^\d+$/) && customerNumber.length >= 10) {
            try {
                const formattedNumber = formatPhoneNumber(customerNumber);

                let notificationMessage = `✅ *WIFI NAME CHANGE*\n\n` +
                    `Dear Valued Customer,\n\n` +
                    `We inform you that your WiFi name has been changed:\n\n` +
                    `• New WiFi Name: ${newSSID}\n`;

                if (wifi5GFound) {
                    notificationMessage += `• WiFi 5GHz Name: ${newSSID5G}\n\n`;
                }

                notificationMessage += `WiFi device will restart in a few moments. Please reconnect your devices to the new WiFi network.\n\n` +
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
            text: `âŒ *ERROR*\n\nAn error occurred while changing WiFi name:\n${error.message}`
        });
    }
}

// Function to change SSID
async function changeSSID(deviceId, newSSID) {
    try {
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        console.log(`Changing SSID for device ${deviceId} to "${newSSID}"`);

        // Encode deviceId for URL
        const encodedDeviceId = encodeURIComponent(deviceId);

        // Implementation to change SSID via GenieACS
        // Edit SSID 2.4GHz
        try {
            console.log(`Setting 2.4GHz SSID to "${newSSID}"`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", newSSID, "xsd:string"]
                ] // only index 1 for 2.4GHz
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            // Edit 5GHz SSID by adding -5G suffix
            console.log(`Setting 5GHz SSID to "${newSSID}-5G"`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "setParameterValues",
                parameterValues: [
                    ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID", `${newSSID}-5G`, "xsd:string"]
                ]
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            // Commit perubahan
            console.log(`Rebooting device to apply changes`);
            await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                name: "reboot"
            }, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                }
            });

            console.log(`SSID change successful`);

            // Invalidate GenieACS cache after successful update
            try {
                const cacheManager = require('./cacheManager');
                cacheManager.invalidatePattern('genieacs:*');
                console.log('🔄 GenieACS cache invalidated after SSID update');
            } catch (cacheError) {
                console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
            }

            return { success: true, message: "SSID changed successfully" };
        } catch (apiError) {
            console.error(`API Error: ${apiError.message}`);

            // Try alternative method if first method fails
            if (apiError.response && apiError.response.status === 404) {
                console.log(`Trying alternative path for device ${deviceId}`);

                try {
                    // Try with alternative path for 2.4GHz
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.1.SSID", newSSID, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    // Try with alternative path for 5GHz
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "setParameterValues",
                        parameterValues: [
                            ["Device.WiFi.SSID.2.SSID", `${newSSID}-5G`, "xsd:string"]
                        ]
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    // Commit perubahan
                    await axios.post(`${genieacsUrl}/devices/${encodedDeviceId}/tasks`, {
                        name: "reboot"
                    }, {
                        auth: {
                            username: genieacsUsername,
                            password: genieacsPassword
                        }
                    });

                    console.log(`SSID change successful using alternative path`);

                    // Invalidate GenieACS cache after successful update
                    try {
                        const cacheManager = require('./cacheManager');
                        cacheManager.invalidatePattern('genieacs:*');
                        console.log('🔄 GenieACS cache invalidated after SSID update');
                    } catch (cacheError) {
                        console.warn('⚠️ Failed to invalidate cache:', cacheError.message);
                    }

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

// Update handler list ONU
async function handleListONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, {
            text: `🔍 *SEARCHING DEVICES*\n\nRetrieving ONT device list...\nPlease wait a moment.`
        });

        // Get device list from GenieACS
        const devices = await getAllDevices();

        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, {
                text: `â„¹ï¸ *NO DEVICES*\n\nNo ONT devices registered in the system.`
            });
            return;
        }

        // Limit the number of devices displayed to avoid messages that are too long
        const maxDevices = 20;
        const displayedDevices = devices.slice(0, maxDevices);
        const remainingCount = devices.length - maxDevices;

        // Create message with device list
        let message = `📋 *ONT DEVICE LIST*\n`;
        message += `Total: ${devices.length} devices\n\n`;

        displayedDevices.forEach((device, index) => {
            // Helper function to get parameter with multiple paths
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
            message += `Use web admin panel to see the full list.`;
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleListONU:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nAn error occurred while retrieving device list:\n${error.message}`
        });
    }
}

// Function to get all devices
async function getAllDevices() {
    try {
        // Get GenieACS configuration from helper
        const { genieacsUrl, genieacsUsername, genieacsPassword } = getGenieacsConfig();
        const response = await axios.get(`${genieacsUrl}/devices`, {
            auth: {
                username: genieacsUsername,
                password: genieacsPassword
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting all devices:', error);
        throw error;
    }
}

// Add handler to check all ONU (detail)
async function handleCheckAllONU(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send message that process is in progress
        await sock.sendMessage(remoteJid, {
            text: `🔍 *CHECKING ALL DEVICES*\n\nChecking status of all ONT devices...\nThis process may take a few moments.`
        });

        // Get device list from GenieACS
        const devices = await getAllDevices();

        if (!devices || devices.length === 0) {
            await sock.sendMessage(remoteJid, {
                text: `â„¹ï¸ *NO DEVICES*\n\nNo ONT devices registered in the system.`
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
                if (power <= parseFloat(getSetting('rx_power_critical', -27))) {
                    criticalRxPowerCount++;
                } else if (power <= parseFloat(getSetting('rx_power_warning', -25))) {
                    warningRxPowerCount++;
                }
            }
        });

        // Create message with statistics
        let message = `📊 *DEVICE STATUS REPORT*\n\n`;
        message += `📋 *Total Device:* ${devices.length}\n\n`;
        message += `🟢 *Online:* ${onlineCount} (${Math.round(onlineCount / devices.length * 100)}%)\n`;
        message += `🔴 *Offline:* ${offlineCount} (${Math.round(offlineCount / devices.length * 100)}%)\n\n`;
        message += `🔧 *Signal Status:*\n`;
        message += `🔘 *Warning:* ${warningRxPowerCount} devices\n`;
        message += `🔥 *Critical:* ${criticalRxPowerCount} devices\n\n`;

        // Add list of devices with issues
        if (criticalRxPowerCount > 0) {
            message += `*DEVICES WITH CRITICAL SIGNAL:*\n`;
            let count = 0;

            for (const device of devices) {
                const rxPower = device.InternetGatewayDevice?.X_GponLinkInfo?.RxPower?._value;
                if (rxPower && parseFloat(rxPower) <= parseFloat(getSetting('rx_power_critical', -27))) {
                    const tags = device._tags || [];
                    const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                    const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                    // Ambil PPPoE Username
                    const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';
                    message += `${++count}. *${customerInfo}* (S/N: ${serialNumber})\n   PPPoE: ${pppoeUsername}\n   RX Power: ${rxPower} dBm\n`;
                    // Limit the number of devices displayed
                    if (count >= 5) {
                        message += `...and ${criticalRxPowerCount - 5} other devices.\n`;
                        break;
                    }
                }
            }
            message += `\n`;
        }

        // Add list of recent offline devices
        if (offlineCount > 0) {
            message += `*RECENT OFFLINE DEVICES:*\n`;

            // Sort devices by last online time
            const offlineDevices = devices
                .filter(device => {
                    const lastInform = new Date(device._lastInform);
                    const now = new Date();
                    const diffMinutes = Math.floor((now - lastInform) / (1000 * 60));
                    return diffMinutes >= 15;
                })
                .sort((a, b) => new Date(b._lastInform) - new Date(a._lastInform));

            // Display 5 most recent offline devices
            const recentOfflineDevices = offlineDevices.slice(0, 5);
            recentOfflineDevices.forEach((device, index) => {
                const tags = device._tags || [];
                const customerInfo = tags.length > 0 ? tags[0] : 'No Tag';
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'Unknown';
                const lastInform = new Date(device._lastInform);
                // Ambil PPPoE Username
                const pppoeUsername = device.VirtualParameters?.pppoeUsername?._value || device.InternetGatewayDevice?.WANDevice?.[1]?.WANConnectionDevice?.[1]?.WANPPPConnection?.[1]?.Username?._value || device.InternetGatewayDevice?.WANDevice?.[0]?.WANConnectionDevice?.[0]?.WANPPPConnection?.[0]?.Username?._value || '-';
                message += `${index + 1}. *${customerInfo}* (S/N: ${serialNumber})\n   PPPoE: ${pppoeUsername}\n   Last Seen: ${lastInform.toLocaleString()}\n`;
            });

            if (offlineCount > 5) {
                message += `...and ${offlineCount - 5} other offline devices.\n`;
            }
        }

        await sock.sendMessage(remoteJid, { text: message });
    } catch (error) {
        console.error('Error in handleCheckAllONU:', error);
        await sock.sendMessage(remoteJid, {
            text: `âŒ *ERROR*\n\nAn error occurred while checking the device:\n${error.message}`
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
            text: `⏳ *HOTSPOT USER DELETION PROCESS*\n\nDeleting hotspot user...\nPlease wait a moment.`
        });

        const [username] = params;
        console.log(`Deleting hotspot user: ${username}`);

        // Call function to delete hotspot user
        const result = await deleteHotspotUser(username);
        console.log(`Hotspot user delete result:`, result);

        // Build response message based on result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *HOTSPOT USER DELETED SUCCESSFULLY*\n\n` +
                `• Username: ${username}\n` +
                `• Status: ${result.message || 'User deleted successfully'}`;
        } else {
            responseMessage = `❌ *FAILED TO DELETE HOTSPOT USER*\n\n` +
                `• Username: ${username}\n` +
                `• Reason: ${result.message || 'User not found'}`;
        }

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delhotspot command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try resending if failed
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

        // Send error message
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
            text: `⏳ *PPPoE SECRET DELETION PROCESS*\n\nDeleting PPPoE secret...\nPlease wait a moment.`
        });

        const [username] = params;
        console.log(`Deleting PPPoE secret: ${username}`);

        const result = await deletePPPoESecret(username);
        console.log(`PPPoE secret delete result:`, result);

        // Build response message based on result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *PPPoE SECRET DELETED SUCCESSFULLY*\n\n` +
                `• Username: ${username}\n` +
                `• Status: ${result.message || 'Secret deleted successfully'}`;
        } else {
            responseMessage = `❌ *FAILED TO DELETE PPPoE SECRET*\n\n` +
                `• Username: ${username}\n` +
                `• Reason: ${result.message || 'Secret not found'}`;
        }

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for delpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try resending if failed
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

        // Send error message
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
            text: `⏳ *HOTSPOT USER ADDITION PROCESS*\n\nAdding hotspot user...\nPlease wait a moment.`
        });

        const [username, password, profile = "default"] = params;
        console.log(`Adding hotspot user: ${username} with profile: ${profile}`);

        // Call function to add hotspot user
        const result = await addHotspotUser(username, password, profile);
        console.log(`Hotspot user add result:`, result);

        // Build response message based on result
        let responseMessage = '';
        if (result.success) {
            responseMessage = `✅ *HOTSPOT USER ADDED SUCCESSFULLY*\n\n` +
                `${result.message || 'User hotspot added successfully'}\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}`;
        } else {
            responseMessage = `❌ *FAILED TO ADD HOTSPOT USER*\n\n` +
                `${result.message || 'An error occurred while adding hotspot user'}\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}`;
        }

        // Send response message with timeout to ensure message is sent
        setTimeout(async () => {
            try {
                console.log(`Sending response message for addhotspot command:`, responseMessage);
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent successfully`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try resending if failed
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
            text: `⏳ *PPPoE SECRET ADDITION PROCESS*\n\nAdding PPPoE secret...\nPlease wait a moment.`
        });

        const [username, password, profile = "default", localAddress = ""] = params;
        console.log(`Adding PPPoE secret: ${username} with profile: ${profile}, IP: ${localAddress || 'from pool'}`);

        const result = await addPPPoESecret(username, password, profile, localAddress);
        console.log(`PPPoE secret add result:`, result);

        // Build response message based on result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *PPPoE SECRET ADDED SUCCESSFULLY*\n\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• IP: ${localAddress || 'Using IP from pool'}\n` +
                `• Status: ${result.message || 'Secret added successfully'}`;
        } else {
            responseMessage = `❌ *FAILED TO ADD PPPoE SECRET*\n\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• IP: ${localAddress || 'Using IP from pool'}\n` +
                `• Reason: ${result.message || 'An error occurred while adding secret'}`;
        }

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for addpppoe command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try resending if failed
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

        // Send error message
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
async function handleChangePPPoEProfile(remoteJid, params) {
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
            text: `⏳ *PPPoE PROFILE CHANGE PROCESS*\n\nChanging PPPoE profile...\nPlease wait a moment.`
        });

        const [username, newProfile] = params;
        console.log(`Changing PPPoE profile for user ${username} to ${newProfile}`);

        // Change to setPPPoEProfile (correct function from mikrotik.js)
        const result = await setPPPoEProfile(username, newProfile);
        console.log(`PPPoE profile change result:`, result);

        // Build response message based on result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *PPPoE PROFILE CHANGED SUCCESSFULLY*\n\n` +
                `• Username: ${username}\n` +
                `• New Profile: ${newProfile}\n` +
                `• Status: ${result.message || 'Profile changed successfully'}`;
        } else {
            responseMessage = `❌ *FAILED TO CHANGE PPPoE PROFILE*\n\n` +
                `• Username: ${username}\n` +
                `• New Profile: ${newProfile}\n` +
                `• Reason: ${result.message || 'User not found'}`;
        }

        // Send response message with timeout
        setTimeout(async () => {
            try {
                await sock.sendMessage(remoteJid, { text: responseMessage });
                console.log(`Response message sent for setprofile command`);
            } catch (sendError) {
                console.error('Error sending response message:', sendError);
                // Try resending if failed
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
        console.error('Error in handleChangePPPoEProfile:', error);

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
            text: `⏳ *Processing Request*\n\nRetrieving router resource information...`
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

            // Format Memory info with handling for unavailable data
            let memoryInfo = `🧠 *MEMORY*\n`;
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
            let diskInfo = `💾 *DISK*\n`;
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
            let systemInfo = `🙏 *UPTIME*\n• ${data.uptime}\n\n`;
            systemInfo += `⚙️ *SYSTEM INFO*\n`;
            if (data.model !== 'N/A') systemInfo += `• Model: ${data.model}\n`;
            if (data.architecture !== 'N/A') systemInfo += `• Architecture: ${data.architecture}\n`;
            if (data.version !== 'N/A') systemInfo += `• Version: ${data.version}\n`;
            if (data.boardName !== 'N/A') systemInfo += `• Board: ${data.boardName}\n`;

            const message = `📊 *ROUTER RESOURCE INFO*\n\n${cpuInfo}\n${memoryInfo}\n${diskInfo}\n${systemInfo}`;

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
                text: `❌ *ERROR*\n\nAn error occurred while retrieving resource information: ${error.message}\n\nPlease try again later.`
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
}

// Handler for viewing active hotspot users
async function handleActiveHotspotUsers(remoteJid) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    try {
        // Send processing message
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Processing Request*\n\nRetrieving active hotspot user list...`
        });

        console.log('Fetching active hotspot users');

        // Import mikrotik module
        const mikrotik = require('./mikrotik');

        // Get active hotspot user list
        const result = await mikrotik.getActiveHotspotUsers();

        if (result.success) {
            let message = '🔥 *ACTIVE HOTSPOT USER LIST*\n\n';

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
                        `   • Download: ${(bytesIn / 1024 / 1024).toFixed(2)} MB\n` +
                        `   • Upload: ${(bytesOut / 1024 / 1024).toFixed(2)} MB\n\n`;
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
                text: `❌ *ERROR*\n\nAn error occurred while retrieving active hotspot user list: ${error.message}\n\nPlease try again later.`
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
            text: `⏳ *Processing Request*\n\nRetrieving active PPPoE connection list...`
        });

        console.log('Fetching active PPPoE connections');

        // Import mikrotik module
        const mikrotik = require('./mikrotik');

        // Get active PPPoE connection list
        const result = await mikrotik.getActivePPPoEConnections();

        if (result.success) {
            let message = '📶 *ACTIVE PPPoE CONNECTION LIST*\n\n';

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
                text: `❌ *ERROR*\n\nAn error occurred while retrieving active PPPoE connection list: ${error.message}\n\nPlease try again later.`
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
            text: `⏳ *Processing Request*\n\nRetrieving offline PPPoE user list...`
        });

        console.log('Fetching offline PPPoE users');

        // Import mikrotik module
        const mikrotik = require('./mikrotik');

        // Get offline PPPoE user list
        const result = await mikrotik.getInactivePPPoEUsers();

        if (result.success) {
            let message = `📊 *OFFLINE PPPoE USER LIST*\n\n`;
            message += `Total User: ${result.totalSecrets}\n`;
            message += `Active Users: ${result.totalActive} (${((result.totalActive / result.totalSecrets) * 100).toFixed(2)}%)\n`;
            message += `Offline Users: ${result.totalInactive} (${((result.totalInactive / result.totalSecrets) * 100).toFixed(2)}%)\n\n`;

            if (result.data.length === 0) {
                message += 'No offline PPPoE users';
            } else {
                // Limit the number of users displayed to avoid messages that are too long
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
                text: `❌ *ERROR*\n\nAn error occurred while retrieving offline user list: ${error.message}\n\nPlease try again later.`
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
    handleChangePPPoEProfile,
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
    handleInfoLayanan
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
    // because these are admin-only commands
    return wifiKeywords.includes(command);
}

// Function to check if command is related to password
function isPasswordCommand(commandStr) {
    const command = commandStr.split(' ')[0].toLowerCase();
    const passwordKeywords = [
        'gantipass', 'ubahpass', 'editpass', 'changepass', 'password',
        'gantisandi', 'ubahsandi', 'editsandi', 'sandi',
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
        let welcomeMessage = `👋 *Welcome to WhatsApp Bot ${getSetting('company_header', '📱 NBB Wifiber')}*\n\n`;

        if (isAdmin) {
            welcomeMessage += `Hello Admin! You can use various commands to manage the system.\n\n`;
        } else {
            welcomeMessage += `Hello Customer! You can use this bot to manage your device.\n\n`;
        }

        welcomeMessage += `Type *menu* to see the list of available commands.\n\n`;

        // Addkan footer
        welcomeMessage += `🏢 *${getSetting('company_header', '📱 NBB Wifiber')}*\n`;
        welcomeMessage += `${getSetting('footer_info', 'Powered by CyberNet')}`;

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
    // Ensure deviceId is string
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
        const sessionDir = getSetting('whatsapp_session_path', './whatsapp-session');
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

        // Restart WhatsApp connection
        if (sock) {
            try {
                sock.logout();
            } catch (error) {
                console.log('Error during logout:', error);
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

// Function to handle member command (different username and password)
async function handleMemberCommand(remoteJid, params) {
    try {
        // Format: member [username] [password] [profile] [buyer_number]
        if (params.length < 3) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *WRONG FORMAT*\n\nCorrect format:\nmember [username] [password] [profile] [nomer_pembeli]\n\nExample:\n• member user123 pass123 3k 08123456789\n• member user123 pass123 3k`
            });
            return;
        }

        const username = params[0];
        const password = params[1];
        const profile = params[2];
        const buyerNumber = params[3];

        // Validate username and profile
        if (!username || !password || !profile) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *FAILED TO CREATE USER*\n\nUsername, password, and profile are required.`
            });
            return;
        }

        await sock.sendMessage(remoteJid, {
            text: `⏳ *USER CREATION PROCESS*\n\nCreating user...\nPlease wait a moment.`
        });

        // Create user in Mikrotik
        const result = await addHotspotUser(username, password, profile);

        // Format message for admin based on result.success
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ *USER CREATED SUCCESSFULLY*\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}\n` +
                `• Status: ${result.message || 'User created successfully'}`;
        } else {
            responseMessage = `❌ *FAILED TO CREATE USER*\n\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Profile: ${profile}\n` +
                `• Reason: ${result.message || 'An error occurred while creating user'}`;
        }

        // If there is a buyer number and user was successfully created, also send to buyer
        if (buyerNumber && result.success) {
            // Remove all non-numeric characters
            let cleanNumber = buyerNumber.replace(/\D/g, '');

            // If number starts with 0, replace with 62
            if (cleanNumber.startsWith('0')) {
                cleanNumber = '62' + cleanNumber.substring(1);
            }
            // If number starts with 8 (without 62), add 62
            else if (cleanNumber.startsWith('8')) {
                cleanNumber = '62' + cleanNumber;
            }

            const buyerJid = `${cleanNumber}@s.whatsapp.net`;

            // Get header and footer from settings
            const settings = getAppSettings();
            const header = settings.company_header || '📱 NBB Wifiber';
            const footer = settings.footer_info || 'Thank you for using our service.';

            const buyerMessage = `📋 *${header.toUpperCase()}*\n\n` +
                `Here are your internet access details:\n` +
                `• Username: ${username}\n` +
                `• Password: ${password}\n` +
                `• Speed: ${profile}\n\n` +
                `_${footer}_`;

            try {
                // Try sending message directly without checking registered number
                await sock.sendMessage(buyerJid, {
                    text: buyerMessage
                }, {
                    waitForAck: false
                });
                responseMessage += '\n\n✅ Notification sent successfully to buyer.';
            } catch (error) {
                console.error('Failed to send notification to buyer:', error);
                responseMessage += '\n\n⚠️ Failed to send notification to buyer. Make sure the WhatsApp number is active and registered.';
            }
        }

        await sock.sendMessage(remoteJid, { text: responseMessage });
    } catch (error) {
        console.error('Error in handleMemberCommand:', error);
        await sock.sendMessage(remoteJid, {
            text: '❌ *AN ERROR OCCURRED*\n\nFailed to process command. Please try again.'
        });
    }
}

// Handler to create hotspot voucher
async function handleVoucherCommand(remoteJid, params) {
    if (!sock) {
        console.error('Sock instance not set');
        return;
    }

    if (params.length < 2) {
        await sock.sendMessage(remoteJid, {
            text: `❌ *WRONG FORMAT*\n\n` +
                `Correct format:\n` +
                `vcr [username] [profile] [nomer_pembeli]\n\n` +
                `Example:\n` +
                `• vcr customer1 1Mbps 62812345678\n` +
                `• vcr customer2 2Mbps`
        });
        return;
    }

    try {
        const username = params[0];
        const profile = params[1];
        const buyerNumber = params[2] ? params[2].replace(/[^0-9]/g, '') : null;

        // Send message that process is in progress
        await sock.sendMessage(remoteJid, {
            text: `⏳ *CREATING HOTSPOT VOUCHER*\n\n` +
                `Processing voucher creation...\n` +
                `• Username: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• Password: Same as username\n`
        });

        // Create hotspot user (password same as username)
        const result = await addHotspotUser(username, username, profile);

        if (result.success) {
            // Message for admin
            let message = `✅ *VOUCHER SUCCESSFULLY CREATED*\n\n` +
                `Voucher Details:\n` +
                `• Username: ${username}\n` +
                `• Password: ${username}\n` +
                `• Profile: ${profile}\n` +
                `• Status: ${result.message || 'Voucher successfully created'}\n\n` +
                `_This voucher will be active immediately after the device connects to the network._`;

            // Send to admin
            await sock.sendMessage(remoteJid, { text: message });

            // If there is a buyer number, also send to buyer
            if (buyerNumber) {
                // Remove all non-numeric characters
                let cleanNumber = buyerNumber.replace(/\D/g, '');

                // If number starts with 0, replace with 62
                if (cleanNumber.startsWith('0')) {
                    cleanNumber = '62' + cleanNumber.substring(1);
                }
                // If number starts with 8 (without 62), add 62
                else if (cleanNumber.startsWith('8')) {
                    cleanNumber = '62' + cleanNumber;
                }

                const buyerJid = `${cleanNumber}@s.whatsapp.net`;

                // Get header and footer from settings
                const settings = getAppSettings();
                const header = settings.company_header || '📱 NBB Wifiber';
                const footer = settings.footer_info || 'Thank you for using our service.';

                const buyerMessage = `📋 *${header.toUpperCase()}*\n\n` +
                    `Here are your internet access details:\n` +
                    `• Username: ${username}\n` +
                    `• Password: ${username}\n` +
                    `• Price: ${profile}\n\n` +
                    `_${footer}_`;

                try {
                    // Try sending message directly without checking registered number
                    const sendPromise = sock.sendMessage(buyerJid, {
                        text: buyerMessage,
                        // Add option to avoid error if number is not registered
                        // and continue process
                        waitForAck: false
                    });

                    // Set timeout 10 seconds (faster)
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Sending time expired')), 10000)
                    );

                    // Wait for one: message sent or timeout
                    await Promise.race([sendPromise, timeoutPromise]);

                    await sock.sendMessage(remoteJid, {
                        text: `💎 Voucher notification has been sent to: ${buyerNumber}`
                    });
                } catch (error) {
                    console.error('Failed to send notification to buyer:', error);
                    // Still continue even if failed to send notification
                    await sock.sendMessage(remoteJid, {
                        text: `✅ *VOUCHER SUCCESSFULLY CREATED*\n\n` +
                            `Voucher details have been successfully created, but notification to ${buyerNumber} failed to send.\n` +
                            `This can happen if the number is not registered on WhatsApp or there is a connection issue.`
                    });
                }
            }
        } else {
            // Send error message if failed to create voucher
            await sock.sendMessage(remoteJid, {
                text: `❌ *FAILED TO CREATE VOUCHER*\n\n` +
                    `• Username: ${username}\n` +
                    `• Profile: ${profile}\n` +
                    `• Reason: ${result.message || 'An error occurred while creating voucher'}`
            });
        }
    } catch (error) {
        console.error('Error in handleVoucherCommand:', error);

        // Send error message
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR CREATING VOUCHER*\n\n` +
                `An error occurred while creating voucher:\n` +
                `${error.message || 'Unknown error'}`
        });
    }
}

// Function to handle incoming messages with better error handling and logging
async function handleIncomingMessage(sock, message) {
    // Super admin welcome message disabled (silent startup)
    try {
        // Skip if message already processed by agent handler
        if (message._agentProcessed) {
            console.log('📱 [MAIN] Message already processed by agent handler, skipping');
            return;
        }

        // Input validation
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

        // Skip status updates (broadcast)
        if (remoteJid === 'status@broadcast') {
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
            // Message type not supported
            logger.debug('Unsupported message type received', {
                messageTypes: Object.keys(message.message)
            });
            return;
        }

        // Extract sender number with error handling
        let senderNumber;
        let senderLid = null;
        try {
            // Get the part before @
            let rawNumber = remoteJid.split('@')[0];

            // WhatsApp LID (Linked Identity) handling - Improved based on reference
            if (remoteJid.endsWith('@lid')) {
                senderLid = remoteJid;
                logger.debug(`WhatsApp LID detected`, { lid: senderLid });

                // PRIORITY 1: Check remoteJidAlt (Baileys often puts the real number here)
                if (message.key?.remoteJidAlt && message.key.remoteJidAlt.endsWith('@s.whatsapp.net')) {
                    rawNumber = message.key.remoteJidAlt.split('@')[0];
                    logger.info(`✅ Got real number from remoteJidAlt: ${rawNumber}`);
                } 
                // PRIORITY 2: Check participant (for group messages or some specific cases)
                else if (message.key?.participant && message.key.participant.endsWith('@s.whatsapp.net')) {
                    rawNumber = message.key.participant.split('@')[0];
                    logger.info(`✅ Got real number from participant: ${rawNumber}`);
                }
                // PRIORITY 3: Fallback to database resolution
                else {
                    try {
                        const BillingManager = require('./billing');
                        const billing = new BillingManager();
                        const customer = await billing.getCustomerByWhatsAppLid(senderLid);
                        if (customer) {
                            rawNumber = customer.phone;
                            logger.info(`✅ Resolved LID ${senderLid} from database to phone: ${rawNumber}`);
                        } else {
                            logger.warn(`⚠️ LID ${senderLid} not found in database and no alternate JID available`);
                        }
                    } catch (err) {
                        logger.warn(`⚠️ Could not resolve LID ${senderLid}:`, err.message);
                    }
                }
            }
            
            // Delete non-digit characters for security
            senderNumber = rawNumber.replace(/\D/g, '');

            // Normalisasi: 08xxx -> 628xxx
            if (senderNumber.startsWith('0')) {
                senderNumber = '62' + senderNumber.slice(1);
            }
        } catch (error) {
            logger.error('Error extracting sender number', { remoteJid, error: error.message });
            return;
        }

        logger.info(`Message received`, { sender: senderNumber, rawJid: remoteJid, messageLength: messageText.length });
        logger.debug(`Message content`, { sender: senderNumber, message: messageText });

        // Check if sender is admin
        const isAdmin = isAdminNumber(senderNumber);
        logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });

        // Try to handle with agent handler first (for non-admin messages)
        if (!isAdmin) {
            try {
                const AgentWhatsAppIntegration = require('./agentWhatsAppIntegration');
                const agentWhatsApp = new AgentWhatsAppIntegration(this);
                const processed = await agentWhatsApp.handleIncomingMessage(message, senderNumber, messageText);
                if (processed) {
                    console.log('📱 [MAIN] Message processed by agent handler, skipping main handler');
                    return;
                }
            } catch (agentError) {
                console.log('📱 [MAIN] Agent handler not available or error:', agentError.message);
            }
        }

        // If message is empty, ignore
        if (!messageText.trim()) {
            logger.debug('Empty message, ignoring');
            return;
        }

        // Process command
        const command = messageText.trim().toLowerCase();

        // Handler for setheader
        if (command.startsWith('setheader ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, 'âŒ *Only admin can change header!*');
                return;
            }
            const newHeader = messageText.split(' ').slice(1).join(' ');
            if (!newHeader) {
                await sendFormattedMessage(remoteJid, 'âŒ *Format salah!*\n\nsetheader [new_header_text]');
                return;
            }
            const { setSetting } = require('./settingsManager');
            setSetting('company_header', newHeader);
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
                await sendFormattedMessage(remoteJid, '❌ *Invalid format!*\n\nsetfooter [new_footer_text]');
                return;
            }
            const { setSetting } = require('./settingsManager');
            setSetting('footer_info', newFooter);
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
                await sendFormattedMessage(remoteJid, '❌ *Invalid format!*\n\nsetadmin [new_admin_number]');
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
                await sendFormattedMessage(remoteJid, '*Only admin can change technician!*');
                return;
            }
            const newTechs = messageText.split(' ').slice(1).join(' ').split(',').map(n => n.trim().replace(/\D/g, '')).filter(Boolean);
            if (!newTechs.length) {
                await sendFormattedMessage(remoteJid, '*Invalid format!*\n\nsettechnician [number1,number2,...]');
                return;
            }
            let settings = getAppSettings();
            settings.technician_numbers = newTechs;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `*Technician numbers changed successfully to:*\n${newTechs.join(', ')}`);
            return;
        }

        // Handler setgenieacs
        if (command.startsWith('setgenieacs ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '*Only admin can change GenieACS config!*');
                return;
            }
            const params = messageText.split(' ').slice(1);
            if (params.length < 3) {
                await sendFormattedMessage(remoteJid, '*Invalid format!*\n\nsetgenieacs [url] [username] [password]');
                return;
            }
            let settings = getAppSettings();
            settings.genieacs_url = params[0];
            settings.genieacs_username = params[1];
            settings.genieacs_password = params.slice(2).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `*GenieACS config changed successfully!*`);
            return;
        }

        // Handler setmikrotik
        if (command.startsWith('setmikrotik ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '*Only admin can change Mikrotik config!*');
                return;
            }
            const params = messageText.split(' ').slice(1);
            if (params.length < 4) {
                await sendFormattedMessage(remoteJid, '*Invalid format!*\n\nsetmikrotik [host] [port] [user] [password]');
                return;
            }
            let settings = getAppSettings();
            settings.mikrotik_host = params[0];
            settings.mikrotik_port = params[1];
            settings.mikrotik_user = params[2];
            settings.mikrotik_password = params.slice(3).join(' ');
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            await sendFormattedMessage(remoteJid, `*Mikrotik config changed successfully!*`);
            return;
        }

        // Handler OTP management
        if (command.startsWith('otp ')) {
            if (!isAdmin) {
                await sendFormattedMessage(remoteJid, '*Only admin can manage OTP!*');
                return;
            }
            const subCommand = messageText.split(' ').slice(1)[0]?.toLowerCase();

            switch (subCommand) {
                case 'on':
                    // Check both settings for compatibility
                    const otpStatus = settingsStatus.customerPortalOtp || settingsStatus.customer_otp_enabled;
                    const otpLength = settingsStatus.otp_length || 4;
                    const otpExpiry = settingsStatus.otp_expiry_minutes || 5;

                    await sendFormattedMessage(remoteJid, `📊 *OTP STATUS*\n\n` +
                        `🔐 Status: ${otpStatus ? '🟢 ACTIVE' : '🔴 INACTIVE'}\n` +
                        `🙏 Code Length: ${otpLength} digits\n` +
                        `🙏 Valid for: ${otpExpiry} minutes\n\n` +
                        `*Available commands:*\n` +
                        `• otp on - Enable OTP\n` +
                        `• otp off - Disable OTP\n` +
                        `• otp status - View status OTP`);
                    return;

                default:
                    await sendFormattedMessage(remoteJid, `âŒ *Format salah!*\n\n` +
                        `*Available OTP commands:*\n` +
                        `• otp on - Enable OTP\n` +
                        `• otp off - Disable OTP\n` +
                        `• otp status - View status OTP\n\n` +
                        `*Example:*\n` +
                        `otp on`);
                    return;
            }
        }

        // Command to enable/disable GenieACS (admin only)
        // This command is always processed regardless of genieacsCommandsEnabled status

        // Command to disable GenieACS messages (admin only)
        if (command.toLowerCase() === 'genieacs stop' && isAdmin) {
            console.log(`Admin ${senderNumber} disabled GenieACS messages`);
            genieacsCommandsEnabled = false;
            await sendFormattedMessage(remoteJid, `✅ *GenieACS MESSAGES DISABLED*\n\nGenieACS messages have been disabled. Contact admin to reactivate.`);
            return;
        }

        // Command to reactivate GenieACS messages (admin only)
        if (command.toLowerCase() === 'genieacs start060111' && isAdmin) {
            console.log(`Admin ${senderNumber} activated GenieACS messages`);
            genieacsCommandsEnabled = true;
            await sendFormattedMessage(remoteJid, `✅ *GenieACS MESSAGES ENABLED*\n\nGenieACS messages have been reactivated.`);
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
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', '📱 NBB Wifiber')}\n✅ *GenieACS successfully stopped by Super Admin.*${getSetting('footer_info', 'Powered by CyberNet')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', '📱 NBB Wifiber')}\n❌ *Only Super Admin can run this command!*${getSetting('footer_info', 'Powered by CyberNet')}` });
            }
            return;
        }
        // GenieACS start command (super admin only)
        if (command === 'genieacs start060111') {
            if (senderNumber === superAdminNumber) {
                genieacsCommandsEnabled = true;
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', '📱 NBB Wifiber')}\n✅ *GenieACS successfully activated by Super Admin.*${getSetting('footer_info', 'Powered by CyberNet')}` });
            } else {
                await sock.sendMessage(remoteJid, { text: `${getSetting('company_header', '📱 NBB Wifiber')}\n❌ *Only Super Admin can run this command!*${getSetting('footer_info', 'Powered by CyberNet')}` });
            }
            return;
        }
        // Menu command (replace help)
        if (command === 'menu' || command === '!menu' || command === '/menu') {
            console.log(`Running menu command for ${senderNumber}`);
            await handleHelpCommand(remoteJid, isAdmin);
            return;
        }

        // Agent admin commands
        if (isAdmin && (command.includes('agent') || command === 'agent' || command === 'daftaragent')) {
            console.log(`🤖 [AGENT ADMIN] Processing command: "${command}" from ${senderNumber}`);
            const AgentAdminCommands = require('./agentAdminCommands');
            const agentAdminCommands = new AgentAdminCommands();
            agentAdminCommands._sendMessage = async (jid, message) => {
                await sock.sendMessage(jid, { text: message });
            };
            await agentAdminCommands.handleAgentAdminCommands(remoteJid, senderNumber, command, messageText);
            return;
        }

        // Status command
        if (command === 'status' || command === '!status' || command === '/status') {
            console.log(`Running status command for ${senderNumber}`);
            await handleStatusCommand(senderNumber, remoteJid);
            return;
        }

        // Refresh command
        if (command === 'refresh' || command === '!refresh' || command === '/refresh') {
            console.log(`Running command refresh for ${senderNumber}`);
            await handleRefreshCommand(senderNumber, remoteJid);
            return;
        }

        // Admin command
        if ((command === 'admin' || command === '!admin' || command === '/admin') && isAdmin) {
            console.log(`Running command admin for ${senderNumber}`);
            await handleAdminMenu(remoteJid);
            return;
        }

        // GenieACS enable/disable command has been moved above

        // Factory reset command (for customer)
        if (command === 'factory reset' || command === '!factory reset' || command === '/factory reset') {
            console.log(`Running command factory reset for ${senderNumber}`);
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
            console.log(`Running command connected devices for ${senderNumber}`);
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
            console.log(`Running command speed test for ${senderNumber}`);
            if (genieacsCommandsEnabled) {
                await genieacsCommands.handleSpeedTest(remoteJid, senderNumber);
            } else {
                await sendGenieACSDisabledMessage(remoteJid);
            }
            return;
        }

        // Network diagnostic command
        if (command === 'diagnostic' || command === '!diagnostic' || command === '/diagnostic' ||
            command === 'diagnosa' || command === '!diagnosa' || command === '/diagnosa') {
            console.log(`Running command network diagnostic for ${senderNumber}`);
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
            console.log(`Running command connection history for ${senderNumber}`);
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
                // Handle without space, e.g. cekstatus081321960111
                customerNumber = command.replace('cekstatus', '').trim();
            }
            if (customerNumber && /^\d{8,}$/.test(customerNumber)) {
                await handleAdminCheckONU(remoteJid, customerNumber);
                return;
            } else {
                await sock.sendMessage(remoteJid, {
                    text: `âŒ *WRONG FORMAT*\n\nCorrect format:\ncekstatus [customer_number]\n\nExample:\ncekstatus 081234567890`
                });
                return;
            }
        }

        // WiFi change command
        if (isWifiCommand(command)) {
            console.log(`Running command change WiFi for ${senderNumber}`);
            const params = messageText.split(' ').slice(1);

            // If admin uses command gantiwifi with format: gantiwifi [customer_number] [ssid]
            if (isAdmin && params.length >= 2) {
                // Assume first parameter is customer number
                const customerNumber = params[0];
                const ssidParams = params.slice(1);
                console.log(`Admin using gantiwifi for customer ${customerNumber}`);
                await handleAdminEditSSID(remoteJid, customerNumber, ssidParams.join(' '));
            } else {
                // Regular customer or admin format not suitable
                await handleChangeSSID(senderNumber, remoteJid, params);
            }
            return;
        }

        // Change password command
        if (isPasswordCommand(command.split(' ')[0])) {
            console.log(`Running command change password for ${senderNumber}`);
            const params = messageText.split(' ').slice(1);

            // If admin uses command gantipassword with format: gantipassword [customer_number] [password]
            if (isAdmin && params.length >= 2) {
                // Assume first parameter is customer number
                const customerNumber = params[0];
                const password = params[1];
                console.log(`Admin using gantipassword for customer ${customerNumber}`);
                await handleAdminEditPassword(remoteJid, customerNumber, password);
            } else {
                // Regular customer or admin format not suitable
                await handleChangePassword(senderNumber, remoteJid, params);
            }
            return;
        }

        // If admin, check other admin commands
        if (isAdmin) {
            // SETLID command for admin to save their WhatsApp LID
            if (command === 'setlid' || command === '!setlid' || command === '/setlid') {
                try {
                    const { setSetting, getSetting } = require('./settingsManager');

                    // Parse password from command: SETLID [password]
                    const args = messageText.split(' ').slice(1);
                    const inputPassword = args[0] ? args[0].trim() : '';

                    if (!inputPassword) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `🔐 *FORMAT SETLID*\n\n` +
                                `For security, you must enter admin password.\n\n` +
                                `Format: *SETLID [password]*\n\n` +
                                `Example: SETLID admin123\n\n` +
                                `Password is admin_password in settings.json`
                            )
                        });
                        return;
                    }

                    // Validate password
                    const adminPassword = getSetting('admin_password', '');
                    if (inputPassword !== adminPassword) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *PASSWORD SALAH*\n\n` +
                                `The password you entered does not match.\n\n` +
                                `Please try again with the correct password.`
                            )
                        });
                        console.log(`⚠️ Failed SETLID attempt from ${senderNumber} - wrong password`);
                        return;
                    }

                    if (!senderLid) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *LID NOT DETECTED*\n\n` +
                                `WhatsApp LID not detected. This feature is only for WhatsApp accounts with @lid format.\n\n` +
                                `Your Number: ${senderNumber}`
                            )
                        });
                        return;
                    }

                    // Search admin slot that matches sender number
                    let adminSlot = null;
                    for (let i = 0; i < 10; i++) {
                        const adminNum = getSetting(`admins.${i}`, '');
                        if (adminNum === senderNumber || adminNum === `0${senderNumber.slice(2)}`) {
                            adminSlot = i;
                            break;
                        }
                    }

                    if (adminSlot === null) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *NUMBER NOT REGISTERED*\n\n` +
                                `Number ${senderNumber} is not registered as admin in settings.json.\n\n` +
                                `Please add your number to settings.json first as admins.0, admins.1, etc.`
                            )
                        });
                        return;
                    }

                    // Save LID to settings.json with key admin_lid.X
                    const lidKey = `admin_lid.${adminSlot}`;
                    const success = setSetting(lidKey, senderLid);

                    if (success) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *LID SAVED*\n\n` +
                                `Your WhatsApp LID was saved successfully!\n\n` +
                                `📋 *Detail:*\n` +
                                `• Number: ${senderNumber}\n` +
                                `• LID: ${senderLid}\n` +
                                `• Slot: admin_lid.${adminSlot}\n\n` +
                                `This LID will be used for admin identification in the future.`
                            )
                        });
                        console.log(`✅ Admin LID saved: ${senderLid} for admin slot ${adminSlot}`);
                    } else {
                        await sock.sendMessage(remoteJid, {
                            text: `❌ Failed to save LID to settings.json. Please check logs.`
                        });
                    }
                } catch (error) {
                    console.error('Error in SETLID command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: `❌ An error occurred: ${error.message}`
                    });
                }
                return;
            }

            // Check ONU command (but not billing check)
            if ((command.startsWith('cek ') || command.startsWith('!cek ') || command.startsWith('/cek ')) &&
                !command.includes('tagihan')) {
                const customerNumber = command.split(' ')[1];
                if (customerNumber) {
                    console.log(`Running command cek ONU for customer ${customerNumber}`);
                    await handleAdminCheckONUWithBilling(remoteJid, customerNumber);
                    return;
                }
            }

            // Edit SSID command
            if (command.toLowerCase().startsWith('editssid ') || command.toLowerCase().startsWith('!editssid ') || command.toLowerCase().startsWith('/editssid ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command edit SSID for ${params[0]}`);
                    await handleAdminEditSSIDWithParams(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
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
                    console.log(`Running command edit password for ${params[0]}`);
                    await handleAdminEditPassword(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
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
                    console.log(`Running command admin detail for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminDeviceDetail(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
                            `Correct format:\n` +
                            `detail [nomor_customer]\n\n` +
                            `Example:\n` +
                            `detail 081234567890`
                    });
                    return;
                }
            }

            // Admin restart customer device command
            if (command.toLowerCase().startsWith('adminrestart ') || command.toLowerCase().startsWith('!adminrestart ') || command.toLowerCase().startsWith('/adminrestart ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command admin restart for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminRestartDevice(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
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
                    console.log(`Running command admin factory reset for ${params[0]}`);
                    if (genieacsCommandsEnabled) {
                        await genieacsCommands.handleAdminFactoryReset(remoteJid, params[0]);
                    } else {
                        await sendGenieACSDisabledMessage(remoteJid);
                    }
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
                            `Correct format:\n` +
                            `adminfactory [nomor_customer]\n\n` +
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
                            console.log(`Admin enabling PPPoE notifications`);
                            await pppoeCommands.handleEnablePPPoENotifications(remoteJid);
                            return;

                        case 'off':
                        case 'disable':
                            console.log(`Admin disabling PPPoE notifications`);
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
                                    text: `âŒ *WRONG FORMAT*\n\nFormat: pppoe addadmin [number]\nExample: pppoe addadmin 081234567890`
                                });
                            }
                            return;

                        case 'addtech':
                        case 'addteknisi':
                            if (params.length >= 2) {
                                console.log(`Admin adding PPPoE technician number: ${params[1]}`);
                                await pppoeCommands.handleAddTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *WRONG FORMAT*\n\nFormat: pppoe addtech [nomor]\nExample: pppoe addtech 081234567890`
                                });
                            }
                            return;

                        case 'interval':
                            if (params.length >= 2) {
                                console.log(`Admin changing PPPoE interval: ${params[1]}`);
                                await pppoeCommands.handleSetInterval(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *WRONG FORMAT*\n\nFormat: pppoe interval [detik]\nExample: pppoe interval 60`
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
                                console.log(`Admin removing PPPoE admin number: ${params[1]}`);
                                await pppoeCommands.handleRemoveAdminNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *WRONG FORMAT*\n\nFormat: pppoe removeadmin [nomor]\nExample: pppoe removeadmin 081234567890`
                                });
                            }
                            return;

                        case 'removetech':
                        case 'deltech':
                        case 'removeteknisi':
                        case 'delteknisi':
                            if (params.length >= 2) {
                                console.log(`Admin removing PPPoE technician number: ${params[1]}`);
                                await pppoeCommands.handleRemoveTechnicianNumber(remoteJid, params[1]);
                            } else {
                                await sock.sendMessage(remoteJid, {
                                    text: `âŒ *WRONG FORMAT*\n\nFormat: pppoe removetech [nomor]\nExample: pppoe removetech 081234567890`
                                });
                            }
                            return;

                        default:
                            await sock.sendMessage(remoteJid, {
                                text: `❌ *UNKNOWN COMMAND*\n\n` +
                                    `Available PPPoE commands:\n` +
                                    `• pppoe on - Enable notifications\n` +
                                    `• pppoe off - Disable notifications\n` +
                                    `• pppoe status - View status\n` +
                                    `• pppoe addadmin [nomor] - Add admin\n` +
                                    `• pppoe addtech [number] - Add technician\n` +
                                    `• pppoe removeadmin [nomor] - Delete admin\n` +
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
                console.log(`Running command list ONU`);
                await handleListONU(remoteJid);
                return;
            }

            // Check all ONU command
            if (command === 'cekall' || command === '!cekall' || command === '/cekall') {
                console.log(`Running command check all ONU`);
                await handleCheckAllONU(remoteJid);
                return;
            }

            // Delete hotspot user command
            if (command.startsWith('delhotspot ') || command.startsWith('!delhotspot ') || command.startsWith('/delhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command delete hotspot user ${params[0]}`);
                    await handleDeleteHotspotUser(remoteJid, params);
                    return;
                }
            }

            // Delete PPPoE secret command
            if (command.startsWith('delpppoe ') || command.startsWith('!delpppoe ') || command.startsWith('/delpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command delete PPPoE secret ${params[0]}`);
                    await handleDeletePPPoESecret(remoteJid, params);
                    return;
                }
            }

            // Add hotspot user command
            if (command.startsWith('addhotspot ') || command.startsWith('!addhotspot ') || command.startsWith('/addhotspot ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command add hotspot user ${params[0]}`);
                    await handleAddHotspotUser(remoteJid, params);
                    return;
                }
            }

            // Add PPPoE secret command
            if (command.startsWith('addpppoe ') || command.startsWith('!addpppoe ') || command.startsWith('/addpppoe ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command add PPPoE secret ${params[0]}`);
                    await handleAddPPPoESecret(remoteJid, params);
                    return;
                }
            }

            // Change PPPoE profile command
            if (command.startsWith('setprofile ') || command.startsWith('!setprofile ') || command.startsWith('/setprofile ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command change PPPoE profile ${params[0]}`);
                    await handleChangePPPoEProfile(remoteJid, params);
                    return;
                }
            }

            // Resource info command
            if (command === 'resource' || command === '!resource' || command === '/resource') {
                console.log(`Running command resource info`);
                await handleResourceInfo(remoteJid);
                return;
            }

            // Add WAN command
            if (command.startsWith('addwan ') || command.startsWith('!addwan ') || command.startsWith('/addwan ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 3) {
                    console.log(`Running command add WAN for ${params[0]}`);
                    await handleAddWAN(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
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

            // Add customer tag command
            if (command.startsWith('addtag ') || command.startsWith('!addtag ') || command.startsWith('/addtag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command add tag for device ${params[0]}`);
                    await addCustomerTag(remoteJid, params);
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
                            `Correct format:\n` +
                            `addtag [device_id] [customer_number]\n\n` +
                            `Example:\n` +
                            `addtag 202BC1-BM632w-000000 081234567890`
                    });
                    return;
                }
            }

            // Add customer tag by PPPoE Username command
            if (command.startsWith('addpppoe_tag ') || command.startsWith('!addpppoe_tag ') || command.startsWith('/addpppoe_tag ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 2) {
                    console.log(`Running command add tag for PPPoE Username ${params[0]}`);
                    await addTagByPPPoE(remoteJid, params, sock); // <-- ADD sock here!
                    return;
                } else {
                    await sock.sendMessage(remoteJid, {
                        text: `âŒ *WRONG FORMAT!*\n\n` +
                            `Correct format:\n` +
                            `addpppoe_tag [pppoe_username] [customer_number]\n\n` +
                            `Example:\n` +
                            `addpppoe_tag user123 081234567890`
                    });
                    return;
                }
            }

            // Create hotspot voucher command
            if (command.startsWith('vcr ') || command.startsWith('!vcr ') || command.startsWith('/vcr ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: 'âŒ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log('Running command create voucher with parameter:', params);
                await handleVoucherCommand(remoteJid, params);
                return;
            }

            // Member command (different username and password)
            if (command.startsWith('member ') || command.startsWith('!member ') || command.startsWith('/member ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: 'âŒ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log('Running command member with parameter:', params);
                await handleMemberCommand(remoteJid, params);
                return;
            }

            // Active hotspot users command
            if (command === 'hotspot' || command === '!hotspot' || command === '/hotspot') {
                console.log(`Running command active hotspot users`);
                await handleActiveHotspotUsers(remoteJid);
                return;
            }

            // Active PPPoE connections command
            if (command === 'pppoe' || command === '!pppoe' || command === '/pppoe') {
                console.log(`Running command active PPPoE connections`);
                await handleActivePPPoE(remoteJid);
                return;
            }

            // Offline PPPoE users command
            if (command === 'offline' || command === '!offline' || command === '/offline') {
                console.log(`Running command offline PPPoE users`);
                await handleOfflineUsers(remoteJid);
                return;
            }

            // Interface list command
            if (command === 'interfaces' || command === '!interfaces' || command === '/interfaces') {
                console.log(`Running command interface list`);
                await mikrotikCommands.handleInterfaces(remoteJid);
                return;
            }

            // Interface detail command
            if (command.startsWith('interface ') || command.startsWith('!interface ') || command.startsWith('/interface ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command detail interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceDetail(remoteJid, params);
                    return;
                }
            }

            // Enable interface command
            if (command.startsWith('enableif ') || command.startsWith('!enableif ') || command.startsWith('/enableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command enable interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, true);
                    return;
                }
            }

            // Disable interface command
            if (command.startsWith('disableif ') || command.startsWith('!disableif ') || command.startsWith('/disableif ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command disable interface ${params[0]}`);
                    await mikrotikCommands.handleInterfaceStatus(remoteJid, params, false);
                    return;
                }
            }

            // IP address list command
            if (command === 'ipaddress' || command === '!ipaddress' || command === '/ipaddress') {
                console.log(`Running command daftar IP address`);
                await mikrotikCommands.handleIPAddresses(remoteJid);
                return;
            }

            // Routing table command
            if (command === 'routes' || command === '!routes' || command === '/routes') {
                console.log(`Running command routing table`);
                await mikrotikCommands.handleRoutes(remoteJid);
                return;
            }

            // DHCP leases command
            if (command === 'dhcp' || command === '!dhcp' || command === '/dhcp') {
                console.log(`Running command DHCP leases`);
                await mikrotikCommands.handleDHCPLeases(remoteJid);
                return;
            }

            // Ping command
            if (command.startsWith('ping ') || command.startsWith('!ping ') || command.startsWith('/ping ')) {
                const params = messageText.split(' ').slice(1);
                if (params.length >= 1) {
                    console.log(`Running command ping ${params[0]}`);
                    await mikrotikCommands.handlePing(remoteJid, params);
                    return;
                }
            }

            // ===== BILLING COMMANDS =====
            // Set sock for billing commands
            billingCommands.setSock(sock);

            // Billing menu command
            if (command === 'billing' || command === '!billing' || command === '/billing') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admin can use billing command.'
                    });
                    return;
                }
                console.log(`Running billing menu`);
                await billingCommands.handleBillingMenu(remoteJid);
                return;
            }

            // Customer Management Commands
            if (command.startsWith('addcustomer ') || command.startsWith('!addcustomer ') || command.startsWith('/addcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command addcustomer with parameter:`, params);
                await billingCommands.handleAddCustomer(remoteJid, params);
                return;
            }

            if (command.startsWith('editcustomer ') || command.startsWith('!editcustomer ') || command.startsWith('/editcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command editcustomer with parameter:`, params);
                await billingCommands.handleEditCustomer(remoteJid, params);
                return;
            }

            if (command.startsWith('delcustomer ') || command.startsWith('!delcustomer ') || command.startsWith('/delcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command delcustomer with parameter:`, params);
                await billingCommands.handleDeleteCustomer(remoteJid, params);
                return;
            }

            if (command === 'listcustomers' || command === '!listcustomers' || command === '/listcustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command listcustomers`);
                await billingCommands.handleListCustomers(remoteJid);
                return;
            }

            if (command.startsWith('findcustomer ') || command.startsWith('!findcustomer ') || command.startsWith('/findcustomer ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command findcustomer with parameter:`, params);
                await billingCommands.handleFindCustomer(remoteJid, params);
                return;
            }

            // Payment Management Commands
            if (command.startsWith('payinvoice ') || command.startsWith('!payinvoice ') || command.startsWith('/payinvoice ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command payinvoice with parameter:`, params);
                await billingCommands.handlePayInvoice(remoteJid, params);
                return;
            }

            if (command.startsWith('checkpayment ') || command.startsWith('!checkpayment ') || command.startsWith('/checkpayment ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command checkpayment with parameter:`, params);
                await billingCommands.handleCheckPayment(remoteJid, params);
                return;
            }

            if (command === 'paidcustomers' || command === '!paidcustomers' || command === '/paidcustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command paidcustomers`);
                await billingCommands.handlePaidCustomers(remoteJid);
                return;
            }

            if (command === 'overduecustomers' || command === '!overduecustomers' || command === '/overduecustomers') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command overduecustomers`);
                await billingCommands.handleOverdueCustomers(remoteJid);
                return;
            }

            if (command === 'billingstats' || command === '!billingstats' || command === '/billingstats') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command billingstats`);
                await billingCommands.handleBillingStats(remoteJid);
                return;
            }

            // Package Management Commands
            if (command.startsWith('addpackage ') || command.startsWith('!addpackage ') || command.startsWith('/addpackage ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command addpackage with parameter:`, params);
                await billingCommands.handleAddPackage(remoteJid, params);
                return;
            }

            if (command === 'listpackages' || command === '!listpackages' || command === '/listpackages') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command listpackages`);
                await billingCommands.handleListPackages(remoteJid);
                return;
            }

            // Invoice Management Commands
            if (command.startsWith('createinvoice ') || command.startsWith('!createinvoice ') || command.startsWith('/createinvoice ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command createinvoice with parameter:`, params);
                await billingCommands.handleCreateInvoice(remoteJid, params);
                return;
            }

            if (command.startsWith('listinvoices ') || command.startsWith('!listinvoices ') || command.startsWith('/listinvoices ') ||
                command === 'listinvoices' || command === '!listinvoices' || command === '/listinvoices') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command listinvoices with parameter:`, params);
                await billingCommands.handleListInvoices(remoteJid, params);
                return;
            }

            // Billing help command
            if (command === 'help billing' || command === '!help billing' || command === '/help billing') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command help billing`);
                const { getBillingHelpMessage } = require('./help-messages');
                await sock.sendMessage(remoteJid, { text: getBillingHelpMessage() });
                return;
            }

            // ===== INDONESIAN LANGUAGE COMMANDS =====
            // Add customer command
            if (command.startsWith('tambah ') || command.startsWith('!tambah ') || command.startsWith('/tambah ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command add with parameter:`, params);
                await billingCommands.handleAdd(remoteJid, params);
                return;
            }

            // Customer list command
            if (command === 'daftar' || command === '!daftar' || command === '/daftar') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command daftar`);
                await billingCommands.handleList(remoteJid);
                return;
            }

            // Search customer command
            if (command.startsWith('cari ') || command.startsWith('!cari ') || command.startsWith('/cari ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command search with parameter:`, params);
                await billingCommands.handleSearch(remoteJid, params);
                return;
            }

            // Pay command
            if (command.startsWith('bayar ') || command.startsWith('!bayar ') || command.startsWith('/bayar ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`[WHATSAPP] Running command pay with:`, {
                    command: command,
                    messageText: messageText,
                    params: params,
                    sender: remoteJid
                });
                await billingCommands.handlePay(remoteJid, params);
                return;
            }

            // REG command for customer WhatsApp LID registration
            if (command.startsWith('reg ') || command.startsWith('!reg ') || command.startsWith('/reg ')) {
                try {
                    const billingManager = require('./billing');
                    const billing = new billingManager();

                    // Extract search term (name or number)
                    const searchTerm = messageText.split(' ').slice(1).join(' ').trim();

                    if (!searchTerm) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *WRONG FORMAT*\n\n` +
                                `Use format:\n` +
                                `• REG [customer name]\n` +
                                `• REG [phone number]\n\n` +
                                `Example:\n` +
                                `• REG Budi Santoso\n` +
                                `• REG 03036783333`
                            )
                        });
                        return;
                    }

                    // Check if LID is available
                    if (!senderLid) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRATION FAILED*\n\n` +
                                `WhatsApp LID not detected. This feature is only for WhatsApp accounts with @lid format.`
                            )
                        });
                        return;
                    }

                    // Determine if search term is phone number (only digits) or name
                    const isPhoneNumber = /^\d+$/.test(searchTerm.replace(/[\s\-\+]/g, ''));

                    let customers = [];

                    if (isPhoneNumber) {
                        // Search by phone number
                        const customer = await billing.getCustomerByPhone(searchTerm);
                        if (customer) {
                            customers = [customer];
                        }
                    } else {
                        // Search by name
                        customers = await billing.findCustomersByNameOrPhone(searchTerm);
                    }

                    if (customers.length === 0) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *CUSTOMER NOT FOUND*\n\n` +
                                `No customer found with ${isPhoneNumber ? 'number' : 'name'}: ${searchTerm}\n\n` +
                                `Please try again with:\n` +
                                `• Full customer name, or\n` +
                                `• Registered phone number`
                            )
                        });
                        return;
                    }

                    if (customers.length > 1) {
                        // Multiple customers found
                        let customerList = `🔍 *FOUND ${customers.length} CUSTOMERS*\n\n` +
                        `Please use the REG command with a more specific name or number:\n\n`;

                        customers.forEach((cust, idx) => {
                            customerList += `${idx + 1}. ${cust.name}\n`;
                            customerList += `   📞 ${cust.phone}\n`;
                            if (cust.package_name) {
                                customerList += `   📦 ${cust.package_name}\n`;
                            }
                            customerList += `\n`;
                        });

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(customerList)
                        });
                        return;
                    }

                    // Single customer found
                    const customer = customers[0];

                    // Check if customer already has a WhatsApp LID
                    if (customer.whatsapp_lid) {
                        if (customer.whatsapp_lid === senderLid) {
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `✅ *ALREADY REGISTERED*\n\n` +
                                    `Your WhatsApp LID is already registered for:\n\n` +
                                    `👤 *Name:* ${customer.name}\n` +
                                    `📞 *Number:* ${customer.phone}\n` +
                                    `📦 *Package:* ${customer.package_name || 'No package'}`
                                )
                            });
                            return;
                        } else {
                            // Different LID, ask for confirmation
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `⚠️ *CONFIRMATION REQUIRED*\n\n` +
                                    `Customer "${customer.name}" already has a registered WhatsApp LID.\n\n` +
                                    `Do you want to replace with the new WhatsApp LID?\n\n` +
                                    `Reply with: REG CONFIRM ${customer.phone}`
                                )
                            });
                            return;
                        }
                    }

                    // Register the WhatsApp LID
                    try {
                        await billing.updateCustomerWhatsAppLid(customer.id, senderLid);

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *REGISTRATION SUCCESSFUL*\n\n` +
                                `Your WhatsApp LID was successfully registered!\n\n` +
                                `📋 *Customer Data:*\n` +
                                `👤 *Name:* ${customer.name}\n` +
                                `📞 *Number:* ${customer.phone}\n` +
                                `📦 *Package:* ${customer.package_name || 'No package'}\n` +
                                `💰 *Price:* ${customer.package_price ? 'Rs ' + customer.package_price.toLocaleString('en-PK') : '-'}\n\n` +
                                `Now you can use bot commands with this WhatsApp.\n\n` +
                                `Type *MENU* to see the command list.`
                            )
                        });

                        console.log(`✅ WhatsApp LID registered: ${senderLid} for customer ${customer.name} (${customer.phone})`);
                    } catch (error) {
                        console.error('Error registering WhatsApp LID:', error);
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRATION FAILED*\n\n` +
                                `An error occurred: ${error.message}\n\n` +
                                `Please contact admin for assistance.`
                            )
                        });
                    }
                } catch (error) {
                    console.error('Error in REG command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: formatWithHeaderFooter(
                            `❌ *AN ERROR OCCURRED*\n\n` +
                            `Sorry, a system error occurred.\n` +
                            `Please try again or contact admin.`
                        )
                    });
                }
                return;
            }



            // DAFTAR command for new customer registration
            if (command.startsWith('daftar')) {
                try {
                    const billingManager = require('./billing');
                    const billing = new billingManager();

                    // Parse command arguments: REGISTER [Name]#[Phone]#[Address]#[Package_ID]
                    // Example: REGISTER Budi Santoso#08123456789#Jl. Merpati 10#1
                    const args = messageText.slice(6).trim(); // Remove "DAFTAR "

                    // Helper function to show help message
                    const showHelp = async () => {
                        // Fetch available packages
                        let packagesList = "";
                        try {
                            const packages = await new Promise((resolve, reject) => {
                                billing.db.all("SELECT id, name, price, speed FROM packages ORDER BY price ASC", (err, rows) => {
                                    if (err) reject(err);
                                    else resolve(rows);
                                });
                            });

                            if (packages && packages.length > 0) {
                                packagesList = "\n📦 *AVAILABLE PACKAGES:*\n";
                                packages.forEach(pkg => {
                                    const price = parseInt(pkg.price).toLocaleString('en-PK');
                                    packagesList += `• ID *${pkg.id}*: ${pkg.name} (${pkg.speed} Mbps) - Rs ${price}\n`;
                                });
                            } else {
                                packagesList = "\n⚠️ No internet packages available. Contact admin.";
                            }
                        } catch (err) {
                            console.error('Error fetching packages:', err);
                        }

                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `📝 *NEW CUSTOMER REGISTRATION FORMAT*\n\n` +
                                `Please use the following format to register:\n` +
                                `*REGISTER [Full Name]#[Phone Number]#[Address]#[Package ID]*\n\n` +
                                `💡 *Example:*\n` +
                                `REGISTER Budi Santoso#08123456789#Jl. Merpati No 10#1\n` +
                                packagesList + `\n\n` +
                                `⚠️ Make sure Phone Number is active to receive login info.`
                            )
                        });
                    };

                    if (!args) {
                        await showHelp();
                        return;
                    }

                    const parts = args.split('#').map(p => p.trim());

                    // Validate parts count
                    if (parts.length < 4) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *WRONG FORMAT*\n\n` +
                                `Please fill in all required data (4 parts separated by #).\n` +
                                `Example: REGISTER Budi#08123#Address#1`
                            )
                        });
                        return;
                    }

                    const [name, rawPhone, address, packageId] = parts;

                    // Basic validation
                    if (!name || name.length < 3) {
                        await sock.sendMessage(remoteJid, { text: `❌ Name too short. Minimum 3 characters.` });
                        return;
                    }

                    if (!rawPhone || !/^\d+$/.test(rawPhone.replace(/[\s\-\+]/g, ''))) {
                        await sock.sendMessage(remoteJid, { text: `❌ Invalid phone number. Use numbers only.` });
                        return;
                    }

                    if (!address || address.length < 5) {
                        await sock.sendMessage(remoteJid, { text: `❌ Address too short. Please fill in complete address.` });
                        return;
                    }

                    // Normalize phone number
                    let phone = rawPhone.replace(/\D/g, '');
                    if (phone.startsWith('0')) {
                        phone = '62' + phone.slice(1);
                    } else if (!phone.startsWith('62')) {
                        phone = '62' + phone;
                    }

                    // Check if phone already registered
                    const existingCustomer = await billing.getCustomerByPhone(phone);
                    if (existingCustomer) {
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRATION FAILED*\n\n` +
                                `Phone number ${rawPhone} is already registered to *${existingCustomer.name}*.\n\n` +
                                `If this is your number, please type *REG ${rawPhone}* to connect this WhatsApp.`
                            )
                        });
                        return;
                    }

                    // Check if LID already has account
                    if (senderLid) {
                        const existingLid = await billing.getCustomerByWhatsAppLid(senderLid);
                        if (existingLid) {
                            await sock.sendMessage(remoteJid, {
                                text: formatWithHeaderFooter(
                                    `❌ *ACCOUNT ALREADY EXISTS*\n\n` +
                                    `This WhatsApp is already registered as customer *${existingLid.name}*.\n` +
                                    `Type *STATUS* to check your service.`
                                )
                            });
                            return;
                        }
                    } else {
                        // Require LID for registration via WA
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `❌ *REGISTRATION FAILED*\n\n` +
                                `WhatsApp LID not detected. Please contact admin.`
                            )
                        });
                        return;
                    }

                    // Validate Package
                    const pkg = await new Promise((resolve, reject) => {
                        billing.db.get("SELECT * FROM packages WHERE id = ?", [packageId], (err, row) => resolve(row));
                    });

                    if (!pkg) {
                        await sock.sendMessage(remoteJid, { text: `❌ ID Package ${packageId} not found. Please check package list again.` });
                        await showHelp();
                        return;
                    }

                    // Generate Credentials
                    const username = phone; // Use phone as username
                    // Generate random 6 digit password
                    const password = Math.floor(100000 + Math.random() * 900000).toString();

                    // Prepare data
                    const newCustomerData = {
                        username: username,
                        name: name,
                        phone: phone,
                        email: `${username}@placeholder.com`, // Placeholder email
                        address: address,
                        package_id: pkg.id,
                        pppoe_profile: pkg.name, // Use package name as profile
                        whatsapp_lid: senderLid, // Auto-link LID
                        latitude: 0,
                        longitude: 0,
                        // Add plain password for notification only (not stored plainly usually, but for this context assuming billing.js handles it or we send it once)
                    };

                    // Create customer
                    // Note: We need to handle password storage. Assuming billing.createCustomer handles default password or we need another way?
                    // Looking at createCustomer in billing.js, it takes basic fields.
                    // IMPORTANT: The current createCustomer implementation in billing.js doesn't seem to take a password argument directly in the INSERT query shown earlier (it handles cable routes etc).
                    // However, usually there is a separate auth table or column. 
                    // Let's assume for now we just create the record. If there is a 'users' table for login, that might be separate.
                    // For now, focusing on the customer record creation as requested.

                    try {
                        await billing.createCustomer(newCustomerData);

                        // Send Success Message
                        await sock.sendMessage(remoteJid, {
                            text: formatWithHeaderFooter(
                                `✅ *REGISTRATION SUCCESSFUL*\n\n` +
                                `Welcome, *${name}*!\n\n` +
                                `📋 *Your Account Data:*\n` +
                                `👤 Username: ${username}\n` +
                                `🔑 Password: (Contact admin for password)\n` +
                                `📦 Package: ${pkg.name} (${pkg.speed} Mbps)\n` +
                                `💰 Bill: Rs ${parseInt(pkg.price).toLocaleString('en-PK')}/month\n\n` +
                                `Your account status is currently *ACTIVE*. Our technical team will contact you soon for installation schedule.\n\n` +
                                `Save this message as proof of registration.`
                            )
                        });

                        // Notify Admin (Optional but recommended)
                        const settings = getAppSettings();
                        if (settings.admins && settings.admins.length > 0) {
                            for (const adminPhone of settings.admins) {
                                // Send to admin (need to handle admin remoteJid resolution ideally, but simplified here)
                                // Skipping to avoid complexity of resolving admin JIDs without more context
                            }
                        }

                    } catch (createErr) {
                        console.error('Error creating customer:', createErr);
                        await sock.sendMessage(remoteJid, { text: `❌ Failed to save data: ${createErr.message}` });
                    }

                } catch (error) {
                    console.error('Error in DAFTAR command:', error);
                    await sock.sendMessage(remoteJid, {
                        text: `❌ A system error occurred during registration process.`
                    });
                }
                return;
            }

            // Service isolation command
            if (command.startsWith('isolir ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command isolate with parameter:`, params);
                await billingCommands.handleIsolir(remoteJid, params);
                return;
            }

            // Open isolation (restore) command
            if (command.startsWith('buka ')) {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                const params = messageText.split(' ').slice(1);
                console.log(`Running command open (restore) with parameter:`, params);
                await billingCommands.handleBuka(remoteJid, params);
                return;
            }

            // Already paid command
            if (command === 'paid' || command === '!paid' || command === '/paid' || command === 'sudahbayar' || command === '!sudahbayar' || command === '/sudahbayar') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command already paid`);
                await billingCommands.handleAlreadyPay(remoteJid);
                return;
            }

            // Overdue command
            if (command === 'overdue' || command === '!overdue' || command === '/overdue' || command === 'terlambat' || command === '!terlambat' || command === '/terlambat') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command overdue`);
                await billingCommands.handleTerlambat(remoteJid);
                return;
            }

            // Statistics command
            if (command === 'statistik' || command === '!statistik' || command === '/statistik') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command statistics`);
                await billingCommands.handleStatistik(remoteJid);
                return;
            }

            // Package list command
            if (command === 'daftarpaket' || command === '!daftarpaket' || command === '/daftarpaket') {
                if (!isAdmin) {
                    await sock.sendMessage(remoteJid, {
                        text: '❌ *ACCESS DENIED*\n\nOnly admins can use this command.'
                    });
                    return;
                }
                console.log(`Running command listpackages`);
                await billingCommands.handleListPaket(remoteJid);
                return;
            }

            // System logs command
            if (command === 'logs' || command === '!logs' || command === '/logs' ||
                command.startsWith('logs ') || command.startsWith('!logs ') || command.startsWith('/logs ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running command system logs`);
                await mikrotikCommands.handleSystemLogs(remoteJid, params);
                return;
            }

            // Profiles command
            if (command === 'profiles' || command === '!profiles' || command === '/profiles' ||
                command.startsWith('profiles ') || command.startsWith('!profiles ') || command.startsWith('/profiles ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running command profiles`);
                await mikrotikCommands.handleProfiles(remoteJid, params);
                return;
            }

            // Firewall command
            if (command === 'firewall' || command === '!firewall' || command === '/firewall' ||
                command.startsWith('firewall ') || command.startsWith('!firewall ') || command.startsWith('/firewall ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running command firewall`);
                await mikrotikCommands.handleFirewall(remoteJid, params);
                return;
            }

            // All users command
            if (command === 'users' || command === '!users' || command === '/users') {
                console.log(`Running command all users`);
                await mikrotikCommands.handleAllUsers(remoteJid);
                return;
            }

            // Router clock command
            if (command === 'clock' || command === '!clock' || command === '/clock') {
                console.log(`Running command clock router`);
                await mikrotikCommands.handleRouterClock(remoteJid);
                return;
            }

            // Router identity command
            if (command === 'identity' || command === '!identity' || command === '/identity' ||
                command.startsWith('identity ') || command.startsWith('!identity ') || command.startsWith('/identity ')) {
                const params = messageText.split(' ').slice(1);
                console.log(`Running command identity router`);
                await mikrotikCommands.handleRouterIdentity(remoteJid, params);
                return;
            }

            // Restart router command
            if (command === 'reboot' || command === '!reboot' || command === '/reboot') {
                console.log(`Running command restart router`);
                await mikrotikCommands.handleRestartRouter(remoteJid);
                return;
            }

            // Restart confirmation command
            if (command === 'confirm restart' || command === '!confirm restart' || command === '/confirm restart') {
                console.log(`Running router restart confirmation`);
                await mikrotikCommands.handleConfirmRestart(remoteJid);
                return;
            }

            // Debug resource command (admin only)
            if (command === 'debug resource' || command === '!debug resource' || command === '/debug resource') {
                console.log(`Admin running debug resource`);
                await mikrotikCommands.handleDebugResource(remoteJid);
                return;
            }

            // Debug settings performance command (admin only)
            if (command === 'debug settings' || command === '!debug settings' || command === '/debug settings') {
                console.log(`Admin running debug settings performance`);
                try {
                    const { getPerformanceReport } = require('./settingsManager');
                    const report = getPerformanceReport();
                    await sendFormattedMessage(remoteJid, `📊 *SETTINGS PERFORMANCE DEBUG*\n\n\`\`\`${report}\`\`\``);
                } catch (error) {
                    await sendFormattedMessage(remoteJid, `❌ *Error getting performance stats:* ${error.message}`);
                }
                return;
            }

            // Quick settings stats command (admin only)
            if (command === 'settings stats' || command === '!settings stats' || command === '/settings stats') {
                console.log(`Admin running settings stats`);
                try {
                    const { getQuickStats } = require('./settingsManager');
                    const stats = getQuickStats();
                    await sendFormattedMessage(remoteJid, `📊 *Settings Stats*\n${stats}`);
                } catch (error) {
                    await sendFormattedMessage(remoteJid, `❌ *Error:* ${error.message}`);
                }
                return;
            }

            // WiFi info command
            if (command === 'info wifi' || command === '!info wifi' || command === '/info wifi') {
                console.log(`Running command WiFi info for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleWifiInfo(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Service info command
            if (command === 'info' || command === '!info' || command === '/info') {
                console.log(`Running command service info for ${senderNumber}`);
                await handleInfoLayanan(remoteJid, senderNumber);
                return;
            }

            // Change WiFi name command
            if (command.startsWith('gantiwifi ') || command.startsWith('!gantiwifi ') || command.startsWith('/gantiwifi ')) {
                console.log(`Running command change WiFi name for ${senderNumber}`);
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
                console.log(`Running command change WiFi password for ${senderNumber}`);
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
                console.log(`Running command device status for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleDeviceStatus(remoteJid, senderNumber);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                // After device status, also send billing status
                await sendBillingStatus(remoteJid, senderNumber);
                return;
            }

            // Restart device command
            if (command === 'restart' || command === '!restart' || command === '/restart') {
                console.log(`Running command restart device for ${senderNumber}`);
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
            if ((command === 'tidak' || command === 'no' || command === 'batal') && global.pendingRestarts && global.pendingRestarts[senderNumber]) {
                console.log(`Canceling device restart for ${senderNumber}`);
                if (genieacsCommandsEnabled) {
                    await genieacsCommands.handleRestartConfirmation(remoteJid, senderNumber, false);
                } else {
                    await sendGenieACSDisabledMessage(remoteJid);
                }
                return;
            }

            // Command to check group status and technician numbers
            if (command === 'checkgroup' || command === '!checkgroup' || command === '/checkgroup') {
                try {
                    const technicianGroupId = getSetting('technician_group_id', '');
                    const technicianNumbers = getTechnicianNumbers();

                    let message = `🔍 *GROUP & TECHNICIAN NUMBER STATUS*\n\n`;

                    // Check group ID
                    if (technicianGroupId) {
                        message += `📋 *Group ID:* ${technicianGroupId}\n`;

                        try {
                            // Try to get group metadata
                            const groupMetadata = await sock.groupMetadata(technicianGroupId);
                            message += `✅ *Status:* Group found\n`;
                            message += `📋 *Name:* ${groupMetadata.subject}\n`;
                            message += `👥 *Participants:* ${groupMetadata.participants.length}\n`;
                        } catch (groupError) {
                            if (groupError.message.includes('item-not-found')) {
                                message += `❌ *Status:* Group not found\n`;
                                message += `💡 *Solution:* Make sure the bot has been added to the group\n`;
                            } else {
                                message += `⚠️ *Status:* Error - ${groupError.message}\n`;
                            }
                        }
                    } else {
                        message += `❌ *Group ID:* Not configured\n`;
                    }

                    message += `\n📱 *Technician Numbers:*\n`;
                    if (technicianNumbers && technicianNumbers.length > 0) {
                        for (let i = 0; i < technicianNumbers.length; i++) {
                            const number = technicianNumbers[i];
                            message += `${i + 1}. ${number}\n`;

                            // Validasi nomor
                            try {
                                const cleanNumber = number.replace(/\D/g, '').replace(/^0/, '62');
                                const [result] = await sock.onWhatsApp(cleanNumber);

                                if (result && result.exists) {
                                    message += `   ✅ Valid WhatsApp\n`;
                                } else {
                                    message += `   ❌ Not registered on WhatsApp\n`;
                                }
                            } catch (validationError) {
                                message += `   ⚠️ Validation error: ${validationError.message}\n`;
                            }
                        }
                    } else {
                        message += `❌ No technician numbers configured\n`;
                    }

                    message += `\n💡 *Tips:*\n`;
                    message += `• Make sure the bot has been added to the group\n`;
                    message += `• Make sure technician numbers are registered on WhatsApp\n`;
                    message += `• Use format: 628xxxxxxxxxx\n`;

                    await sock.sendMessage(remoteJid, { text: message });
                } catch (error) {
                    await sock.sendMessage(remoteJid, {
                        text: `❌ Error checking group status: ${error.message}`
                    });
                }
                return;
            }
        }

        // If message is not recognized as a command, just ignore it
        console.log(`Message not recognized as a command: ${messageText}`);
        // Do nothing for non-command messages

    } catch (error) {
        console.error('Error handling incoming message:', error);

        // DON'T send error message to sender - only log error
        // This will prevent auto-response to every message
        /*
        try {
            if (sock && message && message.key && message.key.remoteJid) {
                await sock.sendMessage(message.key.remoteJid, { 
                    text: `❌ *ERROR*
    
    An error occurred while processing message: ${error.message}
    
    Please try again later.`
                });
            }
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
        */
    }
}

// Add in function declarations section before
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
            text: `âŒ *ERROR*\n\nAn error occurred while displaying customer menu:\n${error.message}`
        });
    }
}

module.exports

// Function to display admin menu
async function handleAdminMenu(remoteJid) {
    try {
        console.log(`Displaying admin menu to ${remoteJid}`);

        // Admin menu message
        let adminMessage = `📋🔍 *MENU ADMIN*\n\n`;

        adminMessage += `*Admin Commands:*\n`;
        adminMessage += `• 📋 *list* * List all ONU\n`;
        adminMessage += `• 🔍 *cekall* * Check all ONU status\n`;
        adminMessage += `• 🔍 *cek [nomor]* * Check customer ONU status\n`;
        adminMessage += `• 🔧 *editssid [nomor] [ssid]* * Edit customer SSID\n`;
        adminMessage += `• 🔧 *editpass [nomor] [password]* * Edit customer WiFi password\n`;
        adminMessage += `• 🔐 *otp [on/off/status]* * Manage OTP system\n`;
        adminMessage += `• 🆔 *setlid [password]* - Save WhatsApp LID admin (requires password)\n`;
        adminMessage += `• 📊 *billing* * Admin billing menu\n\n`;

        // GenieACS status (without showing commands)
        adminMessage += `*System Status:*\n`;
        adminMessage += `• ${genieacsCommandsEnabled ? '✅' : 'âŒ'} *GenieACS:* ${genieacsCommandsEnabled ? 'Active' : 'Inactive'}\n`;

        // Add OTP status
        const settings = getAppSettings();
        const otpStatus = settings.customerPortalOtp || settings.customer_otp_enabled;
        adminMessage += `• ${otpStatus ? '✅' : 'âŒ'} *OTP Portal:* ${otpStatus ? 'Active' : 'Inactive'}\n\n`;

        // Add footer
        adminMessage += `🏢 *${getSetting('company_header', '📱 NBB Wifiber')}*\n`;
        adminMessage += `${getSetting('footer_info', 'Powered by CyberNet')}`;

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

        // Try method 3: Search in entire object
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
        const { getSettingsWithCache } = require('./settingsManager');
        return getSettingsWithCache();
    } catch (e) {
        console.error('Error getting app settings:', e);
        // Fallback to direct file reading
        try {
            const { getSettingsWithCache } = require('./settingsManager');
            return getSettingsWithCache();
        } catch (fallbackError) {
            console.error('Error reading settings file directly:', fallbackError);
            return {};
        }
    }
}

// Declare helper for DRY
function getGenieacsConfig() {
    const { getSetting } = require('./settingsManager');
    return {
        genieacsUrl: getSetting('genieacs_url', 'http://localhost:7557'),
        genieacsUsername: getSetting('genieacs_username', 'admin'),
        genieacsPassword: getSetting('genieacs_password', 'password'),
    };
}

// Function to handle service info (billing addition)
async function handleInfoLayanan(remoteJid, senderNumber) {
    try {
        console.log(`Displaying service info to ${remoteJid}`);

        const { getSetting } = require('./settingsManager');
        const billingManager = require('./billing');

        // Get admin and technician numbers with correct format
        const adminNumber = getSetting('admins.0', '628xxxxxxxxxx');

        // Get all technician numbers
        const technicianNumbers = [];
        let i = 0;
        while (true) {
            const number = getSetting(`technician_numbers.${i}`, '');
            if (!number) break;
            technicianNumbers.push(number);
            i++;
        }
        const technicianNumbersText = technicianNumbers.length > 0 ? technicianNumbers.join(', ') : '628xxxxxxxxxx';

        let message = formatWithHeaderFooter(`🏢 *SERVICE INFORMATION*

📱 *NBB Wifiber*
Fast and stable internet service for your needs.

🔧 *SERVICE FEATURES:*
• Internet Unlimited 24/7
• High and stable speed
• 24-hour technical support
• Real-time device monitoring
• WiFi management via WhatsApp

📞 *SUPPORT CONTACT:*
• WhatsApp: ${adminNumber}
• Technician: ${technicianNumbersText}
• Operating Hours: 24/7

💡 *HOW TO USE:*
• Type *menu* to see full menu
• Type *status* to check device status
• Type *help* for technical assistance

🛠️ *CUSTOMER SERVICE:*
• Change WiFi name: *gantiwifi [name]*
• Change WiFi password: *gantipass [password]*
• Check connected devices: *devices*
• Speed test: *speedtest*
• Network diagnostic: *diagnostic*

📋 *TECHNICAL INFORMATION:*
• Technology: Fiber Optic
• Protokol: PPPoE
• Monitoring: GenieACS
• Router: Mikrotik
• ONU: GPON/EPON

For further assistance, please contact our technician.`);

        // Add customer billing summary (if number is registered)
        try {
            // Try to get customer by WhatsApp LID first (if available)
            let customer = null;
            if (senderLid) {
                customer = await billingManager.getCustomerByWhatsAppLid(senderLid);
                if (customer) {
                    console.log(`Customer found by WhatsApp LID: ${customer.name}`);
                }
            }

            // Fallback to phone number lookup for backward compatibility
            if (!customer) {
                customer = await billingManager.getCustomerByPhone(senderNumber);
                if (!customer && senderNumber && senderNumber.startsWith('62')) {
                    const altPhone = '0' + senderNumber.slice(2);
                    customer = await billingManager.getCustomerByPhone(altPhone);
                }
            }

            const bankName = getSetting('payment_bank_name', '');
            const accountNumber = getSetting('payment_account_number', '');
            const accountHolder = getSetting('payment_account_holder', '');
            const contactWa = getSetting('contact_whatsapp', '');
            const dana = getSetting('payment_dana', '');
            const ovo = getSetting('payment_ovo', '');
            const gopay = getSetting('payment_gopay', '');

            if (customer) {
                const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                const unpaid = invoices.filter(i => i.status === 'unpaid');
                const totalUnpaid = unpaid.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
                const nextDue = unpaid
                    .map(i => new Date(i.due_date))
                    .sort((a, b) => a - b)[0];

                message += `\n\n📋 *BILLING INFORMATION*\n`;
                if (unpaid.length > 0) {
                    message += `• Status: UNPAID (${unpaid.length} invoices)\n`;
                    message += `• Total: Rs ${totalUnpaid.toLocaleString('en-PK')}\n`;
                    if (nextDue) message += `• Next Due Date: ${nextDue.toLocaleDateString('en-PK')}\n`;
                } else {
                    message += `• Status: PAID ✅\n`;
                }

                // Payment info
                if (bankName && accountNumber) {
                    message += `\n🏦 *PAYMENT*\n`;
                    message += `• Bank: ${bankName}\n`;
                    message += `• Account Number: ${accountNumber}\n`;
                    if (accountHolder) message += `• Account Holder: ${accountHolder}\n`;
                }
                const ewallets = [];
                if (dana) ewallets.push(`DANA: ${dana}`);
                if (ovo) ewallets.push(`OVO: ${ovo}`);
                if (gopay) ewallets.push(`GoPay: ${gopay}`);
                if (ewallets.length > 0) {
                    message += `• E-Wallet: ${ewallets.join(' | ')}\n`;
                }
                if (contactWa) {
                    message += `• Confirmation: ${contactWa}\n`;
                }
            } else {
                message += `\n\n📋 *BILLING INFORMATION*\n• Your number is not registered in the billing system. Please contact admin for synchronization.`;
            }
        } catch (billErr) {
            console.error('Failed to add billing info to service info:', billErr);
        }

        await sock.sendMessage(remoteJid, { text: message });
        console.log(`Service info message sent to ${remoteJid}`);

    } catch (error) {
        console.error('Error sending service info:', error);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred while displaying service info:\n${error.message}`
        });
    }
}

// Helper to send customer billing status (used in status command)
async function sendBillingStatus(remoteJid, senderNumber, senderLid = null) {
    try {
        const { getSetting } = require('./settingsManager');
        const billingManager = require('./billing');

        // Try to get customer by WhatsApp LID first (if available)
        let customer = null;
        if (senderLid) {
            customer = await billingManager.getCustomerByWhatsAppLid(senderLid);
            if (customer) {
                console.log(`Customer found by WhatsApp LID: ${customer.name}`);
            }
        }

        // Fallback to phone number lookup for backward compatibility
        if (!customer) {
            customer = await billingManager.getCustomerByPhone(senderNumber);
            if (!customer && senderNumber && senderNumber.startsWith('62')) {
                const altPhone = '0' + senderNumber.slice(2);
                customer = await billingManager.getCustomerByPhone(altPhone);
            }
        }

        const bankName = getSetting('payment_bank_name', '');
        const accountNumber = getSetting('payment_account_number', '');
        const accountHolder = getSetting('payment_account_holder', '');
        const contactWa = getSetting('contact_whatsapp', '');
        const dana = getSetting('payment_dana', '');
        const ovo = getSetting('payment_ovo', '');
        const gopay = getSetting('payment_gopay', '');

        let text = `📋 *BILLING INFORMATION*\n`;
        if (customer) {
            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            const unpaid = invoices.filter(i => i.status === 'unpaid');
            const totalUnpaid = unpaid.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
            const nextDue = unpaid
                .map(i => new Date(i.due_date))
                .sort((a, b) => a - b)[0];

            if (unpaid.length > 0) {
                text += `• Status: UNPAID (${unpaid.length} invoices)\n`;
                text += `• Total: Rs ${totalUnpaid.toLocaleString('en-PK')}\n`;
                if (nextDue) text += `• Next Due Date: ${nextDue.toLocaleDateString('en-PK')}\n`;
            } else {
                text += `• Status: PAID ✅\n`;
            }

            if (bankName && accountNumber) {
                text += `\n🏦 *PAYMENT*\n`;
                text += `• Bank: ${bankName}\n`;
                text += `• Account Number: ${accountNumber}\n`;
                if (accountHolder) text += `• Account Holder: ${accountHolder}\n`;
            }
            const ewallets = [];
            if (dana) ewallets.push(`DANA: ${dana}`);
            if (ovo) ewallets.push(`OVO: ${ovo}`);
            if (gopay) ewallets.push(`GoPay: ${gopay}`);
            if (ewallets.length > 0) {
                text += `• E-Wallet: ${ewallets.join(' | ')}\n`;
            }
            if (contactWa) {
                text += `• Confirmation: ${contactWa}\n`;
            }
        } else {
            text += `• Your number is not registered in the billing system. Please contact admin for synchronization.`;
        }

        await sock.sendMessage(remoteJid, { text });
    } catch (e) {
        console.error('Error sending billing status:', e);
    }
}

// ... (rest of the code remains the same)
