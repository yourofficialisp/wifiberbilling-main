const { getSetting, setSetting } = require('./settingsManager');
const billingManager = require('./billing');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const { getCompanyHeader } = require('./message-templates');

class WhatsAppNotificationManager {
    constructor() {
        this.sock = null;
        this.templatesFile = path.join(__dirname, '../data/whatsapp-templates.json');
        this.templates = this.loadTemplates() || {
            invoice_created: {
                title: 'New Bill',
                template: `📋 *NEW BILL*

Hello {customer_name},

Your monthly bill has been created:

📄 *No. Invoice:* {invoice_number}
💰 *Quantity:* Rp {amount}
📅 *Due Date:* {due_date}
📦 *Package:* {package_name} ({package_speed})
📝 *Notes:* {notes}

Please make payment before the due date to avoid late payment fees.

Thank you for your trust.`,
                enabled: true
            },
            due_date_reminder: {
                title: 'Due Date Reminder',
                template: `⚠️ *DUE DATE REMINDER*

Hello {customer_name},

Your bill will be due in {days_remaining} days:

📄 *No. Invoice:* {invoice_number}
💰 *Quantity:* Rp {amount}
📅 *Due Date:* {due_date}
📦 *Package:* {package_name} ({package_speed})

Please make payment immediately to avoid late payment fees.

Thank you.`,
                enabled: true
            },
            payment_received: {
                title: 'Payment Received',
                template: `✅ *PAYMENT RECEIVED*

Hello {customer_name},

Thank you! We have received your payment:

📄 *No. Invoice:* {invoice_number}
💰 *Quantity:* Rp {amount}
💳 *Payment Method:* {payment_method}
📅 *Date Payment:* {payment_date}
🔢 *No. Referensi:* {reference_number}

Your internet service will remain active. Thank you for your trust.`,
                enabled: true
            },
            service_disruption: {
                title: 'Service Disruption',
                template: `🚨 *SERVICE DISRUPTION*

Hello Valued Customer,

We inform you that there is a disruption in the internet network:

📡 *Type of Disruption:* {disruption_type}
📍 *Affected Area:* {affected_area}
⏰ *Estimated Resolution:* {estimated_resolution}
📞 *Hotline:* {support_phone}

We are working to resolve this issue as soon as possible. We apologize for the inconvenience.

Thank you for your understanding.`,
                enabled: true
            },
            service_announcement: {
                title: 'Service Announcement',
                template: `📢 *SERVICE ANNOUNCEMENT*

Hello Valued Customer,

{announcement_content}

Thank you for your attention.`,
                enabled: true
            },

            service_suspension: {
                title: 'Service Suspension',
                template: `⚠️ *INTERNET SERVICE SUSPENDED*

Hello {customer_name},

Your internet service has been suspended because:
📋 *Reason:* {reason}

💡 *How to Enable Back:*
1. Make payment for overdue bills
2. Service will be automatically activated after payment is confirmed

📞 *Need Help?*
Contact us at: {contact_whatsapp}

*${getCompanyHeader()}*
Thank you for your attention.`,
                enabled: true
            },

            service_restoration: {
                title: 'Service Restoration',
                template: `✅ *INTERNET SERVICE RESTORED*

Hello {customer_name},

Congratulations! Your internet service has been reactivated.

📋 *Information:*
• Status: ACTIVE ✅
• Package: {package_name}
• Speed: {package_speed}

Thank you for making payment on time.

*${getCompanyHeader()}*
Info: {contact_whatsapp}`,
                enabled: true
            },
            welcome_message: {
                title: 'Welcome Message',
                template: `👋 *WELCOME*

Hello {customer_name},

Welcome to our internet service!

📦 *Package:* {package_name} ({package_speed})
📞 *Support:* {support_phone}

📱 *To use WhatsApp service:*
Type: REG {customer_name}

Thank you for choosing our service.`,
                enabled: true
            },
            installation_job_assigned: {
                title: 'New Installation Task',
                template: `🔧 *NEW INSTALLATION TASK*

Hello {technician_name},

You have been assigned to a new installation:

📋 *Detail Job:*
• No. Job: {job_number}
• Customer: {customer_name}
• Phone: {customer_phone}
• Address: {customer_address}

📦 *Package Internet:*
• Name: {package_name}
• Harga: Rp {package_price}

📅 *Installation Schedule:*
• Date: {installation_date}
• Time: {installation_time}

📝 *Notes:* {notes}
🛠️ *Equipment:* {equipment_needed}

📍 *Location:* {customer_address}

*Status:* Assigned
*Priority:* {priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *CONFIRMATION MENU:*

1️⃣ *RECEIPT CONFIRMATION*
Reply with: *TERIMA* or *OK*

2️⃣ *START INSTALLATION*
Reply with: *MULAI* or *START*

3️⃣ *COMPLETE INSTALLATION*
Reply with: *SELESAI* or *DONE*

4️⃣ *NEED HELP*
Reply with: *BANTU* or *HELP*

5️⃣ *REPORT ISSUE*
Reply with: *MASALAH* or *ISSUE*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *QUICK RESPONSE HELPERS:*
• *ACCEPT* - Confirm receiving task
• *MULAI* - Start installation process
• *SELESAI* - Mark installation complete
• *BANTU* - Request technical assistance
• *MASALAH* - Report issues

📞 *Support:* {contact_whatsapp}

Please confirm acceptance of this task by replying *TERIMA*.

*${getCompanyHeader()}*`,
                enabled: true
            },
            installation_status_update: {
                title: 'Installation Status Update',
                template: `🔄 *INSTALLATION STATUS UPDATE*

Hello {technician_name},

Installation status has been updated:

📋 *Detail Job:*
• No. Job: {job_number}
• Customer: {customer_name}
• New Status: {new_status}
• Update Time: {update_time}

📝 *Notes:* {notes}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *CONFIRMATION MENU:*

1️⃣ *CONFIRM UPDATE*
Reply with: *KONFIRM* or *OK*

2️⃣ *NEED HELP*
Reply with: *BANTU* or *HELP*

3️⃣ *REPORT ISSUE*
Reply with: *MASALAH* or *ISSUE*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*${getCompanyHeader()}*`,
                enabled: true
            },
            installation_completed: {
                title: 'Installation Completed',
                template: `✅ *INSTALLATION COMPLETED*

Hello {technician_name},

Congratulations! Installation has been successfully completed:

📋 *Detail Job:*
• No. Job: {job_number}
• Customer: {customer_name}
• Status: COMPLETED ✅
• Completion Time: {completion_time}

📝 *Completion Notes:* {completion_notes}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 *CONFIRMATION MENU:*

1️⃣ *CONFIRM COMPLETION*
Reply with: *KONFIRM* or *OK*

2️⃣ *ADDITIONAL REPORT*
Reply with: *LAPOR* or *REPORT*

3️⃣ *NEED HELP*
Reply with: *BANTU* or *HELP*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *QUICK RESPONSE HELPERS:*
• *KONFIRM* - Confirm completion
• *LAPOR* - Report additional details
• *BANTU* - Request technical assistance

*${getCompanyHeader()}*`,
                enabled: true
            }
        };
    }

