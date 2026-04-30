const { getSetting } = require('./settingsManager');
const troubleReport = require('./troubleReport');
const logger = require('./logger');

class WhatsAppTroubleCommands {
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

    // Command: View trouble reports list
    async handleListTroubleReports(remoteJid) {
        try {
            const reports = troubleReport.getAllTroubleReports();
            
            if (reports.length === 0) {
                await this.sendMessage(remoteJid, 
                    `📋 *TROUBLE REPORTS LIST*\n\nNo trouble reports at the moment.`
                );
                return;
            }

            // Filter active reports (not closed)
            const activeReports = reports.filter(r => r.status !== 'closed');
            
            if (activeReports.length === 0) {
                await this.sendMessage(remoteJid, 
                    `📋 *TROUBLE REPORTS LIST*\n\nAll trouble reports have been closed.`
                );
                return;
            }

            let message = `📋 *ACTIVE TROUBLE REPORTS LIST*\n\n`;
            
            activeReports.forEach((report, index) => {
                const statusEmoji = {
                    'open': '🔴',
                    'in_progress': '🟡', 
                    'resolved': '🟢',
                    'closed': '⚫'
                };
                
                const statusText = {
                    'open': 'Open',
                    'in_progress': 'In Progress',
                    'resolved': 'Resolved',
                    'closed': 'Closed'
                };

                message += `${index + 1}. *ID: ${report.id}*\n`;
                message += `   ${statusEmoji[report.status]} Status: ${statusText[report.status]}\n`;
                message += `   📱 Customer: ${report.phone || 'N/A'}\n`;
                message += `   🔧 Category: ${report.category || 'N/A'}\n`;
                message += `   🕒 Time: ${new Date(report.createdAt).toLocaleString('en-PK')}\n\n`;
            });

            message += `💡 *Use the following commands:*\n`;
            message += `• *status [id]* - View report details\n`;
            message += `• *update [id] [status] [notes]* - Update status\n`;
            message += `• *complete [id] [notes]* - Complete the report\n`;
            message += `• *notes [id] [notes]* - Add notes`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleListTroubleReports:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while retrieving report list:\n${error.message}`
            );
        }
    }

    // Command: View trouble report details
    async handleTroubleReportStatus(remoteJid, reportId) {
        try {
            if (!reportId) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\nstatus [report_id]\n\nExample:\nstatus TR001`
                );
                return;
            }

            const report = troubleReport.getTroubleReportById(reportId);
            
            if (!report) {
                await this.sendMessage(remoteJid, 
                    `❌ *REPORT NOT FOUND*\n\nReport with ID "${reportId}" not found.`
                );
                return;
            }

            const statusEmoji = {
                'open': '🔴',
                'in_progress': '🟡', 
                'resolved': '🟢',
                'closed': '⚫'
            };
            
            const statusText = {
                'open': 'Open',
                'in_progress': 'In Progress',
                'resolved': 'Resolved',
                'closed': 'Closed'
            };

            let message = `📋 *TROUBLE REPORT DETAILS*\n\n`;
            message += `🆔 *Ticket ID*: ${report.id}\n`;
            message += `📱 *Phone*: ${report.phone || 'N/A'}\n`;
            message += `👤 *Name*: ${report.name || 'N/A'}\n`;
            message += `📍 *Location*: ${report.location || 'N/A'}\n`;
            message += `🔧 *Category*: ${report.category || 'N/A'}\n`;
            message += `${statusEmoji[report.status]} *Status*: ${statusText[report.status]}\n`;
            message += `🕒 *Created*: ${new Date(report.createdAt).toLocaleString('en-PK')}\n`;
            message += `🕒 *Updated*: ${new Date(report.updatedAt).toLocaleString('en-PK')}\n\n`;
            
            message += `💬 *Problem Description*:\n${report.description || 'No description'}\n\n`;

            // Show notes if available
            if (report.notes && report.notes.length > 0) {
                message += `📝 *Notes Technician*:\n`;
                report.notes.forEach((note, index) => {
                    message += `${index + 1}. ${note.content}\n`;
                    message += `   📅 ${new Date(note.timestamp).toLocaleString('en-PK')}\n\n`;
                });
            }

