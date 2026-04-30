// pppoe-commands.js - WhatsApp commands for PPPoE notification management
const logger = require('./logger');
const pppoeNotifications = require('./pppoe-notifications');
const pppoeMonitor = require('./pppoe-monitor');

// Store the WhatsApp socket instance
let sock = null;

// Set the WhatsApp socket instance
function setSock(sockInstance) {
    sock = sockInstance;
    logger.info('WhatsApp socket set in pppoe-commands module');
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

// Helper function to send message with retry
async function sendMessageSafely(remoteJid, message, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const isConnected = await checkWhatsAppConnection();
            if (!isConnected) {
                logger.warn(`WhatsApp not connected, attempt ${i + 1}/${retries}`);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                    continue;
                } else {
                    throw new Error('WhatsApp connection not available after retries');
                }
            }

            await sock.sendMessage(remoteJid, message);
            return true;
        } catch (error) {
            logger.error(`Error sending message (attempt ${i + 1}/${retries}): ${error.message}`);
            if (i === retries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
    }
    return false;
}

// Handler to enable PPPoE notification
async function handleEnablePPPoENotifications(remoteJid) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        const success = pppoeNotifications.setNotificationStatus(true);

        if (success) {
            // Start monitoring if not already running
            await pppoeMonitor.startPPPoEMonitoring();

            const message = {
                text: `✅ *NOTIFIKASI PPPoE DIAKTIFKAN*\n\n` +
                      `Notifikasi login/logout PPPoE telah diaktifkan.\n` +
                      `Monitoring PPPoE dimulai.\n\n` +
                      `Gunakan "pppoe status" untuk melihat status lengkap.`
            };

            await sendMessageSafely(remoteJid, message);
            logger.info('PPPoE notifications enabled via WhatsApp command');
        } else {
            const message = {
                text: `❌ *FAILED TO ENABLE NOTIFICATION*\n\n` +
                      `Error saving settings.`
            };

            await sendMessageSafely(remoteJid, message);
        }
    } catch (error) {
        logger.error(`Error enabling PPPoE notifications: ${error.message}`);

        try {
            const message = {
                text: `❌ *ERROR*\n\nTerjadi kesalahan: ${error.message}\n\n` +
                      `Please try again or restart the bot if the problem persists.`
            };

            await sendMessageSafely(remoteJid, message);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

// Handler to disable PPPoE notification
async function handleDisablePPPoENotifications(remoteJid) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        const success = pppoeNotifications.setNotificationStatus(false);

        if (success) {
            const message = {
                text: `🔕 *NOTIFIKASI PPPoE DINONAKTIFKAN*\n\n` +
                      `Notifikasi login/logout PPPoE telah dinonaktifkan.\n` +
                      `Monitoring tetap berjalan tapi notifikasi tidak dikirim.\n\n` +
                      `Use "pppoe on" to enable again.`
            };

            await sendMessageSafely(remoteJid, message);
            logger.info('PPPoE notifications disabled via WhatsApp command');
        } else {
            const message = {
                text: `❌ *FAILED TO DISABLE NOTIFICATION*\n\n` +
                      `Error saving settings.`
            };

            await sendMessageSafely(remoteJid, message);
        }
    } catch (error) {
        logger.error(`Error disabling PPPoE notifications: ${error.message}`);

        try {
            const message = {
                text: `❌ *ERROR*\n\nTerjadi kesalahan: ${error.message}\n\n` +
                      `Please try again or restart the bot if the problem persists.`
            };

            await sendMessageSafely(remoteJid, message);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

// Handler untuk melihat status notifikasi PPPoE
async function handlePPPoEStatus(remoteJid) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        const status = pppoeMonitor.getMonitoringStatus();
        const settings = pppoeNotifications.getSettings();
        const adminNumbers = pppoeNotifications.getAdminNumbers();
        const technicianNumbers = pppoeNotifications.getTechnicianNumbers();

        let message = `📊 *STATUS NOTIFIKASI PPPoE*\n\n`;

        // Status monitoring
        message += `🔄 *Monitoring:* ${status.isRunning ? '🟢 Running' : '🔴 Stopped'}\n`;
        message += `🔔 *Notifications:* ${status.notificationsEnabled ? '🟢 Active' : '🔴 Inactive'}\n`;
        message += `📥 *Login Notif:* ${status.loginNotifications ? '🟢 Active' : '🔴 Inactive'}\n`;
        message += `📤 *Logout Notif:* ${status.logoutNotifications ? '🟢 Active' : '🔴 Inactive'}\n`;
        message += `⏱️ *Interval:* ${status.interval/1000} \etik`;
        message += `👥 *KAkiksi Ak:*fstatus.activeConnections}\n\n`;

        // Recipients
        message += `📱 *Penerima Penerikani`;
        if (adminNumbers.length > 0) {
            message += `• Admin (${adminNumbers.length}): ${adminNumbers.join(', ')}\n`;
        }
        if (technicianNumbers.length > 0) {
            message += `• Technician (${technicianNumbers.length}): ${technicianNumbers.join(', ')}\n`;
        }
        if (adminNumbers.length === 0 && technicianNumbers.length === 0) {
            message += `• No registered numbers\n`;
        }

        message += `\n💡 *Available Commands:*\n`;
        message += `• pppoe on - Enable notifications\n`;
        message += `• pppoe off - Disable notifications\n`;
        message += `• pppoe addadmin [number] - Add admin\n`;
        message += `• pppoe addtech [number] - Add technician\n`;
        message += `• pppoe interval [seconds] - Edit interval\n`;
        message += `• pppoe test - Test notifications`;

        await sendMessageSafely(remoteJid, { text: message });

    } catch (error) {
        logger.error(`Error getting PPPoE status: ${error.message}`);

        try {
            const errorMessage = {
                text: `❌ *ERROR*\n\nTerjadi kesalahan: ${error.message}\n\n` +
                      `Please try again or restart the bot if the problem persists.`
            };

            await sendMessageSafely(remoteJid, errorMessage);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

// Helper function untuk validasi nomor WhatsApp
async function validateWhatsAppNumber(number) {
    try {
        // Format nomor
        let cleanNumber = number.replace(/[^0-9]/g, '');
        if (cleanNumber.startsWith('0')) {
            cleanNumber = '62' + cleanNumber.substring(1);
        } else if (!cleanNumber.startsWith('62')) {
            cleanNumber = '62' + cleanNumber;
        }

        // Check if number exists on WhatsApp
        const [result] = await sock.onWhatsApp(cleanNumber);
        return result && result.exists;
    } catch (error) {
        logger.warn(`Error validating WhatsApp number ${number}: ${error.message}`);
        return true; // Assume valid if validation fails
    }
}

// Handler untuk menambah nomor admin
async function handleAddAdminNumber(remoteJid, phoneNumber) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        // Format nomor telepon
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (formattedNumber.length < 10 || formattedNumber.length > 15) {
            const message = {
                text: `❌ *INVALID NUMBER FORMAT*\n\n` +
                      `Correct format:\n` +
                      `pppoe addadmin 081234567890\n\n` +
                      `Number must be 10-15 digits.`
            };
            await sendMessageSafely(remoteJid, message);
            return;
        }

        // Validate WhatsApp number
        const isValid = await validateWhatsAppNumber(formattedNumber);
        if (!isValid) {
            const message = {
                text: `❌ *NOMOR TIDAK VALID*\n\n` +
                      `Nomor ${formattedNumber} tidak terdaftar di WhatsApp.\n` +
                      `Pastikan nomor aktif dan terdaftar WhatsApp.`
            };
            await sendMessageSafely(remoteJid, message);
            return;
        }

        const success = pppoeNotifications.addAdminNumber(formattedNumber);

        if (success) {
            const message = {
                text: `✅ *ADMIN ADDED*\n\n` +
                      `Number ${formattedNumber} added successfully as admin.\n` +
                      `This number will receive PPPoE notifications.\n\n` +
                      `Use "pppoe test" to test notifications.`
            };
            await sendMessageSafely(remoteJid, message);
            logger.info(`Admin number added: ${formattedNumber}`);
        } else {
            const message = {
                text: `❌ *FAILED TO ADD ADMIN*\n\n` +
                      `Error saving settings.`
            };
            await sendMessageSafely(remoteJid, message);
        }
    } catch (error) {
        logger.error(`Error adding admin number: ${error.message}`);

        try {
            const message = {
                text: `❌ *ERROR*\n\nTerjadi kesalahan: ${error.message}\n\n` +
                      `Please try again or restart the bot if the problem persists.`
            };
            await sendMessageSafely(remoteJid, message);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

// Handler untuk menambah nomor teknisi
async function handleAddTechnicianNumber(remoteJid, phoneNumber) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        // Format nomor telepon
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (formattedNumber.length < 10) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *INVALID NUMBER FORMAT*\n\n` +
                      `Correct format:\n` +
                      `pppoe addtech 081234567890`
            });
            return;
        }
        
        const success = pppoeNotifications.addTechnicianNumber(formattedNumber);
        
        if (success) {
            await sock.sendMessage(remoteJid, {
                text: `✅ *TECHNICIAN ADDED*\n\n` +
                      `Number ${formattedNumber} added successfully as technician.\n` +
                      `This number will receive PPPoE notifications.`
            });
            
            logger.info(`Technician number added: ${formattedNumber}`);
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *FAILED TO ADD TECHNICIAN*\n\n` +
                      `Error saving settings.`
            });
        }
    } catch (error) {
        logger.error(`Error adding technician number: ${error.message}`);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred: ${error.message}`
        });
    }
}

// Handler to change monitoring interval
async function handleSetInterval(remoteJid, seconds) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        const intervalSeconds = parseInt(seconds);
        if (isNaN(intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 3600) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *INTERVAL TIDAK VALID*\n\n` +
                      `Interval harus antara 30-3600 detik.\n\n` +
                      `Example: pppoe interval 60`
            });
            return;
        }
        
        const intervalMs = intervalSeconds * 1000;
        const result = await pppoeMonitor.setMonitoringInterval(intervalMs);
        
        if (result.success) {
            await sock.sendMessage(remoteJid, {
                text: `✅ *INTERVAL DIUBAH*\n\n` +
                      `Interval monitoring PPPoE diubah menjadi ${intervalSeconds} detik.\n` +
                      `Monitoring akan restart dengan interval baru.`
            });
            
            logger.info(`PPPoE monitoring interval changed to ${intervalSeconds} seconds`);
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *FAILED TO CHANGE INTERVAL*\n\n${result.message}`
            });
        }
    } catch (error) {
        logger.error(`Error setting interval: ${error.message}`);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred: ${error.message}`
        });
    }
}

