const logger = require('./logger');

// Helper function to get settings with cache
function getSettingsWithCache() {
    try {
        const { getSettings } = require('./settings');
        return getSettings();
    } catch (error) {
        logger.error('Error getting settings:', error);
        return {};
    }
}

class AgentWhatsAppManager {
    constructor() {
        this.sock = null;
        
        // Try to get socket from global if available
        if (typeof global !== 'undefined') {
            if (global.whatsappSocket) {
                this.sock = global.whatsappSocket;
            } else if (typeof global.getWhatsAppSocket === 'function') {
                this.sock = global.getWhatsAppSocket();
            }
        }
    }

    setSocket(sock) {
        this.sock = sock;
    }

    // ===== VOUCHER NOTIFICATIONS =====

    async sendVoucherNotification(agent, customer, voucherData) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for voucher notification');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            // Message for agent
            const agentMessage = `${formattedHeader}🎫 **VOUCHER SUCCESSFULLY SOLD**

📋 **Detail Voucher:**
• Code: \`${voucherData.voucherCode}\`
• Package: ${voucherData.packageName}
• Price: Rs ${voucherData.price.toLocaleString()}
• Commission: Rs ${voucherData.commission.toLocaleString()}

👤 **Customer:**
• Name: ${customer.name}
• HP: ${customer.phone || 'Not available'}

✅ Voucher has been successfully sold and commission has been added to your balance.${footerInfo}`;

            // Message for customer
            const customerMessage = `${formattedHeader}🎫 **YOUR HOTSPOT VOUCHER**

📋 **Detail Voucher:**
• Code: \`${voucherData.voucherCode}\`
• Package: ${voucherData.packageName}
• Price: Rs ${voucherData.price.toLocaleString()}

🔑 **How to Use:**
1. Connect to WiFi hotspot
2. Enter voucher code: \`${voucherData.voucherCode}\`
3. Enjoy internet access according to package

📞 **Help:** Contact ${settings.contact_phone || 'Admin'} if there is a problem.${footerInfo}`;

            // Send to agent
            if (agent.phone) {
                const formattedAgentPhone = this.formatPhoneNumber(agent.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedAgentPhone, { text: agentMessage });
            }

            // Send to customer if phone number exists
            if (customer.phone) {
                const formattedCustomerPhone = this.formatPhoneNumber(customer.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedCustomerPhone, { text: customerMessage });
            }

            return { success: true, message: 'Notification successfully sent' };
        } catch (error) {
            logger.error('Send voucher notification error:', error);
            return { success: false, message: 'Failed to send notification' };
        }
    }

    // Send voucher directly to customer
    async sendVoucherToCustomer(customerPhone, customerName, voucherCode, packageName, price, agentInfo = null) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for customer voucher');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            // Create agent info text
            let agentInfoText = '';
            if (agentInfo && agentInfo.name) {
                agentInfoText = `\n👤 **Purchased through Agent:** ${agentInfo.name}`;
                if (agentInfo.phone) {
                    agentInfoText += `\n📞 **Agent Contact:** ${agentInfo.phone}`;
                }
            }

            // Message for customer (without internal price)
            const customerMessage = `${formattedHeader}🎫 **YOUR HOTSPOT VOUCHER**

📋 **Detail Voucher:**
• Code: \`${voucherCode}\`
• Package: ${packageName}
• Price: Rs ${price.toLocaleString('en-PK')}${agentInfoText}

🔑 **How to Use:**
1. Connect to WiFi hotspot
2. Enter voucher code: \`${voucherCode}\`
3. Enjoy internet access according to package

📞 **Help:** Contact ${settings.contact_phone || 'Admin'} if there is a problem.${footerInfo}`;

            // Send to customer
            const formattedCustomerPhone = this.formatPhoneNumber(customerPhone) + '@s.whatsapp.net';
            await this.sock.sendMessage(formattedCustomerPhone, { text: customerMessage });
            
            logger.info(`Voucher sent to customer: ${customerPhone}`);
            return { success: true, message: 'Voucher successfully sent to customer' };
        } catch (error) {
            logger.error('Send voucher to customer error:', error);
            return { success: false, message: 'Failed to send voucher to customer' };
        }
    }

    // ===== PAYMENT NOTIFICATIONS =====

    async sendPaymentNotification(agent, customer, paymentData) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for payment notification');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            // Message for agent
            const agentMessage = `${formattedHeader}💰 **PAYMENT SUCCESSFULLY PROCESSED**

📋 **Detail Payment:**
• Amount: Rs ${paymentData.amount.toLocaleString()}
• Method: ${paymentData.method}
• Commission: Rs ${paymentData.commission.toLocaleString()}

👤 **Customer:**
• Name: ${customer.name}
• HP: ${customer.phone || 'Not available'}

✅ Payment has been successfully processed and commission has been added to your balance.${footerInfo}`;

            // Message for customer
            const customerMessage = `${formattedHeader}✅ **PAYMENT RECEIVED**

📋 **Detail Payment:**
• Amount: Rs ${paymentData.amount.toLocaleString()}
• Method: ${paymentData.method}
• Date: ${new Date().toLocaleString('en-PK')}

👤 **Processed by:** ${agent.name}

✅ Thank you for your payment. Bill has been paid in full.${footerInfo}`;

            // Send to agent
            if (agent.phone) {
                const formattedAgentPhone = this.formatPhoneNumber(agent.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedAgentPhone, { text: agentMessage });
            }

            // Send to customer if phone number exists
            if (customer.phone) {
                const formattedCustomerPhone = this.formatPhoneNumber(customer.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedCustomerPhone, { text: customerMessage });
            }

            return { success: true, message: 'Notification successfully sent' };
        } catch (error) {
            logger.error('Send payment notification error:', error);
            return { success: false, message: 'Failed to send notification' };
        }
    }

    // ===== BALANCE NOTIFICATIONS =====

    async sendBalanceUpdateNotification(agent, balanceData) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for balance notification');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            const message = `${formattedHeader}💰 **BALANCE UPDATED**

