let sock = null;
const { getSetting } = require('./settingsManager');

// Function to set sock instance
function setSock(sockInstance) {
    sock = sockInstance;
}

// Helper function to format phone number
function formatPhoneNumber(number) {
    // Remove non-digit characters
    let cleaned = number.replace(/\D/g, '');
    
    // Remove prefix 0 if exists
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    
    // Add country code 62 if not exists
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    
    return cleaned;
}

// Helper function to get header and footer from settings
function getHeaderFooter() {
    try {
        const { getSettingsWithCache } = require('./settingsManager');
        const settings = getSettingsWithCache();
        
        return {
            header: settings.company_header || '📱 NBB Wifiber',
            footer: settings.footer_info || 'Powered by CyberNet'
        };
    } catch (error) {
        return {
            header: '📱 NBB Wifiber',
            footer: 'Powered by CyberNet'
        };
    }
}

// Helper function to format message with header and footer
function formatMessageWithHeaderFooter(message, includeHeader = true, includeFooter = true) {
    const { header, footer } = getHeaderFooter();
    
    let formattedMessage = '';
    
    if (includeHeader) {
        formattedMessage += `🏢 *${header}*\n\n`;
    }
    
    formattedMessage += message;
    
    if (includeFooter) {
        formattedMessage += `\n\n${footer}`;
    }
    
    return formattedMessage;
}

// Function to send message
async function sendMessage(number, message) {
    if (!sock) {
        console.error('WhatsApp not connected');
        return false;
    }
    try {
        let jid;
        if (typeof number === 'string' && number.endsWith('@g.us')) {
            // If group JID, use directly
            jid = number;
        } else {
            const formattedNumber = formatPhoneNumber(number);
            jid = `${formattedNumber}@s.whatsapp.net`;
        }
        
        // Format message with header and footer
        let formattedMessage;
        if (typeof message === 'string') {
            formattedMessage = { text: formatMessageWithHeaderFooter(message) };
        } else if (message.text) {
            formattedMessage = { text: formatMessageWithHeaderFooter(message.text) };
        } else {
            formattedMessage = message;
        }
        
        await sock.sendMessage(jid, formattedMessage);
        return true;
    } catch (error) {
        console.error('Error sending message:', error);
        return false;
    }
}

// Function to send message to group numbers
async function sendGroupMessage(numbers, message) {
    try {
        if (!sock) {
            console.error('Sock instance not set');
            return { success: false, sent: 0, failed: 0, results: [] };
        }

        const results = [];
        let sent = 0;
        let failed = 0;

        // Parse numbers if in string format
        let numberArray = numbers;
        if (typeof numbers === 'string') {
            numberArray = numbers.split(',').map(n => n.trim());
        }

        for (const number of numberArray) {
            try {
                // Validate and format number
                let cleanNumber = number.replace(/\D/g, '');
                
                // If starts with 0, replace with 62
                if (cleanNumber.startsWith('0')) {
                    cleanNumber = '62' + cleanNumber.substring(1);
                }
                
                // If not starts with 62, add
                if (!cleanNumber.startsWith('62')) {
                    cleanNumber = '62' + cleanNumber;
                }
                
                // Validasi panjang nomor (at least 10 digit setelah 62)
                if (cleanNumber.length < 12) {
                    console.warn(`Skipping invalid WhatsApp number: ${number} (too short)`);
                    failed++;
                    results.push({ number, success: false, error: 'Invalid number format' });
                    continue;
                }

                // Check if number is registered on WhatsApp
                const [result] = await sock.onWhatsApp(cleanNumber);
                if (!result || !result.exists) {
                    console.warn(`Skipping invalid WhatsApp number: ${cleanNumber} (not registered)`);
                    failed++;
                    results.push({ number: cleanNumber, success: false, error: 'Not registered on WhatsApp' });
                    continue;
                }

                // Send message
                await sock.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: formatMessageWithHeaderFooter(message) });
                console.log(`Message sent to: ${cleanNumber}`);
                sent++;
                results.push({ number: cleanNumber, success: true });

            } catch (error) {
                console.error(`Error sending message to ${number}:`, error.message);
                failed++;
                results.push({ number, success: false, error: error.message });
            }
        }

        return {
            success: sent > 0,
            sent,
            failed,
            results
        };
    } catch (error) {
        console.error('Error in sendGroupMessage:', error);
        return { success: false, sent: 0, failed: numberArray ? numberArray.length : 0, results: [] };
    }
}

