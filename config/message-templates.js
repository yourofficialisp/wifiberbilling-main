/**
 * Message Templates Helper
 * Centralized message templates with settings integration
 */

const { getSetting } = require('./settingsManager');

/**
 * Get developer support message footer
 * @returns {string} Developer support message or empty string if disabled
 */
function getDeveloperSupportMessage() {
    const devSupport = getSetting('developer_support', {});
    
    // Check if developer support is enabled and should show in messages
    if (!devSupport.enabled || !devSupport.show_in_messages) {
        return '';
    }
    
    let message = '\n\n';
    message += `📞 *Developer Support:*\n`;
    
    if (devSupport.ewallet_number) {
        message += `• E-WALLET: ${devSupport.ewallet_number}\n`;
    }
    
    if (devSupport.bank_name && devSupport.bank_account) {
        message += `• ${devSupport.bank_name}: ${devSupport.bank_account}`;
        if (devSupport.bank_holder) {
            message += ` a.n ${devSupport.bank_holder}`;
        }
        message += `\n`;
    }
    
    message += `\n`;
    
    if (devSupport.support_message) {
        message += `🙏 ${devSupport.support_message}\n`;
    }
    
    if (devSupport.company_name) {
        message += `🏢 *${devSupport.company_name}*`;
    }
    
    return message;
}

/**
 * Get company header from settings
 * @param {string} defaultHeader - Default header if not set in settings
 * @returns {string} Company header
 */
function getCompanyHeader(defaultHeader = '📱 NBB Wifiber') {
    return getSetting('company_header', defaultHeader);
}

/**
 * Get footer info from settings
 * @param {string} defaultFooter - Default footer if not set in settings
 * @returns {string} Footer info
 */
function getFooterInfo(defaultFooter = 'Thank you') {
    return getSetting('footer_info', defaultFooter);
}

/**
 * Get payment info message
 * @returns {string} Payment information message
 */
function getPaymentInfoMessage() {
    const bankName = getSetting('payment_bank_name', '');
    const accountNumber = getSetting('payment_account_number', '');
    const accountHolder = getSetting('payment_account_holder', '');
    const cashAddress = getSetting('payment_cash_address', '');
    const cashHours = getSetting('payment_cash_hours', '');
    
    if (!bankName && !cashAddress) {
        return '';
    }
    
    let message = '\n🏦 *PAYMENT INFORMATION*\n';
    
    if (bankName && accountNumber) {
        message += `\n💳 *Bank Transfer:*\n`;
        message += `• Bank: ${bankName}\n`;
        message += `• Account Number: ${accountNumber}\n`;
        if (accountHolder) {
            message += `• A/N: ${accountHolder}\n`;
        }
    }
    
    if (cashAddress) {
        message += `\n💵 *Cash Payment:*\n`;
        message += `• Address: ${cashAddress}\n`;
        if (cashHours) {
            message += `• Operating Hours: ${cashHours}\n`;
        }
    }
    
    return message;
}

/**
 * Get contact info message
 * @returns {string} Contact information message
 */
function getContactInfoMessage() {
    const phone = getSetting('contact_phone', '');
    const whatsapp = getSetting('contact_whatsapp', '');
    const email = getSetting('contact_email', '');
    const address = getSetting('contact_address', '');
    
    if (!phone && !whatsapp && !email && !address) {
        return '';
    }
    
    let message = '\n📞 *CONTACT US*\n';
    
    if (phone) {
        message += `• Phone: ${phone}\n`;
    }
    
    if (whatsapp) {
        message += `• WhatsApp: ${whatsapp}\n`;
    }
    
    if (email) {
        message += `• Email: ${email}\n`;
    }
    
    if (address) {
        message += `• Address: ${address}\n`;
    }
    
    return message;
}

module.exports = {
    getDeveloperSupportMessage,
    getCompanyHeader,
    getFooterInfo,
    getPaymentInfoMessage,
    getContactInfoMessage
};