📋 **Detail Balance:**
• Previous Balance: Rs ${balanceData.previousBalance.toLocaleString()}
• Change: ${balanceData.change > 0 ? '+' : ''}Rs ${balanceData.change.toLocaleString()}
• Current Balance: Rs ${balanceData.currentBalance.toLocaleString()}

📝 **Description:** ${balanceData.description}

✅ Your Balance has been successfully updated.${footerInfo}`;

            if (agent.phone) {
                const formattedAgentPhone = this.formatPhoneNumber(agent.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedAgentPhone, { text: message });
            }

            return { success: true, message: 'Notification successfully sent' };
        } catch (error) {
            logger.error('Send balance notification error:', error);
            return { success: false, message: 'Failed to send notification' };
        }
    }

    // ===== REQUEST NOTIFICATIONS =====

    async sendRequestApprovedNotification(agent, requestData) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for request notification');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            const message = `${formattedHeader}✅ **BALANCE REQUEST APPROVED**

📋 **Request Details:**
• Amount: Rs ${requestData.amount.toLocaleString()}
• Request Date: ${new Date(requestData.requestedAt).toLocaleString('en-PK')}
• Approval Date: ${new Date().toLocaleString('en-PK')}

💰 **Your Balance:**
• Previous: Rs ${requestData.previousBalance.toLocaleString()}
• Current: Rs ${requestData.newBalance.toLocaleString()}

📝 **Admin Notes:** ${requestData.adminNotes || 'No notes available'}

✅ Your balance request has been approved and balance has been added.${footerInfo}`;

            if (agent.phone) {
                const formattedAgentPhone = this.formatPhoneNumber(agent.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedAgentPhone, { text: message });
            }

            return { success: true, message: 'Notification successfully sent' };
        } catch (error) {
            logger.error('Send request approved notification error:', error);
            return { success: false, message: 'Failed to send notification' };
        }
    }

    async sendRequestRejectedNotification(agent, requestData) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for request notification');
                return { success: false, message: 'WhatsApp not available' };
            }

            const settings = getSettingsWithCache();
            const companyHeader = settings.company_header || settings.app_name || 'GEMBOK-BILLING';
            const formattedHeader = companyHeader.includes('📱') ? companyHeader + '\n\n' : `📱 ${companyHeader} 📱\n\n`;
            const footerInfo = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' + (settings.footer_info || 'Powered by CyberNet');

            const message = `${formattedHeader}❌ **BALANCE REQUEST REJECTED**

📋 **Request Details:**
• Amount: Rs ${requestData.amount.toLocaleString()}
• Request Date: ${new Date(requestData.requestedAt).toLocaleString('en-PK')}
• Date Rejected: ${new Date().toLocaleString('en-PK')}

📝 **Rejection Reason:**
${requestData.rejectReason}

💡 **Suggestion:**
• Ensure balance request matches business needs
• Contact admin for more information

📞 **Help:** Contact ${settings.contact_phone || 'Admin'} for consultation.${footerInfo}`;

            if (agent.phone) {
                const formattedAgentPhone = this.formatPhoneNumber(agent.phone) + '@s.whatsapp.net';
                await this.sock.sendMessage(formattedAgentPhone, { text: message });
            }

            return { success: true, message: 'Notification successfully sent' };
        } catch (error) {
            logger.error('Send request rejected notification error:', error);
            return { success: false, message: 'Failed to send notification' };
        }
    }

    // ===== BULK NOTIFICATIONS =====

    async sendBulkNotifications(notifications) {
        try {
            if (!this.sock) {
                logger.warn('WhatsApp socket not available for bulk notifications');
                return { success: false, message: 'WhatsApp not available' };
            }

            let sent = 0;
            let failed = 0;

            for (const notification of notifications) {
                try {
                    if (notification.phone) {
                        const formattedPhone = this.formatPhoneNumber(notification.phone) + '@s.whatsapp.net';
                        await this.sock.sendMessage(formattedPhone, { text: notification.message });
                        sent++;
                        
                        // Delay between messages to avoid rate limiting
                        await this.delay(1000);
                    }
                } catch (error) {
                    failed++;
                    logger.error('Bulk notification error:', error);
                }
            }

            return { success: true, sent, failed };
        } catch (error) {
            logger.error('Send bulk notifications error:', error);
            return { success: false, message: 'Failed to send bulk notifications' };
        }
    }

    // ===== UTILITY METHODS =====

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Format phone number for WhatsApp
    formatPhoneNumber(phone) {
        if (!phone) return null;
        
        // Remove all non-digit characters
        let cleanPhone = phone.replace(/\D/g, '');
        
        // Add country code if not present
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '62' + cleanPhone.substring(1);
        } else if (!cleanPhone.startsWith('62')) {
            cleanPhone = '62' + cleanPhone;
        }
        
        return cleanPhone;
    }
}

module.exports = AgentWhatsAppManager;
