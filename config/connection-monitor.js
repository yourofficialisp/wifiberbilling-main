// Connection monitoring module for WhatsApp and Mikrotik
const logger = require('./logger');
const whatsapp = require('./whatsapp');
const mikrotik = require('./mikrotik');

let whatsappMonitorInterval = null;
let mikrotikMonitorInterval = null;
let isRestarting = false;

// Function for monitoring WhatsApp connection
function startWhatsAppMonitoring() {
    if (whatsappMonitorInterval) {
        clearInterval(whatsappMonitorInterval);
    }

    whatsappMonitorInterval = setInterval(async () => {
        try {
            const status = whatsapp.getWhatsAppStatus();
            
            if (!status.connected && !isRestarting) {
                logger.warn('WhatsApp connection lost, attempting to reconnect...');
                isRestarting = true;
                
                // Try to reconnect WhatsApp
                await whatsapp.connectToWhatsApp();
                
                setTimeout(() => {
                    isRestarting = false;
                }, 10000);
            }
        } catch (error) {
            logger.error('Error in WhatsApp monitoring:', error);
        }
    }, 30000); // Check every 30 seconds

    logger.info('WhatsApp connection monitoring started');
}

// Function for monitoring Mikrotik connection
function startMikrotikMonitoring() {
    if (mikrotikMonitorInterval) {
        clearInterval(mikrotikMonitorInterval);
    }

    mikrotikMonitorInterval = setInterval(async () => {
        try {
            // Test Mikrotik connection with simple command
            const connection = await mikrotik.getMikrotikConnection();
            if (!connection) {
                logger.warn('Mikrotik connection lost, attempting to reconnect...');
                
                // Try to reconnect Mikrotik
                await mikrotik.connectToMikrotik();
            }
        } catch (error) {
            logger.error('Error in Mikrotik monitoring:', error);
        }
    }, 60000); // Check every 60 seconds

    logger.info('Mikrotik connection monitoring started');
}

// Function to stop monitoring
function stopMonitoring() {
    if (whatsappMonitorInterval) {
        clearInterval(whatsappMonitorInterval);
        whatsappMonitorInterval = null;
    }
    
    if (mikrotikMonitorInterval) {
        clearInterval(mikrotikMonitorInterval);
        mikrotikMonitorInterval = null;
    }
    
    logger.info('Connection monitoring stopped');
}

// Function to get monitoring status
function getMonitoringStatus() {
    return {
        whatsappMonitoring: !!whatsappMonitorInterval,
        mikrotikMonitoring: !!mikrotikMonitorInterval,
        isRestarting: isRestarting
    };
}

// Fungsi untuk restart monitoring
function restartMonitoring() {
    stopMonitoring();
    startWhatsAppMonitoring();
    startMikrotikMonitoring();
}

module.exports = {
    startWhatsAppMonitoring,
    startMikrotikMonitoring,
    stopMonitoring,
    getMonitoringStatus,
    restartMonitoring
}; 
