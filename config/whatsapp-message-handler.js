const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('./logger');
const { getCompanyHeader, getContactInfoMessage } = require('./message-templates');
const { getSetting } = require('./settingsManager');

class WhatsAppMessageHandler {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/billing.db');
        this.db = new sqlite3.Database(this.dbPath);
        
        // Define response patterns for technician messages
        this.responsePatterns = {
            // Confirmation patterns
            'RECEIVE': { action: 'confirm_reception', status: 'assigned' },
            'OK': { action: 'confirm_reception', status: 'assigned' },
            'CONFIRM': { action: 'confirm_reception', status: 'assigned' },
            
            // Start installation patterns
            'START': { action: 'start_installation', status: 'in_progress' },
            'BEGIN': { action: 'start_installation', status: 'in_progress' },
            'PROCESS': { action: 'start_installation', status: 'in_progress' },
            
            // Complete installation patterns
            'DONE': { action: 'complete_installation', status: 'completed' },
            'FINISH': { action: 'complete_installation', status: 'completed' },
            'COMPLETE': { action: 'complete_installation', status: 'completed' },
            
            // Help patterns
            'HELP': { action: 'request_help', status: null },
            
            // Problem report patterns
            'ISSUE': { action: 'report_problem', status: null },
            'PROBLEM': { action: 'report_problem', status: null },
            
            // Additional report patterns
            'REPORT': { action: 'additional_report', status: null },
            'ADD': { action: 'additional_report', status: null }
        };
    }

    // Process incoming WhatsApp message from technician
    async processTechnicianMessage(phone, message, technicianName = null) {
        try {
            // Clean and normalize the message
            const cleanMessage = message.trim().toUpperCase();
            
            // Find matching pattern
            const pattern = this.findMatchingPattern(cleanMessage);
            
            if (!pattern) {
                logger.info(`No matching pattern found for message: "${message}" from ${phone}`);
                return this.sendUnrecognizedMessageResponse(phone);
            }

            // Get technician details
            const technician = await this.getTechnicianByPhone(phone);
            if (!technician) {
                logger.warn(`Technician not found for phone: ${phone}`);
                return this.sendTechnicianNotFoundResponse(phone);
            }

            // Get active installation job for this technician
            const activeJob = await this.getActiveInstallationJob(technician.id);
            if (!activeJob) {
                logger.info(`No active installation job found for technician: ${technician.name}`);
                return this.sendNoActiveJobResponse(phone, technician.name);
            }

            // Process the action
            const result = await this.processAction(pattern.action, technician, activeJob, cleanMessage);
            
            // Send confirmation response
            await this.sendActionConfirmationResponse(phone, pattern.action, activeJob, result);
            
            return result;

        } catch (error) {
            logger.error('Error processing technician message:', error);
            return { success: false, error: error.message };
        }
    }

    // Find matching pattern in the message
    findMatchingPattern(message) {
        for (const [pattern, action] of Object.entries(this.responsePatterns)) {
            if (message.includes(pattern)) {
                return action;
            }
        }
        return null;
    }

    // Get technician by phone number
    async getTechnicianByPhone(phone) {
        return new Promise((resolve, reject) => {
            // Clean phone number
            let cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.startsWith('62')) {
                cleanPhone = '0' + cleanPhone.slice(2);
            }
            
            this.db.get(
                'SELECT id, name, phone, role FROM technicians WHERE phone = ? AND is_active = 1',
                [cleanPhone],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });
    }

    // Get active installation job for technician
    async getActiveInstallationJob(technicianId) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM installation_jobs 
                WHERE assigned_technician_id = ? 
                AND status IN ('assigned', 'in_progress')
                ORDER BY created_at DESC 
                LIMIT 1
            `, [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Process the action based on pattern
    async processAction(action, technician, job, message) {
        try {
            switch (action) {
                case 'confirm_reception':
                    return await this.confirmJobReception(technician, job);
                
                case 'start_installation':
                    return await this.startInstallation(technician, job);
                
                case 'complete_installation':
                    return await this.completeInstallation(technician, job, message);
                
                case 'request_help':
                    return await this.requestHelp(technician, job, message);
                
                case 'report_problem':
                    return await this.reportProblem(technician, job, message);
                
                case 'additional_report':
                    return await this.additionalReport(technician, job, message);
                
                default:
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            logger.error(`Error processing action ${action}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Confirm job reception
    async confirmJobReception(technician, job) {
        try {
            // Update job status to confirmed
            await new Promise((resolve, reject) => {
                this.db.run(`
                    UPDATE installation_jobs 
                    SET status = 'assigned', 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [job.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Log status change
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, 'assigned', 'technician', ?, 'Confirm task receipt via WhatsApp')
                `, [job.id, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} confirmed reception of job ${job.job_number}`);
            return { success: true, action: 'reception_confirmed', message: 'Task receipt confirmed' };

        } catch (error) {
            logger.error('Error confirming job reception:', error);
            return { success: false, error: error.message };
        }
    }

    // Start installation
    async startInstallation(technician, job) {
        try {
            // Update job status to in progress
            await new Promise((resolve, reject) => {
                this.db.run(`
                    UPDATE installation_jobs 
                    SET status = 'in_progress', 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [job.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Log status change
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, 'in_progress', 'technician', ?, 'Start installation via WhatsApp')
                `, [job.id, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} started installation for job ${job.job_number}`);
            return { success: true, action: 'installation_started', message: 'Installation started' };

        } catch (error) {
            logger.error('Error starting installation:', error);
            return { success: false, error: error.message };
        }
    }

    // Complete installation
    async completeInstallation(technician, job, message) {
        try {
            // Extract completion notes from message
            const completionNotes = this.extractNotesFromMessage(message);
            
            // Update job status to completed
            await new Promise((resolve, reject) => {
                this.db.run(`
                    UPDATE installation_jobs 
                    SET status = 'completed', 
                        notes = COALESCE(?, notes),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [completionNotes, job.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Log status change
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, 'completed', 'technician', ?, 'Installation completed via WhatsApp: ${completionNotes}')
                `, [job.id, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} completed installation for job ${job.job_number}`);
            return { success: true, action: 'installation_completed', message: 'Installation completed', notes: completionNotes };

        } catch (error) {
            logger.error('Error completing installation:', error);
            return { success: false, error: error.message };
        }
    }

    // Request help
    async requestHelp(technician, job, message) {
        try {
            // Log help request
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, ?, 'technician', ?, 'Request help via WhatsApp: ${message}')
                `, [job.id, job.status, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} requested help for job ${job.job_number}`);
            return { success: true, action: 'help_requested', message: 'Help request received' };

        } catch (error) {
            logger.error('Error requesting help:', error);
            return { success: false, error: error.message };
        }
    }

    // Report problem
    async reportProblem(technician, job, message) {
        try {
            // Log problem report
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, ?, 'technician', ?, 'Report problem via WhatsApp: ${message}')
                `, [job.id, job.status, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} reported problem for job ${job.job_number}`);
            return { success: true, action: 'problem_reported', message: 'Problem report received' };

        } catch (error) {
            logger.error('Error reporting problem:', error);
            return { success: false, error: error.message };
        }
    }

    // Additional report
    async additionalReport(technician, job, message) {
        try {
            // Log additional report
            await new Promise((resolve, reject) => {
                this.db.run(`
                    INSERT INTO installation_job_status_history (
                        job_id, old_status, new_status, changed_by_type, changed_by_id, notes
                    ) VALUES (?, ?, ?, 'technician', ?, 'Additional report via WhatsApp: ${message}')
                `, [job.id, job.status, job.status, technician.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            logger.info(`Technician ${technician.name} sent additional report for job ${job.job_number}`);
            return { success: true, action: 'additional_reported', message: 'Additional report received' };

        } catch (error) {
            logger.error('Error processing additional report:', error);
            return { success: false, error: error.message };
        }
    }

    // Extract notes from message
    extractNotesFromMessage(message) {
        // Remove command words and extract remaining text as notes
        const commandWords = ['DONE', 'FINISH', 'COMPLETE', 'REPORT', 'ADD'];
        let notes = message;
        
        commandWords.forEach(word => {
            notes = notes.replace(new RegExp(word, 'gi'), '').trim();
        });
        
        return notes || 'Installation completed';
    }

    // Send response messages (placeholder - integrate with your WhatsApp sending system)
    async sendUnrecognizedMessageResponse(phone) {
        const message = `❓ *UNRECOGNIZED MESSAGE*

Sorry, your message cannot be processed by the system.

📱 *Use the following format:*
• *RECEIVE* - Confirm task receipt
• *START* - Start installation
• *DONE* - Mark as complete
• *HELP* - Request help
• *ISSUE* - Report issues

*${getCompanyHeader()}*`;

        // TODO: Integrate with your WhatsApp sending system
        logger.info(`Sending unrecognized message response to ${phone}`);
        return { success: true, message: 'Response sent' };
    }

    async sendTechnicianNotFoundResponse(phone) {
        const message = `❌ *TECHNICIAN NOT FOUND*

Sorry, your phone number is not registered as an active technician.

Please contact admin to verify your technician status.

*${getCompanyHeader()}*`;

        // TODO: Integrate with your WhatsApp sending system
        logger.info(`Sending technician not found response to ${phone}`);
        return { success: true, message: 'Response sent' };
    }

    async sendNoActiveJobResponse(phone, technicianName) {
        const message = `📋 *NO ACTIVE TASK*

Hello ${technicianName},

Currently there are no active installation tasks assigned to you.

Please wait for assignment from admin or contact admin if you have any questions.

*${getCompanyHeader()}*`;

        // TODO: Integrate with your WhatsApp sending system
        logger.info(`Sending no active job response to ${phone}`);
        return { success: true, message: 'Response sent' };
    }

    async sendActionConfirmationResponse(phone, action, job, result) {
        let message = '';
        
        switch (action) {
            case 'confirm_reception':
                message = `✅ *TASK RECEIPT CONFIRMED*

Installation task has been confirmed:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}
• Status: Assigned ✅

Please prepare your equipment and perform installation according to schedule.

*${getCompanyHeader()}*`;
                break;
                
            case 'start_installation':
                message = `🚀 *INSTALLATION STARTED*

Installation has started:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}
• Status: In Progress 🔄

Perform installation carefully and safely.

*${getCompanyHeader()}*`;
                break;
                
            case 'complete_installation':
                message = `🎉 *INSTALLATION COMPLETED*

Congratulations! Installation has been successfully completed:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}
• Status: Completed ✅
• Notes: ${result.notes || 'No notes'}

Thank you for completing the task well!

*${getCompanyHeader()}*`;
                break;
                
            case 'help_requested':
                message = `🆘 *HELP REQUEST RECEIVED*

Your help request has been received:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}

Support team will contact you soon.

📞 *Support:* ${getSetting('contact_whatsapp', '03036783333')}

*${getCompanyHeader()}*`;
                break;
                
            case 'problem_reported':
                message = `⚠️ *ISSUE REPORT RECEIVED*

Your issue report has been received:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}

Support team will follow up soon.

📞 *Support:* ${getSetting('contact_whatsapp', '03036783333')}

*${getCompanyHeader()}*`;
                break;
                
            case 'additional_reported':
                message = `📝 *ADDITIONAL REPORT RECEIVED*

Your additional report has been received:

📋 *Detail Job:*
• No. Job: ${job.job_number}
• Customer: ${job.customer_name}

Thank you for the additional information.

*${getCompanyHeader()}*`;
                break;
                
            default:
                message = `✅ *ACTION SUCCESSFULLY PROCESSED*

Your action has been successfully processed by the system.

*${getCompanyHeader()}*`;
        }

        // TODO: Integrate with your WhatsApp sending system
        logger.info(`Sending action confirmation response to ${phone} for action: ${action}`);
        return { success: true, message: 'Response sent' };
    }
}

module.exports = new WhatsAppMessageHandler();