// Function to send message to technician group
async function sendTechnicianMessage(message, priority = 'normal') {
    try {
        // Get list of technicians from database with whatsapp_group_id
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');

        const dbPath = path.join(__dirname, '../data/billing.db');
        const db = new sqlite3.Database(dbPath);

        const technicians = await new Promise((resolve, reject) => {
            const query = `
                SELECT phone, name, role, whatsapp_group_id
                FROM technicians
                WHERE is_active = 1
                ORDER BY role, name
            `;

            db.all(query, [], (err, rows) => {
                db.close();
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const technicianNumbers = technicians.map(tech => tech.phone);
        const technicianGroupId = getSetting('technician_group_id', '');
        let sentToGroup = false;
        let sentToNumbers = false;
        let sentToIndividualGroups = false;

        // Message priority addition
        let priorityIcon = '';
        if (priority === 'high') {
            priorityIcon = '🟠 *PENTING* ';
        } else if (priority === 'low') {
            priorityIcon = '🟢 *Info* ';
        }
        const priorityMessage = priorityIcon + message;

        // 1. Kirim ke grup utama (dari settings.json) jika ada
        if (technicianGroupId) {
            try {
                await sendMessage(technicianGroupId, priorityMessage);
                sentToGroup = true;
                console.log(`✅ Pesan dikirim ke grup teknisi utama: ${technicianGroupId}`);
            } catch (e) {
                console.error('❌ Failed to send to main technician group:', e);
            }
        }

        // 2. Send to individual technician groups if exists
        const techniciansWithGroups = technicians.filter(tech => tech.whatsapp_group_id && tech.whatsapp_group_id.trim() !== '');
        if (techniciansWithGroups.length > 0) {
            console.log(`📱 Sending ke ${techniciansWithGroups.length} grup teknisi individual...`);

            for (const tech of techniciansWithGroups) {
                try {
                    await sendMessage(tech.whatsapp_group_id, priorityMessage);
                    console.log(`✅ Pesan dikirim ke grup ${tech.name}: ${tech.whatsapp_group_id}`);
                    sentToIndividualGroups = true;
                } catch (e) {
                    console.error(`❌ Failed to send to group ${tech.name} (${tech.whatsapp_group_id}):`, e);
                }
            }
        }

        // 3. Send to individual technician numbers if exists
        if (technicianNumbers && technicianNumbers.length > 0) {
            console.log(`📤 Sending ke ${technicianNumbers.length} nomor teknisi: ${technicianNumbers.join(', ')}`);
            const result = await sendGroupMessage(technicianNumbers, priorityMessage);
            sentToNumbers = result.success;
            console.log(`📊 Hasil pengiriman ke nomor teknisi: ${result.sent} successful, ${result.failed} gagal`);

            if (result.sent > 0) {
                sentToNumbers = true;
            }
        } else {
            console.log(`⚠️ Tidak ada nomor teknisi yang terdaftar, fallback ke admin`);
            // If no technician numbers, fallback to admin
            const adminNumber = getSetting('admins.0', '');
            if (adminNumber) {
                console.log(`📤 Fallback: Sending ke admin ${adminNumber}`);
                const adminResult = await sendMessage(adminNumber, priorityMessage);
                sentToNumbers = adminResult;
                console.log(`📊 Admin fallback result: ${adminResult ? 'successful' : 'failed'}`);
            } else {
                console.log(`❌ Tidak ada admin number yang tersedia untuk fallback`);
            }
        }

        const overallSuccess = sentToGroup || sentToIndividualGroups || sentToNumbers;

        console.log(`\n📊 SUMMARY OF TECHNICIAN MESSAGE DELIVERY:`);
        console.log(`   - Main group: ${sentToGroup ? '✅' : '❌'}`);
        console.log(`   - Individual groups: ${sentToIndividualGroups ? '✅' : '❌'} (${techniciansWithGroups.length} groups)`);
        console.log(`   - Individual numbers: ${sentToNumbers ? '✅' : '❌'} (${technicianNumbers.length} numbers)`);
        console.log(`   - Overall status: ${overallSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);

        return overallSuccess;
    } catch (error) {
        console.error('Error sending message to technician group:', error);
        return false;
    }
}

module.exports = {
    setSock,
    sendMessage,
    sendGroupMessage,
    sendTechnicianMessage,
    formatMessageWithHeaderFooter,
    getHeaderFooter
};
