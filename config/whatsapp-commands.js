const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class WhatsAppCommands {
    constructor(whatsappCore) {
        this.core = whatsappCore;
        this.sock = null;
    }

    // Set socket instance
    setSock(sock) {
        this.sock = sock;
    }

    // Get socket instance
    getSock() {
        return this.sock || this.core.getSock();
    }

    // Helper function to send message
    async sendMessage(remoteJid, text) {
        const sock = this.getSock();
        if (!sock) {
            console.error('Sock instance not set');
            return false;
        }

        try {
            await sock.sendMessage(remoteJid, { text });
            return true;
        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    }

    // Command: cek status perangkat
    async handleCekStatus(remoteJid, customerNumber) {
        if (!customerNumber) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\n` +
                      `Correct format:\n` +
                      `cek [customer_number]\n\n` +
                      `Example:\n` +
                      `cek 123456`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `🔍 *SEARCHING DEVICE*\n\nSearching device for customer ${customerNumber}...\nPlease wait a moment.`);

            // Implementasi cek status perangkat
            // ... existing code ...
            
        } catch (error) {
            console.error('Error in handleCekStatus:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while checking status:\n${error.message}`);
        }
    }

    // Command: change WiFi SSID
    async handleGantiSSID(remoteJid, customerNumber, newSSID) {
        if (!customerNumber || !newSSID) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\ngantissid [customer_number] [new_ssid]\n\nExample:\ngantissid 123456 WiFiBaru`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *SSID CHANGE PROCESS*\n\nChanging WiFi SSID...\nPlease wait a moment.`);

            // Implementasi ganti SSID
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleGantiSSID:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while changing SSID:\n${error.message}`);
        }
    }

    // Command: change WiFi password
    async handleGantiPassword(remoteJid, customerNumber, newPassword) {
        if (!customerNumber || !newPassword) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\ngantipass [customer_number] [new_password]\n\nExample:\ngantipass 123456 password123`);
            return;
        }

        if (newPassword.length < 8) {
            await this.sendMessage(remoteJid, `❌ *Password too short!*\n\nPassword must be at least 8 characters.`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *PASSWORD CHANGE PROCESS*\n\nChanging WiFi password...\nPlease wait a moment.`);

            // Implementasi ganti password
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleGantiPassword:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while changing password:\n${error.message}`);
        }
    }

    // Command: reboot device
    async handleReboot(remoteJid, customerNumber) {
        if (!customerNumber) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\nreboot [customer_number]\n\nExample:\nreboot 123456`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *REBOOT PROCESS*\n\nRestarting device...\nPlease wait a moment.`);

            // Implementasi reboot
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleReboot:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while rebooting:\n${error.message}`);
        }
    }

    // Command: add tag
    async handleAddTag(remoteJid, deviceId, customerNumber) {
        if (!deviceId || !customerNumber) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\naddtag [device_id] [customer_number]\n\nExample:\naddtag device123 123456`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *TAG ADDITION PROCESS*\n\nAdding tag...\nPlease wait a moment.`);

            // Implementasi tambah tag
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleAddTag:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while adding tag:\n${error.message}`);
        }
    }

    // Command: remove tag
    async handleRemoveTag(remoteJid, deviceId, tag) {
        if (!deviceId || !tag) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\nuntag [device_id] [tag]\n\nExample:\nuntag device123 tag123`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *TAG DELETION PROCESS*\n\nDeleting tag...\nPlease wait a moment.`);

            // Implementasi hapus tag
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleRemoveTag:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while deleting tag:\n${error.message}`);
        }
    }

    // Command: view tags
    async handleListTags(remoteJid, deviceId) {
        if (!deviceId) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\ntags [device_id]\n\nExample:\ntags device123`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `🔍 *SEARCHING TAGS*\n\nSearching tags for device ${deviceId}...\nPlease wait a moment.`);

            // Implementasi lihat tags
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleListTags:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while searching tags:\n${error.message}`);
        }
    }

    // Command: refresh device
    async handleRefresh(remoteJid, deviceId) {
        if (!deviceId) {
            await this.sendMessage(remoteJid, `❌ *WRONG FORMAT*\n\nCorrect format:\nrefresh [device_id]\n\nExample:\nrefresh device123`);
            return;
        }

        try {
            await this.sendMessage(remoteJid, `⏳ *REFRESH PROCESS*\n\nRefreshing device data...\nPlease wait a moment.`);

            // Implementasi refresh
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleRefresh:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while refreshing:\n${error.message}`);
        }
    }

    // Command: check all devices
    async handleCekAll(remoteJid) {
        try {
            await this.sendMessage(remoteJid, `🔍 *SEARCHING ALL DEVICES*\n\nSearching all devices...\nPlease wait a moment.`);

            // Implementasi cek semua perangkat
            // ... existing code ...

        } catch (error) {
            console.error('Error in handleCekAll:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while searching devices:\n${error.message}`);
        }
    }

    // Command: set header
    async handleSetHeader(remoteJid, newHeader) {
        if (!newHeader) {
            await this.sendMessage(remoteJid, `❌ *Wrong format!*\n\nsetheader [new_header_text]`);
            return;
        }

        try {
            const { setSetting } = require('./settingsManager');
            const success = setSetting('company_header', newHeader);
            
            if (success) {
                await this.sendMessage(remoteJid, `✅ *Header successfully changed!*\n\nNew header: ${newHeader}`);
            } else {
                await this.sendMessage(remoteJid, `❌ *Failed to change header!*\n\nAn error occurred while saving to settings.`);
            }
        } catch (error) {
            console.error('Error in handleSetHeader:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while changing header:\n${error.message}`);
        }
    }

    // Command: system status
    async handleStatus(remoteJid) {
        try {
            const status = this.core.getWhatsAppStatus();
            const uptime = process.uptime();
            const uptimeHours = Math.floor(uptime / 3600);
            const uptimeMinutes = Math.floor((uptime % 3600) / 60);
            
            let message = `📊 *SYSTEM STATUS*\n\n`;
            message += `• WhatsApp: ${status.connected ? '🟢 Connected' : '🔴 Disconnected'}\n`;
            message += `• Uptime: ${uptimeHours}h ${uptimeMinutes}m\n`;
            message += `• Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`;
            message += `• Node.js: ${process.version}\n`;
            message += `• Platform: ${process.platform}\n`;
            
            if (status.connectedSince) {
                message += `• Connected since: ${status.connectedSince.toLocaleString('en-PK')}\n`;
            }
            
            await this.sendMessage(remoteJid, message);
        } catch (error) {
            console.error('Error in handleStatus:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while displaying status:\n${error.message}`);
        }
    }

    // Command: restart application
    async handleRestart(remoteJid) {
        try {
            await this.sendMessage(remoteJid, `⚠️ *RESTART CONFIRMATION*\n\nAre you sure you want to restart the application?\n\nType: *ya* to confirm\nType: *tidak* to cancel`);
            
            // Set flag for restart confirmation
            global.pendingRestart = true;
            global.restartRequestedBy = remoteJid;
            
        } catch (error) {
            console.error('Error in handleRestart:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while processing restart:\n${error.message}`);
        }
    }

    // Command: confirm restart
    async handleConfirmRestart(remoteJid) {
        try {
            if (global.pendingRestart && global.restartRequestedBy === remoteJid) {
                await this.sendMessage(remoteJid, `🔄 *RESTARTING APPLICATION*\n\nApplication will restart in 5 seconds...\n\nThank you for using our service.`);
                
                // Clear flags
                global.pendingRestart = false;
                global.restartRequestedBy = null;
                
                // Restart after 5 seconds
                setTimeout(() => {
                    process.exit(0);
                }, 5000);
            } else {
                await this.sendMessage(remoteJid, `❌ *NO RESTART REQUEST*\n\nNo pending restart request.`);
            }
        } catch (error) {
            console.error('Error in handleConfirmRestart:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while confirming restart:\n${error.message}`);
        }
    }

    // Command: debug resource
    async handleDebugResource(remoteJid) {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            let message = `🔍 *DEBUG RESOURCE*\n\n`;
            message += `• Memory Usage:\n`;
            message += `  - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB\n`;
            message += `  - Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\n`;
            message += `  - Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB\n`;
            message += `  - External: ${Math.round(memUsage.external / 1024 / 1024)}MB\n`;
            message += `• CPU Usage:\n`;
            message += `  - User: ${Math.round(cpuUsage.user / 1000)}ms\n`;
            message += `  - System: ${Math.round(cpuUsage.system / 1000)}ms\n`;
            message += `• Process Info:\n`;
            message += `  - PID: ${process.pid}\n`;
            message += `  - Uptime: ${Math.floor(process.uptime())}s\n`;
            
            await this.sendMessage(remoteJid, message);
        } catch (error) {
            console.error('Error in handleDebugResource:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while debug resource:\n${error.message}`);
        }
    }

    // Command: check group
    async handleCheckGroup(remoteJid) {
        try {
            const { getSetting } = require('./settingsManager');
            const technicianGroupId = getSetting('technician_group_id', '');
            
            // Get technician data from database
            const sqlite3 = require('sqlite3').verbose();
            const path = require('path');
            
            const dbPath = path.join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            
            const technicians = await new Promise((resolve, reject) => {
                const query = `
                    SELECT name, phone, role, is_active 
                    FROM technicians 
                    ORDER BY role, name
                `;
                
                db.all(query, [], (err, rows) => {
                    db.close();
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            let message = `👥 *CHECK GROUP & NUMBER*\n\n`;
            message += `• Technician Group ID:\n`;
            message += `  ${technicianGroupId || 'Not configured'}\n\n`;
            message += `• Technician Database:\n`;
            
            if (technicians && technicians.length > 0) {
                technicians.forEach((tech, index) => {
                    const status = tech.is_active ? '✅' : '❌';
                    message += `  ${index + 1}. ${tech.name} (${tech.phone})\n`;
                    message += `     Role: ${tech.role} | Status: ${status}\n\n`;
                });
            } else {
                message += `  No technician data in database\n`;
            }
            
            await this.sendMessage(remoteJid, message);
        } catch (error) {
            console.error('Error in handleCheckGroup:', error);
            await this.sendMessage(remoteJid, `❌ *ERROR*\n\nAn error occurred while check group:\n${error.message}`);
        }
    }
}

module.exports = WhatsAppCommands;