    setSock(sockInstance) {
        this.sock = sockInstance;
    }

    // Format phone number for WhatsApp
    formatPhoneNumber(number) {
        let cleaned = number.replace(/\D/g, '');
        if (cleaned.startsWith('0')) {
            cleaned = '62' + cleaned.slice(1);
        }
        if (!cleaned.startsWith('62')) {
            cleaned = '62' + cleaned;
        }
        return cleaned;
    }

    // Helper method to get invoice image path with fallback handling
    getInvoiceImagePath(packageData = null) {
        // First check if package has custom image
        if (packageData && packageData.image_filename) {
            const packageImagePath = path.resolve(__dirname, `../public/img/packages/${packageData.image_filename}`);
            if (fs.existsSync(packageImagePath)) {
                logger.info(`📸 Using package image: ${packageImagePath}`);
                return packageImagePath;
            }
        }

        // Fallback to default invoice images
        const imagePaths = [
            path.resolve(__dirname, '../public/img/tagihan.jpg'),
            path.resolve(__dirname, '../public/img/tagihan.png'),
            path.resolve(__dirname, '../public/img/invoice.jpg'),
            path.resolve(__dirname, '../public/img/invoice.png'),
            path.resolve(__dirname, '../public/img/logo.png')
        ];

        // Check each path and return the first one that exists
        for (const imagePath of imagePaths) {
            if (fs.existsSync(imagePath)) {
                logger.info(`📸 Using invoice image: ${imagePath}`);
                return imagePath;
            }
        }

        // Log if no image found (will send text-only)
        logger.warn(`⚠️ No invoice image found, will send text-only notification`);
        return null;
    }

