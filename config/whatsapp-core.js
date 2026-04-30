const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { getSettingsWithCache } = require('./settingsManager');

class WhatsAppCore {
    constructor() {
        this.sock = null;
        this.genieacsCommandsEnabled = true;
        this.superAdminNumber = this.getSuperAdminNumber();
        this.whatsappStatus = {
            connected: false,
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
            status: 'disconnected'
        };
    }

    // Function to decrypt encrypted admin number
    decryptAdminNumber(encryptedNumber) {
        try {
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

    // Read super admin number from external file
    getSuperAdminNumber() {
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

    // Function to check if number is admin or super admin
    isAdminNumber(number) {
        try {
            // Normalize number
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            // Read all settings to find keys starting with 'admins.'
            const allSettings = getSettingsWithCache();
            const adminNumbers = [];
            
            // Search all keys starting with 'admins.'
            Object.keys(allSettings).forEach(key => {
                if (key.startsWith('admins.') && allSettings[key]) {
                    adminNumbers.push(allSettings[key]);
                }
            });
            
            // Cek apakah nomor ada dalam daftar admin
            return adminNumbers.includes(cleanNumber);
        } catch (error) {
            console.error('Error checking admin number:', error);
            return false;
        }
    }

    // Function to check if number is technician
    async isTechnicianNumber(number) {
        try {
            // Normalize number
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            // Check in technicians database
            const sqlite3 = require('sqlite3').verbose();
            const path = require('path');
            
            const dbPath = path.join(__dirname, '../data/billing.db');
            const db = new sqlite3.Database(dbPath);
            
            return new Promise((resolve, reject) => {
                const query = `
                    SELECT COUNT(*) as count 
                    FROM technicians 
                    WHERE phone = ? AND is_active = 1
                `;
                
                db.get(query, [cleanNumber], (err, row) => {
                    db.close();
                    if (err) {
                        console.error('Error checking technician number in database:', err);
                        resolve(false);
                    } else {
                        resolve(row && row.count > 0);
                    }
                });
            });
        } catch (error) {
            console.error('Error checking technician number:', error);
            return false;
        }
    }

    // Fungsi untuk mengecek apakah nomor bisa akses fitur teknisi (admin atau teknisi)
    async canAccessTechnicianFeatures(number) {
        const isAdmin = this.isAdminNumber(number);
        const isTechnician = await this.isTechnicianNumber(number);
        return isAdmin || isTechnician;
    }

    // Fungsi untuk mengecek apakah nomor adalah super admin
    isSuperAdminNumber(number) {
        if (!this.superAdminNumber) return false;
        
        try {
            let cleanNumber = number.replace(/\D/g, '');
            if (cleanNumber.startsWith('0')) cleanNumber = '62' + cleanNumber.slice(1);
            if (!cleanNumber.startsWith('62')) cleanNumber = '62' + cleanNumber;
            
            return cleanNumber === this.superAdminNumber;
        } catch (error) {
            console.error('Error checking super admin number:', error);
            return false;
        }
    }

    // Set socket instance
    setSock(sock) {
        this.sock = sock;
        this.whatsappStatus.connected = true;
        this.whatsappStatus.status = 'connected';
        this.whatsappStatus.connectedSince = new Date();
        
        // Update global status
        global.whatsappStatus = this.whatsappStatus;
    }

    // Get socket instance
    getSock() {
        return this.sock;
    }

    // Get WhatsApp status
    getWhatsAppStatus() {
        return this.whatsappStatus;
    }

    // Update WhatsApp status
    updateStatus(status) {
        this.whatsappStatus = { ...this.whatsappStatus, ...status };
        global.whatsappStatus = this.whatsappStatus;
    }

    // Get GenieACS configuration
    getGenieacsConfig() {
        return {
            genieacsUrl: getSetting('genieacs_url'),
            genieacsUsername: getSetting('genieacs_username'),
            genieacsPassword: getSetting('genieacs_password')
        };
    }

    // Format phone number for WhatsApp
    formatPhoneNumber(phoneNumber) {
        if (!phoneNumber) return null;
        
        let cleanNumber = phoneNumber.replace(/\D/g, '');
        if (cleanNumber.startsWith('0')) {
            cleanNumber = '62' + cleanNumber.slice(1);
        }
        if (!cleanNumber.startsWith('62')) {
            cleanNumber = '62' + cleanNumber;
        }
        
        return cleanNumber;
    }

    // Create WhatsApp JID
    createJID(phoneNumber) {
        const formattedNumber = this.formatPhoneNumber(phoneNumber);
        return formattedNumber ? `${formattedNumber}@s.whatsapp.net` : null;
    }

    // Send formatted message
    async sendFormattedMessage(remoteJid, text) {
        if (!this.sock) {
            console.error('Sock instance not set');
            return false;
        }

        try {
            await this.sock.sendMessage(remoteJid, { text });
            return true;
        } catch (error) {
            console.error('Error sending formatted message:', error);
            return false;
        }
    }

    // Check if WhatsApp is connected
    isConnected() {
        return this.sock && this.whatsappStatus.connected;
    }

    // Get super admin number
    getSuperAdmin() {
        return this.superAdminNumber;
    }

    // Enable/disable GenieACS commands
    setGenieacsCommandsEnabled(enabled) {
        this.genieacsCommandsEnabled = enabled;
    }

    // Check if GenieACS commands are enabled
    areGenieacsCommandsEnabled() {
        return this.genieacsCommandsEnabled;
    }
}

module.exports = WhatsAppCore;