            message += `💡 *Available commands:*\n`;
            message += `• *update ${report.id} [status] [notes]* - Update status\n`;
            message += `• *complete ${report.id} [notes]* - Complete report\n`;
            message += `• *notes ${report.id} [notes]* - Add notes`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleTroubleReportStatus:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while retrieving report details:\n${error.message}`
            );
        }
    }

    // Command: Update trouble report status
    async handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes) {
        try {
            if (!reportId || !newStatus) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\nupdate [id] [status] [notes]\n\nExample:\nupdate TR001 in_progress Checked on location`
                );
                return;
            }

            // Validate status
            const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
            if (!validStatuses.includes(newStatus)) {
                await this.sendMessage(remoteJid, 
                    `❌ *INVALID STATUS*\n\nValid statuses:\n• open - Open\n• in_progress - In Progress\n• resolved - Resolved\n• closed - Closed`
                );
                return;
            }

            const report = troubleReport.getTroubleReportById(reportId);
            
            if (!report) {
                await this.sendMessage(remoteJid, 
                    `❌ *REPORT NOT FOUND*\n\nReport with ID "${reportId}" not found.`
                );
                return;
            }

            // Update report status
            const updatedReport = troubleReport.updateTroubleReportStatus(reportId, newStatus, notes);
            
            if (!updatedReport) {
                await this.sendMessage(remoteJid, 
                    `❌ *UPDATE FAILED*\n\nAn error occurred while updating report status.`
                );
                return;
            }

            const statusText = {
                'open': 'Open',
                'in_progress': 'In Progress',
                'resolved': 'Resolved',
                'closed': 'Closed'
            };

            let message = `✅ *STATUS SUCCESSFULLY UPDATED*\n\n`;
            message += `🆔 *Ticket ID*: ${updatedReport.id}\n`;
            message += `📱 *Customer*: ${updatedReport.phone || 'N/A'}\n`;
            message += `📌 *New Status*: ${statusText[updatedReport.status]}\n`;
            message += `🕒 *Updated At*: ${new Date(updatedReport.updatedAt).toLocaleString('en-PK')}\n\n`;

            if (notes) {
                message += `💬 *Notes Added*:\n${notes}\n\n`;
            }

            message += `📣 *Automatic notifications have been sent to:*\n`;
            message += `• Customer (status update)\n`;
            message += `• Admin (monitoring)`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleUpdateTroubleReport:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while updating report:\n${error.message}`
            );
        }
    }

    // Command: Complete trouble report (alias for resolved)
    async handleResolveTroubleReport(remoteJid, reportId, notes) {
        try {
            if (!reportId) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\ncomplete [id] [notes]\n\nExample:\ncomplete TR001 Problem has been fixed, internet is now normal`
                );
                return;
            }

            // Use update command with resolved status
            await this.handleUpdateTroubleReport(remoteJid, reportId, 'resolved', notes);
            
        } catch (error) {
            console.error('Error in handleResolveTroubleReport:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while completing report:\n${error.message}`
            );
        }
    }

    // Command: Add note without changing status
    async handleAddNoteToTroubleReport(remoteJid, reportId, notes) {
        try {
            if (!reportId || !notes) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\nnotes [id] [notes]\n\nExample:\nnotes TR001 Already checked on location, problem in cable`
                );
                return;
            }

            const report = troubleReport.getTroubleReportById(reportId);
            
            if (!report) {
                await this.sendMessage(remoteJid, 
                    `❌ *REPORT NOT FOUND*\n\nReport with ID "${reportId}" not found.`
                );
                return;
            }

            // Update report with new note without changing status
            const updatedReport = troubleReport.updateTroubleReportStatus(reportId, report.status, notes);
            
            if (!updatedReport) {
                await this.sendMessage(remoteJid, 
                    `❌ *FAILED TO ADD NOTE*\n\nError occurred while adding note.`
                );
                return;
            }

            let message = `✅ *NOTE SUCCESSFULLY ADDED*\n\n`;
            message += `🆔 *Ticket ID*: ${updatedReport.id}\n`;
            message += `📱 *Customer*: ${updatedReport.phone || 'N/A'}\n`;
            message += `📌 *Current Status*: ${updatedReport.status}\n`;
            message += `🕒 *Updated At*: ${new Date(updatedReport.updatedAt).toLocaleString('en-PK')}\n\n`;
            message += `💬 *New Notes*:\n${notes}\n\n`;
            message += `📣 *Automatic notifications have been sent to:*\n`;
            message += `• Customer (notes update)\n`;
            message += `• Admin (monitoring)`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleAddNoteToTroubleReport:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nError occurred while adding note:\n${error.message}`
            );
        }
    }

    // Command: Help for trouble report
    async handleTroubleReportHelp(remoteJid) {
        const message = `🔧 *TROUBLE REPORT COMMAND HELP*\n\n` +
            `📋 *Available commands:*\n\n` +
            `• *trouble* - View list of active trouble reports\n` +
            `• *status [id]* - View trouble report details\n` +
            `• *update [id] [status] [notes]* - Update report status\n` +
            `• *complete [id] [notes]* - Mark report as completed (status: resolved)\n` +
            `• *notes [id] [notes]* - Add note without changing status\n` +
            `• *help trouble* - Show this help\n\n` +
            
            `📌 *Available statuses:*\n` +
            `• open - Open\n` +
            `• in_progress - In Progress\n` +
            `• resolved - Resolved\n` +
            `• closed - Closed\n\n` +
            
            `💡 *Usage Example:*\n` +
            `• trouble\n` +
            `• status TR001\n` +
            `• update TR001 in_progress Being checked at location\n` +
            `• complete TR001 Problem has been fixed\n` +
            `• notes TR001 Already checked, problem in cable\n\n` +
            
            `📣 *Auto Notification:*\n` +
            `• Each update will be automatically sent to customer\n` +
            `• Admin will receive notification for monitoring\n` +
            `• Real-time status in customer portal`;

        await this.sendMessage(remoteJid, message);
    }
}

module.exports = WhatsAppTroubleCommands;


