const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// Import modules that have been created
const WhatsAppCore = require('./whatsapp-core');
const WhatsAppCommands = require('./whatsapp-commands');
const WhatsAppMessageHandlers = require('./whatsapp-message-handlers');

// Initialize modules
const whatsappCore = new WhatsAppCore();
const whatsappCommands = new WhatsAppCommands(whatsappCore);
const messageHandlers = new WhatsAppMessageHandlers(whatsappCore, whatsappCommands);

// Global variable for WhatsApp status
global.whatsappStatus = whatsappCore.getWhatsAppStatus();

// Mock function for testing
async function connectToWhatsApp() {
    console.log('Mock: Starting WhatsApp connection...');
    return { success: true, message: 'Mock connection successful' };
}

// Function to get WhatsApp status
function getWhatsAppStatus() {
    return whatsappCore.getWhatsAppStatus();
}

// Function to delete WhatsApp session
async function deleteWhatsAppSession() {
    try {
        const sessionDir = './whatsapp-session';
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
