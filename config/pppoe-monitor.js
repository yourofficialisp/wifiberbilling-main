// pppoe-monitor.js - Enhanced PPPoE monitoring with notification control
const logger = require('./logger');
const pppoeNotifications = require('./pppoe-notifications');
const { getActivePPPoEConnections, listMikrotikRouters } = require('./mikrotik');

let monitorInterval = null;
let lastActivePPPoE = [];
let isMonitoring = false;
let previousPPPoEData = [];

// Add configuration for PPPoE checking
const PPPoE_CONFIG = {
    checkInterval: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 5000 // 5 seconds
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

// Function to get current PPPoE data from Mikrotik
async function getCurrentPPPoEData() {
    try {
        console.log('[PPPoE-MONITOR] Getting latest PPPoE data from Mikrotik...');

        const routerInfo = typeof listMikrotikRouters === 'function' ? listMikrotikRouters() : { routers: [], defaultRouterId: null };
        const routers = Array.isArray(routerInfo.routers) ? routerInfo.routers : [];

        if (routers.length === 0) {
            const result = await withTimeout(getActivePPPoEConnections(), 10000, 'Timeout when getting PPPoE data from Mikrotik');

            if (result && result.success && Array.isArray(result.data)) {
                console.log(`[PPPoE-MONITOR] Found ${result.data.length} active PPPoE connections`);
                return result.data;
            }
            console.warn('[PPPoE-MONITOR] Failed to get active PPPoE data from Mikrotik');
            return [];
        }

        const perRouter = await Promise.all(routers.map(async (r) => {
            if (!r || r.enabled === false) return [];
            const routerId = r.id;

            const result = await withTimeout(
                getActivePPPoEConnections({ routerId }),
                10000,
                `Timeout when getting PPPoE data from Mikrotik (routerId=${routerId})`
            );

            if (result && result.success && Array.isArray(result.data)) {
                return result.data.map(conn => ({ ...conn, routerId, routerName: r.name || routerId }));
            }

            return [];
        }));

        const merged = perRouter.flat();
        console.log(`[PPPoE-MONITOR] Found ${merged.length} active PPPoE connections (multi-router)`);
        return merged;
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error saat mengambil data PPPoE dari Mikrotik:', error.message);
        return [];
    }
}

function getConnectionKey(conn) {
    if (!conn || !conn.name) return null;
    if (conn.routerId) return `${conn.routerId}::${conn.name}`;
    return conn.name;
}

// Fungsi untuk membandingkan data PPPoE
async function comparePPPoEData(previousData, currentData) {
    try {
        console.log('[PPPoE-MONITOR] Membandingkan data PPPoE...');
        
        // Jika tidak ada data sebelumnya, semua data saat ini adalah "baru"
        if (!previousData || previousData.length === 0) {
            console.log('[PPPoE-MONITOR] No previous data, all connections considered new');
            return currentData.map(conn => ({
                type: 'new',
                connection: conn
            }));
        }
        
        // Buat map dari data sebelumnya untuk pencarian cepat
        const previousMap = new Map();
        previousData.forEach(conn => {
            const key = getConnectionKey(conn);
            if (key) previousMap.set(key, conn);
        });
        
        // Buat map dari data saat ini
        const currentMap = new Map();
        currentData.forEach(conn => {
            const key = getConnectionKey(conn);
            if (key) currentMap.set(key, conn);
        });
        
        const changes = [];
        
        // Search koneksi baru (ada di current tapi tidak di previous)
        currentData.forEach(conn => {
            const key = getConnectionKey(conn);
            if (key && !previousMap.has(key)) {
                changes.push({
                    type: 'login',
                    connection: conn
                });
            }
        });
        
        // Search koneksi yang logout (ada di previous tapi tidak di current)
        previousData.forEach(conn => {
            const key = getConnectionKey(conn);
            if (key && !currentMap.has(key)) {
                changes.push({
                    type: 'logout',
                    connection: conn
                });
            }
        });
        
        console.log(`[PPPoE-MONITOR] Ditemukan ${changes.length} perubahan PPPoE`);
        return changes;
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error saat membandingkan data PPPoE:', error.message);
        return [];
    }
}

// Function to process PPPoE changes
async function processPPPoEChange(change) {
    try {
        console.log('[PPPoE-MONITOR] Processing PPPoE change:', JSON.stringify(change, null, 2));
        
        // Dapatkan pengaturan notifikasi
        const settings = pppoeNotifications.getSettings();
        
        // Proses berdasarkan tipe perubahan
        switch (change.type) {
            case 'login':
                if (settings.loginNotifications) {
                    console.log('[PPPoE-MONITOR] Sending notifikasi login untuk:', change.connection.name);
                    await pppoeNotifications.sendLoginNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Notifikasi login dinonaktifkan untuk:', change.connection.name);
                }
                break;
                
            case 'logout':
                if (settings.logoutNotifications) {
                    console.log('[PPPoE-MONITOR] Sending notifikasi logout untuk:', change.connection.name);
                    await pppoeNotifications.sendLogoutNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Notifikasi logout dinonaktifkan untuk:', change.connection.name);
                }
                break;
                
            case 'new':
                if (settings.loginNotifications) {
                    console.log('[PPPoE-MONITOR] Sending new connection notification for:', change.connection.name);
                    await pppoeNotifications.sendLoginNotification(change.connection);
                } else {
                    console.log('[PPPoE-MONITOR] Ni kbakusd kineksiobaru nanontkti kan untuktuk:', change.connection.name);
                }
                break;
                
            default:
                console.warn('[PPPoE-MONITOR] Unknown change type:', change.type);
        }
        
        return true;
    } catch (error) {
        console.error('[PPPoE-MONITOR] Error processing PPPoE change:', error.message);
        return false;
    }
}

// Fix checkPPPoEChanges function with better error handling
async function checkPPPoEChanges() {
    try {
        console.log('[PPPoE-MONITOR] Checking PPPoE changes...');
        
        // Check WhatsApp connection with better error handling
        if (!global.whatsappStatus || !global.whatsappStatus.connected) {
            console.warn('[PPPoE-MONITOR] WhatsApp not connected, skipping notification');
            return;
        }

        // Get latest PPPoE customer data from Mikrotik
        let currentPPPoEData;
        try {
            console.log('[PPPoE-MONITOR] Getting latest PPPoE data from Mikrotik...');
            currentPPPoEData = await withTimeout(getCurrentPPPoEData(), 10000, 'Timeout when getting PPPoE data');
        } catch (getDataError) {
            console.error('[PPPoE-MONITOR] Error when getting PPPoE data:', getDataError.message);
            return;
        }
        
        if (!currentPPPoEData) {
            console.warn('[PPPoE-MONITOR] Failed to get PPPoE data');
            return;
        }

        // Compare with previous data
        let changes;
        try {
            console.log('[PPPoE-MONITOR] Comparing PPPoE data...');
            changes = await withTimeout(comparePPPoEData(previousPPPoEData, currentPPPoEData), 5000, 'Timeout when comparing PPPoE data');
        } catch (compareError) {
            console.error('[PPPoE-MONITOR] Error when comparing PPPoE data:', compareError.message);
            return;
        }
        
        // Process changes with error handling per item
        if (changes && changes.length > 0) {
            console.log(`[PPPoE-MONITOR] Found ${changes.length} PPPoE changes`);
            
            // Send notification for each change with individual error handling
            for (const change of changes) {
                try {
                    console.log('[PPPoE-MONITOR] Processing change:', JSON.stringify(change, null, 2));
                    await withTimeout(processPPPoEChange(change), 15000, 'Timeout processing PPPoE change');
                } catch (processError) {
                    console.error('[PPPoE-MONITOR] Error processing change:', processError.message);
                    // Continue to next change even if there is error
                    continue;
                }
            }
        } else {
            console.log('[PPPoE-MONITOR] No changes PPPoE');
        }

        // Update previous data
        previousPPPoEData = currentPPPoEData;
        console.log('[PPPoE-MONITOR] Check completed');
        
    } catch (error) {
        console.error('[PPPoE-MONITOR] Unexpected error checking PPPoE changes:', error.message);
        // Jangan biarkan error menghentikan monitor
        // Proses akan dilanjutkan pada interval berikutnya
    }
}

// Fix timeout function with better error handling
function scheduleNextCheck() {
    console.log(`[PPPoE-MONITOR] Scheduling next check in ${PPPoE_CONFIG.checkInterval/1000} seconds`);
    
    setTimeout(async function _onTimeout() {
        try {
            await checkPPPoEChanges();
        } catch (error) {
            console.error('[PPPoE-MONITOR] Error in timeout function:', error.message);
        } finally {
            // Ensure next scheduling always runs
            scheduleNextCheck();
        }
    }, PPPoE_CONFIG.checkInterval);
}

// Mulai penjadwalan pemeriksaan
console.log('[PPPoE-MONITOR] Starting PPPoE monitor...');
scheduleNextCheck();

// Start PPPoE monitoring
async function startPPPoEMonitoring() {
    try {
        if (isMonitoring) {
            logger.info('PPPoE monitoring is already running');
            return { success: true, message: 'Monitoring is already running' };
        }

        const settings = pppoeNotifications.getSettings();
        const interval = settings.monitorInterval || 60000; // Default 1 minute

        // Clear any existing interval
        if (monitorInterval) {
            clearInterval(monitorInterval);
        }

        // Start monitoring
        monitorInterval = setInterval(async () => {
            await checkPPPoEChanges();
        }, interval);

        isMonitoring = true;
        logger.info(`PPPoE monitoring started with interval ${interval}ms`);
        
        return { 
            success: true, 
            message: `PPPoE monitoring started with interval ${interval/1000} seconds` 
        };
    } catch (error) {
        logger.error(`Error starting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Failed to start monitoring: ${error.message}` 
        };
    }
}

// Stop PPPoE monitoring
function stopPPPoEMonitoring() {
    try {
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
        
        isMonitoring = false;
        logger.info('PPPoE monitoring stopped');
        
        return { 
            success: true, 
            message: 'PPPoE monitoring dihentikan' 
        };
    } catch (error) {
        logger.error(`Error stopping PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Failed menghentikan monitoring: ${error.message}` 
        };
    }
}

// Restart PPPoE monitoring
async function restartPPPoEMonitoring() {
    try {
        stopPPPoEMonitoring();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return await startPPPoEMonitoring();
    } catch (error) {
        logger.error(`Error restarting PPPoE monitoring: ${error.message}`);
        return { 
            success: false, 
            message: `Failed restart monitoring: ${error.message}` 
        };
    }
}

// Get monitoring status
function getMonitoringStatus() {
    const settings = pppoeNotifications.getSettings();
    const adminNumbers = pppoeNotifications.getAdminNumbers();
    const technicianNumbers = pppoeNotifications.getTechnicianNumbers();
    
    return {
        isRunning: isMonitoring,
        notificationsEnabled: settings.enabled,
        loginNotifications: settings.loginNotifications,
        logoutNotifications: settings.logoutNotifications,
        interval: settings.monitorInterval,
        adminNumbers: adminNumbers,
        technicianNumbers: technicianNumbers,
        activeConnections: lastActivePPPoE.length
    };
}

// Set monitoring interval
async function setMonitoringInterval(intervalMs) {
    try {
        const settings = pppoeNotifications.getSettings();
        settings.monitorInterval = intervalMs;
        
        if (pppoeNotifications.saveSettings(settings)) {
            // Restart monitoring with new interval if it's running
            if (isMonitoring) {
                await restartPPPoEMonitoring();
            }
            
            logger.info(`PPPoE monitoring interval updated to ${intervalMs}ms`);
            return { 
                success: true, 
                message: `Interval monitoring diubah menjadi ${intervalMs/1000} detik` 
            };
        } else {
            return { 
                success: false, 
                message: 'Failed to save interval settings' 
            };
        }
    } catch (error) {
        logger.error(`Error setting monitoring interval: ${error.message}`);
        return { 
            success: false, 
            message: `Failed to change interval: ${error.message}` 
        };
    }
}

// Initialize monitoring on startup
async function initializePPPoEMonitoring() {
    try {
        const settings = pppoeNotifications.getSettings();
        
        // Auto-start monitoring if enabled
        if (settings.enabled) {
            await startPPPoEMonitoring();
            logger.info('PPPoE monitoring auto-started on initialization');
        } else {
            logger.info('PPPoE monitoring disabled in settings');
        }
    } catch (error) {
        logger.error(`Error initializing PPPoE monitoring: ${error.message}`);
    }
}

// Set WhatsApp socket
function setSock(sockInstance) {
    pppoeNotifications.setSock(sockInstance);
}

module.exports = {
    setSock,
    startPPPoEMonitoring,
    stopPPPoEMonitoring,
    restartPPPoEMonitoring,
    getMonitoringStatus,
    setMonitoringInterval,
    initializePPPoEMonitoring,
    checkPPPoEChanges
};