    // Replace template variables with actual data
    replaceTemplateVariables(template, data) {
        let message = template;
        for (const [key, value] of Object.entries(data)) {
            const placeholder = `{${key}}`;
            message = message.replace(new RegExp(placeholder, 'g'), value || '');
        }
        return message;
    }

    // Format currency
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-PK').format(amount);
    }

    // Format date
    formatDate(date) {
        return new Date(date).toLocaleDateString('en-PK', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    // Get rate limit settings
    getRateLimitSettings() {
        return {
            maxMessagesPerBatch: getSetting('whatsapp_rate_limit.maxMessagesPerBatch', 10),
            delayBetweenBatches: getSetting('whatsapp_rate_limit.delayBetweenBatches', 30),
            delayBetweenMessages: getSetting('whatsapp_rate_limit.delayBetweenMessages', 2),
            maxRetries: getSetting('whatsapp_rate_limit.maxRetries', 2),
            dailyMessageLimit: getSetting('whatsapp_rate_limit.dailyMessageLimit', 0),
            enabled: getSetting('whatsapp_rate_limit.enabled', true)
        };
    }

    // Check daily message limit
    checkDailyMessageLimit() {
        const settings = this.getRateLimitSettings();
        if (settings.dailyMessageLimit <= 0) return true; // No limit
        
        const today = new Date().toISOString().split('T')[0];
        const dailyCount = getSetting(`whatsapp_daily_count.${today}`, 0);
        
        return dailyCount < settings.dailyMessageLimit;
    }

    // Increment daily message count
    incrementDailyMessageCount() {
        const today = new Date().toISOString().split('T')[0];
        const currentCount = getSetting(`whatsapp_daily_count.${today}`, 0);
        setSetting(`whatsapp_daily_count.${today}`, currentCount + 1);
    }

    // Send notification with header and footer
    async sendNotification(phoneNumber, message, options = {}) {
        try {
            if (!this.sock) {
                logger.error('WhatsApp sock not initialized');
                return { success: false, error: 'WhatsApp not connected' };
            }

            // Check rate limiting
            const settings = this.getRateLimitSettings();
            if (settings.enabled && !this.checkDailyMessageLimit()) {
                logger.warn(`Daily message limit reached (${settings.dailyMessageLimit}), skipping notification to ${phoneNumber}`);
                return { success: false, error: 'Daily message limit reached' };
            }

            const formattedNumber = this.formatPhoneNumber(phoneNumber);
            const jid = `${formattedNumber}@s.whatsapp.net`;

            // Add header and footer
            const companyHeader = getSetting('company_header', '📱 NBB Wifiber 📱\n\n');
            const footerSeparator = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            const footerInfo = footerSeparator + getSetting('footer_info', 'Powered by CyberNet');
            
            const fullMessage = `${companyHeader}${message}${footerInfo}`;
            
            // If imagePath provided and exists, try to send as image with caption
            if (options.imagePath) {
                try {
                    const imagePath = options.imagePath;
                    logger.info(`📸 Attempting to send with image: ${imagePath}`);
                    
                    if (fs.existsSync(imagePath)) {
                        await this.sock.sendMessage(jid, { image: { url: imagePath }, caption: fullMessage });
                        logger.info(`✅ WhatsApp image notification sent to ${phoneNumber} with image`);
                        
                        // Increment daily count
                        this.incrementDailyMessageCount();
                        return { success: true, withImage: true };
                    } else {
                        logger.warn(`⚠️ Image not found at path: ${imagePath}, falling back to text message`);
                    }
                } catch (imgErr) {
                    logger.error(`❌ Failed sending image to ${phoneNumber}, falling back to text:`, imgErr);
                }
            }

            // Send as text message (fallback or when no image specified)
            await this.sock.sendMessage(jid, { text: fullMessage }, options);
            
            logger.info(`✅ WhatsApp text notification sent to ${phoneNumber}`);
            
            // Increment daily count
            this.incrementDailyMessageCount();
            return { success: true, withImage: false };
        } catch (error) {
            logger.error(`Error sending WhatsApp notification to ${phoneNumber}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send bulk notifications with rate limiting
    async sendBulkNotifications(notifications) {
        try {
            const settings = this.getRateLimitSettings();
            
            if (!settings.enabled) {
                logger.info('Rate limiting disabled, sending all notifications immediately');
                return await this.sendAllNotifications(notifications);
            }

            logger.info(`Sending ${notifications.length} notifications with rate limiting enabled`);
            logger.info(`Settings: ${settings.maxMessagesPerBatch} per batch, ${settings.delayBetweenBatches}s between batches, ${settings.delayBetweenMessages}s between messages`);

            const results = {
                success: 0,
                failed: 0,
                skipped: 0,
                errors: []
            };

            // Process notifications in batches
            for (let i = 0; i < notifications.length; i += settings.maxMessagesPerBatch) {
                const batch = notifications.slice(i, i + settings.maxMessagesPerBatch);
                logger.info(`Processing batch ${Math.floor(i / settings.maxMessagesPerBatch) + 1}/${Math.ceil(notifications.length / settings.maxMessagesPerBatch)} (${batch.length} messages)`);

                // Check daily limit before processing batch
                if (!this.checkDailyMessageLimit()) {
                    logger.warn(`Daily message limit reached, skipping remaining ${notifications.length - i} notifications`);
                    results.skipped += notifications.length - i;
                    break;
                }

                // Process each notification in the batch
                for (let j = 0; j < batch.length; j++) {
                    const notification = batch[j];
                    
                    // Check daily limit for each message
                    if (!this.checkDailyMessageLimit()) {
                        logger.warn(`Daily message limit reached, skipping remaining ${batch.length - j} messages in current batch`);
                        results.skipped += batch.length - j;
                        break;
                    }

                    try {
                        const result = await this.sendNotificationWithRetry(notification.phoneNumber, notification.message, notification.options);
                        
                        if (result.success) {
                            results.success++;
                        } else {
                            results.failed++;
                            results.errors.push(`${notification.phoneNumber}: ${result.error}`);
                        }
                    } catch (error) {
                        results.failed++;
                        results.errors.push(`${notification.phoneNumber}: ${error.message}`);
                        logger.error(`Error sending notification to ${notification.phoneNumber}:`, error);
                    }

                    // Add delay between messages within batch
                    if (j < batch.length - 1 && settings.delayBetweenMessages > 0) {
                        await this.delay(settings.delayBetweenMessages * 1000);
                    }
                }

                // Add delay between batches
                if (i + settings.maxMessagesPerBatch < notifications.length && settings.delayBetweenBatches > 0) {
                    logger.info(`Waiting ${settings.delayBetweenBatches} seconds before next batch...`);
                    await this.delay(settings.delayBetweenBatches * 1000);
                }
            }

            logger.info(`Bulk notification completed: ${results.success} success, ${results.failed} failed, ${results.skipped} skipped`);
            return results;

        } catch (error) {
            logger.error('Error in sendBulkNotifications:', error);
            return {
                success: 0,
                failed: notifications.length,
                skipped: 0,
                errors: [`Bulk send error: ${error.message}`]
            };
        }
    }

    // Send message to configured WhatsApp groups (no template replacements here)
    async sendToConfiguredGroups(message) {
        try {
            const enabled = getSetting('whatsapp_groups.enabled', true);
            if (!enabled) {
                return { success: true, sent: 0, failed: 0, skipped: 0 };
            }

            let ids = getSetting('whatsapp_groups.ids', []);
            if (!Array.isArray(ids)) {
                // collect numeric keys for compatibility
                const asObj = getSetting('whatsapp_groups', {});
                ids = [];
                Object.keys(asObj).forEach(k => {
                    if (k.match(/^ids\.\d+$/)) {
                        ids.push(asObj[k]);
                    }
                });
            }

            if (!this.sock) {
                logger.error('WhatsApp sock not initialized');
                return { success: false, sent: 0, failed: ids.length, skipped: 0, error: 'WhatsApp not connected' };
            }

            let sent = 0;
            let failed = 0;

            const companyHeader = getSetting('company_header', '📱 NBB Wifiber 📱\n\n');
            const footerSeparator = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
            const footerInfo = footerSeparator + getSetting('footer_info', 'Powered by CyberNet');
            const fullMessage = `${companyHeader}${message}${footerInfo}`;

            for (const gid of ids) {
                try {
                    await this.sock.sendMessage(gid, { text: fullMessage });
                    sent++;
                    // small delay between group messages to avoid rate limit
                    await this.delay(1000);
                } catch (e) {
                    failed++;
                    logger.error(`Failed sending to group ${gid}:`, e);
                }
            }

            return { success: true, sent, failed, skipped: 0 };
        } catch (error) {
            logger.error('Error sending to configured groups:', error);
            return { success: false, sent: 0, failed: 0, skipped: 0, error: error.message };
        }
    }

    // Send notification with retry logic
    async sendNotificationWithRetry(phoneNumber, message, options = {}, retryCount = 0) {
        const settings = this.getRateLimitSettings();
        const maxRetries = settings.maxRetries;

        try {
            const result = await this.sendNotification(phoneNumber, message, options);
            
            if (result.success) {
                return result;
            }

            // Retry if failed and retry count not exceeded
            if (retryCount < maxRetries) {
                logger.warn(`Retry ${retryCount + 1}/${maxRetries} for ${phoneNumber}: ${result.error}`);
                await this.delay(2000 * (retryCount + 1)); // Exponential backoff
                return await this.sendNotificationWithRetry(phoneNumber, message, options, retryCount + 1);
            }

            return result;
        } catch (error) {
            if (retryCount < maxRetries) {
                logger.warn(`Retry ${retryCount + 1}/${maxRetries} for ${phoneNumber}: ${error.message}`);
                await this.delay(2000 * (retryCount + 1)); // Exponential backoff
                return await this.sendNotificationWithRetry(phoneNumber, message, options, retryCount + 1);
            }

            return { success: false, error: error.message };
        }
    }

    // Send all notifications without rate limiting
    async sendAllNotifications(notifications) {
        const results = {
            success: 0,
            failed: 0,
            skipped: 0,
            errors: []
        };

        for (const notification of notifications) {
            try {
                const result = await this.sendNotification(notification.phoneNumber, notification.message, notification.options);
                
                if (result.success) {
                    results.success++;
                } else {
                    results.failed++;
                    results.errors.push(`${notification.phoneNumber}: ${result.error}`);
                }
            } catch (error) {
                results.failed++;
                results.errors.push(`${notification.phoneNumber}: ${error.message}`);
                logger.error(`Error sending notification to ${notification.phoneNumber}:`, error);
            }
        }

        return results;
    }

    // Utility function for delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Send invoice created notification
    async sendInvoiceCreatedNotification(customerId, invoiceId) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('invoice_created')) {
                logger.info('Invoice created notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            const customer = await billingManager.getCustomerById(customerId);
            const invoice = await billingManager.getInvoiceById(invoiceId);
            const packageData = await billingManager.getPackageById(invoice.package_id);

            if (!customer || !invoice || !packageData) {
                logger.error('Missing data for invoice notification');
                return { success: false, error: 'Missing data' };
            }

            const data = {
                customer_name: customer.name,
                invoice_number: invoice.invoice_number,
                amount: this.formatCurrency(invoice.amount),
                due_date: this.formatDate(invoice.due_date),
                package_name: packageData.name,
                package_speed: packageData.speed,
                notes: invoice.notes || 'Bill bulanan'
            };

            const message = this.replaceTemplateVariables(
                this.templates.invoice_created.template,
                data
            );

            // Attach invoice banner image if available
            const imagePath = this.getInvoiceImagePath(packageData);
            return await this.sendNotification(customer.phone, message, { imagePath });
        } catch (error) {
            logger.error('Error sending invoice created notification:', error);
            return { success: false, error: error.message };
        }
    }

    // Send due date reminder
    async sendDueDateReminder(invoiceId) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('due_date_reminder')) {
                logger.info('Due date reminder notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            const invoice = await billingManager.getInvoiceById(invoiceId);
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const packageData = await billingManager.getPackageById(invoice.package_id);

            if (!customer || !invoice || !packageData) {
                logger.error('Missing data for due date reminder');
                return { success: false, error: 'Missing data' };
            }

            const dueDate = new Date(invoice.due_date);
            const today = new Date();
            const daysRemaining = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

            const data = {
                customer_name: customer.name,
                invoice_number: invoice.invoice_number,
                amount: this.formatCurrency(invoice.amount),
                due_date: this.formatDate(invoice.due_date),
                days_remaining: daysRemaining,
                package_name: packageData.name,
                package_speed: packageData.speed
            };

            const message = this.replaceTemplateVariables(
                this.templates.due_date_reminder.template,
                data
            );

            // Attach same invoice banner image
            const imagePath = this.getInvoiceImagePath(packageData);
            return await this.sendNotification(customer.phone, message, { imagePath });
        } catch (error) {
            logger.error('Error sending due date reminder:', error);
            return { success: false, error: error.message };
        }
    }

    // Send payment received notification
    async sendPaymentReceivedNotification(paymentId) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('payment_received')) {
                logger.info('Payment received notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            const payment = await billingManager.getPaymentById(paymentId);
            const invoice = await billingManager.getInvoiceById(payment.invoice_id);
            const customer = await billingManager.getCustomerById(invoice.customer_id);
            const packageData = await billingManager.getPackageById(invoice.package_id);

            if (!payment || !invoice || !customer) {
                logger.error('Missing data for payment notification');
                return { success: false, error: 'Missing data' };
            }

            const data = {
                customer_name: customer.name,
                invoice_number: invoice.invoice_number,
                amount: this.formatCurrency(payment.amount),
                payment_method: payment.payment_method,
                payment_date: this.formatDate(payment.payment_date),
                reference_number: payment.reference_number || 'N/A'
            };

            const message = this.replaceTemplateVariables(
                this.templates.payment_received.template,
                data
            );

            // Attach same invoice banner image
            const imagePath = this.getInvoiceImagePath(packageData);
            return await this.sendNotification(customer.phone, message, { imagePath });
        } catch (error) {
            logger.error('Error sending payment received notification:', error);
            return { success: false, error: error.message };
        }
    }

    // Send service disruption notification
    async sendServiceDisruptionNotification(disruptionData) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('service_disruption')) {
                logger.info('Service disruption notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            const customers = await billingManager.getCustomers();
            const activeCustomers = customers.filter(c => c.status === 'active' && c.phone);

            const data = {
                disruption_type: disruptionData.type || 'Gangguan Jaringan',
                affected_area: disruptionData.area || 'Seluruh Area',
                estimated_resolution: disruptionData.estimatedTime || 'Medium dalam penanganan',
                support_phone: getSetting('contact_whatsapp', '03036783333')
            };

            const message = this.replaceTemplateVariables(
                this.templates.service_disruption.template,
                data
            );

            // Prepare notifications for bulk sending
            const notifications = activeCustomers.map(customer => ({
                phoneNumber: customer.phone,
                message: message,
                options: {}
            }));

            // Use bulk notifications with rate limiting
            const result = await this.sendBulkNotifications(notifications);

            // Also send to configured groups
            const groupMessage = message;
            const groupRes = await this.sendToConfiguredGroups(groupMessage);

            return {
                success: true,
                sent: result.success + (groupRes.sent || 0),
                failed: result.failed + (groupRes.failed || 0),
                skipped: result.skipped + (groupRes.skipped || 0),
                total: activeCustomers.length,
                errors: result.errors,
                customer_sent: result.success,
                customer_failed: result.failed,
                group_sent: groupRes.sent || 0,
                group_failed: groupRes.failed || 0
            };
        } catch (error) {
            logger.error('Error sending service disruption notification:', error);
            return { success: false, error: error.message };
        }
    }

    // Send service announcement
    async sendServiceAnnouncement(announcementData) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('service_announcement')) {
                logger.info('Service announcement notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            const customers = await billingManager.getCustomers();
            const activeCustomers = customers.filter(c => c.status === 'active' && c.phone);

            const data = {
                announcement_content: announcementData.content || 'Tidakdada kaatktnpgugumumanuman'
            };

            const message = this.replaceTemplateVariables(
                this.templates.service_announcement.template,
                data
            );

            // Prepare notifications for bulk sending
            const notifications = activeCustomers.map(customer => ({
                phoneNumber: customer.phone,
                message: message,
                options: {}
            }));

            // Use bulk notifications with rate limiting
            const result = await this.sendBulkNotifications(notifications);

            // Also send to configured groups
            const groupMessage = message;
            const groupRes = await this.sendToConfiguredGroups(groupMessage);

            return {
                success: true,
                sent: result.success + (groupRes.sent || 0),
                failed: result.failed + (groupRes.failed || 0),
                skipped: result.skipped + (groupRes.skipped || 0),
                total: activeCustomers.length,
                errors: result.errors,
                customer_sent: result.success,
                customer_failed: result.failed,
                group_sent: groupRes.sent || 0,
                group_failed: groupRes.failed || 0
            };
        } catch (error) {
            logger.error('Error sending service announcement:', error);
            return { success: false, error: error.message };
        }
    }

    // Get all templates
    // Load templates from file
    loadTemplates() {
        try {
            if (fs.existsSync(this.templatesFile)) {
                const data = fs.readFileSync(this.templatesFile, 'utf8');
                console.log('✅ [WHATSAPP] Loaded templates from file');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('❌ [WHATSAPP] Error loading templates:', error);
        }
        return null;
    }

    // Save templates to file
    saveTemplates() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.templatesFile);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            fs.writeFileSync(this.templatesFile, JSON.stringify(this.templates, null, 2));
            console.log('✅ [WHATSAPP] Templates saved to file');
            return true;
        } catch (error) {
            console.error('❌ [WHATSAPP] Error saving templates:', error);
            return false;
        }
    }

    getTemplates() {
        return this.templates;
    }

    // Update template
    updateTemplate(templateKey, newTemplate) {
        if (this.templates[templateKey]) {
            this.templates[templateKey] = newTemplate;
            this.saveTemplates(); // Save to file after update
            return true;
        }
        return false;
    }

    // Update multiple templates at once
    updateTemplates(templatesData) {
        let updated = 0;
        Object.keys(templatesData).forEach(key => {
            if (this.templates[key]) {
                this.templates[key] = templatesData[key];
                updated++;
            }
        });
        
        if (updated > 0) {
            this.saveTemplates(); // Save once after all updates
        }
        
        return updated;
    }

    // Check if template is enabled
    isTemplateEnabled(templateKey) {
        return this.templates[templateKey] && this.templates[templateKey].enabled !== false;
    }

    // Test notification to specific number
    async testNotification(phoneNumber, templateKey, testData = {}) {
        try {
            if (!this.templates[templateKey]) {
                return { success: false, error: 'Template not found' };
            }

            const message = this.replaceTemplateVariables(
                this.templates[templateKey].template,
                testData
            );

            return await this.sendNotification(phoneNumber, message);
        } catch (error) {
            logger.error('Error sending test notification:', error);
            return { success: false, error: error.message };
        }
    }

    // Send service suspension notification
    async sendServiceSuspensionNotification(customer, reason) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('service_suspension')) {
                logger.info('Service suspension notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!customer.phone) {
                logger.warn(`Customer ${customer.username} has no phone number for suspension notification`);
                return { success: false, error: 'No phone number' };
            }

            const message = this.replaceTemplateVariables(
                this.templates.service_suspension.template,
                {
                    customer_name: customer.name,
                    reason: reason,
                    contact_whatsapp: getSetting('contact_whatsapp', '03036783333')
                }
            );

            const result = await this.sendNotification(customer.phone, message);
            if (result.success) {
                logger.info(`Service suspension notification sent to ${customer.name} (${customer.phone})`);
            } else {
                logger.error(`Failed to send service suspension notification to ${customer.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending service suspension notification to ${customer.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send service restoration notification
    async sendServiceRestorationNotification(customer, reason) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('service_restoration')) {
                logger.info('Service restoration notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!customer.phone) {
                logger.warn(`Customer ${customer.username} has no phone number for restoration notification`);
                return { success: false, error: 'No phone number' };
            }

            const message = this.replaceTemplateVariables(
                this.templates.service_restoration.template,
                {
                    customer_name: customer.name,
                    package_name: customer.package_name || 'N/A',
                    package_speed: customer.package_speed || 'N/A',
                    reason: reason || '',
                    contact_whatsapp: getSetting('contact_whatsapp', '03036783333')
                }
            );

            const result = await this.sendNotification(customer.phone, message);
            if (result.success) {
                logger.info(`Service restoration notification sent to ${customer.name} (${customer.phone})`);
            } else {
                logger.error(`Failed to send service restoration notification to ${customer.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending service restoration notification to ${customer.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send welcome message notification
    async sendWelcomeMessage(customer) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('welcome_message')) {
                logger.info('Welcome message notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!customer.phone) {
                logger.warn(`Customer ${customer.username} has no phone number for welcome message`);
                return { success: false, error: 'No phone number' };
            }

            const message = this.replaceTemplateVariables(
                this.templates.welcome_message.template,
                {
                    customer_name: customer.name,
                    package_name: customer.package_name || 'N/A',
                    package_speed: customer.package_speed || 'N/A',
                    wifi_password: customer.wifi_password || 'N/A',
                    support_phone: getSetting('contact_whatsapp', '03036783333')
                }
            );

            const result = await this.sendNotification(customer.phone, message);
            if (result.success) {
                logger.info(`Welcome message sent to ${customer.name} (${customer.phone})`);
            } else {
                logger.error(`Failed to send welcome message to ${customer.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending welcome message to ${customer.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send installation job assignment notification to technician
    async sendInstallationJobNotification(technician, installationJob, customer, packageData) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('installation_job_assigned')) {
                logger.info('Installation job notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!technician.phone) {
                logger.warn(`Technician ${technician.name} has no phone number for installation job notification`);
                return { success: false, error: 'No phone number' };
            }

            // Format installation date
            const installationDate = installationJob.installation_date ? 
                new Date(installationJob.installation_date).toLocaleDateString('en-PK') : 'TBD';

            const message = this.replaceTemplateVariables(
                this.templates.installation_job_assigned.template,
                {
                    technician_name: technician.name,
                    job_number: installationJob.job_number || 'N/A',
                    customer_name: customer.name || installationJob.customer_name || 'N/A',
                    customer_phone: customer.phone || installationJob.customer_phone || 'N/A',
                    customer_address: customer.address || installationJob.customer_address || 'N/A',
                    package_name: packageData.name || installationJob.package_name || 'N/A',
                    package_price: packageData.price ? new Intl.NumberFormat('en-PK').format(packageData.price) : 
                                  installationJob.package_price ? new Intl.NumberFormat('en-PK').format(installationJob.package_price) : 'N/A',
                    installation_date: installationDate,
                    installation_time: installationJob.installation_time || 'TBD',
                    notes: installationJob.notes || 'Tidak adadcatataaa catatan',
                    equipment_needed: installationJob.equipment_needed || 'Standard equipment',
                    priority: installationJob.priority || 'Normal',
                    contact_whatsapp: getSetting('contact_whatsapp', '03036783333')
                }
            );

            const result = await this.sendNotification(technician.phone, message);
            if (result.success) {
                logger.info(`Installation job notification sent to technician ${technician.name} (${technician.phone}) for job ${installationJob.job_number}`);
            } else {
                logger.error(`Failed to send installation job notification to technician ${technician.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending installation job notification to technician ${technician.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send installation status update notification to technician
    async sendInstallationStatusUpdateNotification(technician, installationJob, customer, newStatus, notes) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('installation_status_update')) {
                logger.info('Installation status update notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!technician.phone) {
                logger.warn(`Technician ${technician.name} has no phone number for status update notification`);
                return { success: false, error: 'No phone number' };
            }

            // Format status text
            const statusText = {
                'scheduled': 'Terjadwal',
                'assigned': 'Ditugaskan',
                'in_progress': 'Medium Berlangsung',
                'completed': 'Completed',
                'cancelled': 'Dibatalkan'
            }[newStatus] || newStatus;

            const message = this.replaceTemplateVariables(
                this.templates.installation_status_update.template,
                {
                    technician_name: technician.name,
                    job_number: installationJob.job_number || 'N/A',
                    customer_name: customer.name || installationJob.customer_name || 'N/A',
                    new_status: statusText,
                    update_time: new Date().toLocaleString('en-PK'),
                    notes: notes || 'No notes'
                }
            );

            const result = await this.sendNotification(technician.phone, message);
            if (result.success) {
                logger.info(`Installation status update notification sent to technician ${technician.name} for job ${installationJob.job_number}`);
            } else {
                logger.error(`Failed to send status update notification to technician ${technician.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending installation status update notification to technician ${technician.name}:`, error);
            return { success: false, error: error.message };
        }
    }

    // Send installation completion notification to technician
    async sendInstallationCompletionNotification(technician, installationJob, customer, completionNotes) {
        try {
            // Check if template is enabled
            if (!this.isTemplateEnabled('installation_completed')) {
                logger.info('Installation completion notification is disabled, skipping...');
                return { success: true, skipped: true, reason: 'Template disabled' };
            }

            if (!technician.phone) {
                logger.warn(`Technician ${technician.name} has no phone number for completion notification`);
                return { success: false, error: 'No phone number' };
            }

            const message = this.replaceTemplateVariables(
                this.templates.installation_completed.template,
                {
                    technician_name: technician.name,
                    job_number: installationJob.job_number || 'N/A',
                    customer_name: customer.name || installationJob.customer_name || 'N/A',
                    completion_time: new Date().toLocaleString('en-PK'),
                    completion_notes: completionNotes || 'No additional notes'
                }
            );

            const result = await this.sendNotification(technician.phone, message);
            if (result.success) {
                logger.info(`Installation completion notification sent to technician ${technician.name} for job ${installationJob.job_number}`);
            } else {
                logger.error(`Failed to send completion notification to technician ${technician.name}:`, result.error);
            }
            
            return result;
        } catch (error) {
            logger.error(`Error sending installation completion notification to technician ${technician.name}:`, error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new WhatsAppNotificationManager(); 