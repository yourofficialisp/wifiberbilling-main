/**
 * Auto setup GenieACS DNS for development
 * Automatically run when application first starts
 */

const { runAutoSetup } = require('../scripts/auto-genieacs-dns-dev');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class AutoGenieACSSetup {
    constructor() {
        this.isDevelopment = process.env.NODE_ENV === 'development' || 
                           process.env.NODE_ENV === 'dev' || 
                           !process.env.NODE_ENV;
        this.autoSetupEnabled = getSetting('auto_genieacs_dns_setup', true);
        this.setupCompleted = false;
    }

    // Function to run auto setup
    async runAutoSetup() {
        try {
            // Check if auto setup has been run
            if (this.setupCompleted) {
                logger.info('Auto GenieACS DNS setup has been run before');
                return { success: true, message: 'Setup has been run' };
            }

            // Cek apakah auto setup diaktifkan
            if (!this.autoSetupEnabled) {
                logger.info('Auto GenieACS DNS setup is disabled');
                return { success: true, message: 'Auto setup is disabled' };
            }

            // Check if this is development environment
            if (!this.isDevelopment) {
                logger.info('Auto GenieACS DNS setup only for development environment');
                return { success: true, message: 'Only for development' };
            }

            logger.info('🚀 Starting auto setup GenieACS DNS for development...');
            
            // Run auto setup
            const result = await runAutoSetup();
            
            if (result.success) {
                this.setupCompleted = true;
                logger.info('✅ Auto GenieACS DNS setup successful');
                logger.info(`📋 IP Server: ${result.serverIP}`);
                logger.info(`📋 GenieACS URL: ${result.genieacsUrl}`);
                logger.info(`📋 Script Mikrotik: ${result.mikrotikScript}`);
                
                return {
                    success: true,
                    message: 'Auto setup successful',
                    data: result
                };
            } else {
                logger.error('❌ Auto GenieACS DNS setup failed:', result.error);
                return {
                    success: false,
                    message: 'Auto setup failed',
                    error: result.error
                };
            }

        } catch (error) {
            logger.error('❌ Error in auto GenieACS DNS setup:', error);
            return {
                success: false,
                message: 'Error in auto setup',
                error: error.message
            };
        }
    }

    // Function to run auto setup with delay
    async runAutoSetupWithDelay(delayMs = 10000) {
        try {
            logger.info(`⏳ Auto GenieACS DNS setup will run in ${delayMs/1000} seconds...`);
            
            // Delay to ensure application is fully loaded
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            return await this.runAutoSetup();
            
        } catch (error) {
            logger.error('❌ Error in auto setup with delay:', error);
            return {
                success: false,
                message: 'Error in auto setup with delay',
                error: error.message
            };
        }
    }

    // Function to check setup status
    getSetupStatus() {
        return {
            isDevelopment: this.isDevelopment,
            autoSetupEnabled: this.autoSetupEnabled,
            setupCompleted: this.setupCompleted
        };
    }

    // Function to enable/disable auto setup
    setAutoSetupEnabled(enabled) {
        this.autoSetupEnabled = enabled;
        logger.info(`Auto GenieACS DNS setup ${enabled ? 'enabled' : 'disabled'}`);
    }
}

// Global instance
const autoGenieACSSetup = new AutoGenieACSSetup();

// Export instance and class
module.exports = {
    AutoGenieACSSetup,
    autoGenieACSSetup,
    
    // Helper functions
    runAutoSetup: () => autoGenieACSSetup.runAutoSetup(),
    runAutoSetupWithDelay: (delayMs) => autoGenieACSSetup.runAutoSetupWithDelay(delayMs),
    getSetupStatus: () => autoGenieACSSetup.getSetupStatus(),
    setAutoSetupEnabled: (enabled) => autoGenieACSSetup.setAutoSetupEnabled(enabled)
};