// Handler untuk test notifikasi
async function handleTestNotification(remoteJid) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        const testMessage = `🧪 *PPPoE TEST NOTIFICATION*\n\n` +
                           `This is a PPPoE test notification.\n` +
                           `If you receive this message, notification is working properly.\n\n` +
                           `⏰ ${new Date().toLocaleString()}`;
        
        const success = await pppoeNotifications.sendNotification(testMessage);
        
        if (success) {
            await sock.sendMessage(remoteJid, {
                text: `✅ *TEST NOTIFICATION SUCCESSFUL*\n\n` +
                      `Test notification has been sent to all registered numbers.`
            });
        } else {
            await sock.sendMessage(remoteJid, {
                text: `❌ *TEST NOTIFIKASI GAGAL*\n\n` +
                      `Tidak ada nomor terdaftar atau terjadi kesalahan.`
            });
        }
    } catch (error) {
        logger.error(`Error sending test notification: ${error.message}`);
        await sock.sendMessage(remoteJid, {
            text: `❌ *ERROR*\n\nAn error occurred: ${error.message}`
        });
    }
}

// Handler to delete admin number
async function handleRemoveAdminNumber(remoteJid, phoneNumber) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        // Format nomor telepon
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (formattedNumber.length < 10) {
            const message = {
                text: `❌ *FORMAT NOMOR SALAH*\n\n` +
                      `Format yang benar:\n` +
                      `pppoe removeadmin 081234567890`
            };
            await sendMessageSafely(remoteJid, message);
            return;
        }

        const success = pppoeNotifications.removeAdminNumber(formattedNumber);

        if (success) {
            const message = {
                text: `✅ *ADMIN REMOVED*\n\n` +
                      `Number ${formattedNumber} deleted successfully from admin list.\n` +
                      `This number will no longer receive PPPoE notifications.`
            };
            await sendMessageSafely(remoteJid, message);
            logger.info(`Admin number removed: ${formattedNumber}`);
        } else {
            const message = {
                text: `❌ *FAILED TO DELETE ADMIN*\n\n` +
                      `Error saving settings.`
            };
            await sendMessageSafely(remoteJid, message);
        }
    } catch (error) {
        logger.error(`Error removing admin number: ${error.message}`);

        try {
            const message = {
                text: `❌ *ERROR*\n\nAn error occurred: ${error.message}`
            };
            await sendMessageSafely(remoteJid, message);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

// Handler to delete technician number
async function handleRemoveTechnicianNumber(remoteJid, phoneNumber) {
    if (!sock) {
        logger.error('Sock instance not set');
        return;
    }

    try {
        // Format nomor telepon
        const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (formattedNumber.length < 10) {
            const message = {
                text: `❌ *FORMAT NOMOR SALAH*\n\n` +
                      `Format yang benar:\n` +
                      `pppoe removetech 081234567890`
            };
            await sendMessageSafely(remoteJid, message);
            return;
        }

        const success = pppoeNotifications.removeTechnicianNumber(formattedNumber);

        if (success) {
            const message = {
                text: `✅ *TEKNISI DIHAPUS*\n\n` +
                      `Number ${formattedNumber} deleted successfully from technician list.\n` +
                      `This number will no longer receive PPPoE notifications.`
            };
            await sendMessageSafely(remoteJid, message);
            logger.info(`Technician number removed: ${formattedNumber}`);
        } else {
            const message = {
                text: `❌ *FAILED TO DELETE TECHNICIAN*\n\n` +
                      `Error saving settings.`
            };
            await sendMessageSafely(remoteJid, message);
        }
    } catch (error) {
        logger.error(`Error removing technician number: ${error.message}`);

        try {
            const message = {
                text: `❌ *ERROR*\n\nAn error occurred: ${error.message}`
            };
            await sendMessageSafely(remoteJid, message);
        } catch (sendError) {
            logger.error(`Failed to send error message: ${sendError.message}`);
        }
    }
}

module.exports = {
    setSock,
    handleEnablePPPoENotifications,
    handleDisablePPPoENotifications,
    handlePPPoEStatus,
    handleAddAdminNumber,
    handleAddTechnicianNumber,
    handleRemoveAdminNumber,
    handleRemoveTechnicianNumber,
    handleSetInterval,
    handleTestNotification
};
