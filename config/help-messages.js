// help-messages.js - File for handling admin and customer help messages

const { getSetting, getSettingsWithCache } = require('./settingsManager');

// Footer info from settings
const FOOTER_INFO = getSetting('footer_info', 'Powered by CyberNet');

/**
 * Help message for admin
 */
function getAdminHelpMessage() {
    let message = `👨‍💼 *COMPLETE ADMIN MENU*\n\n`;

    // GenieACS Commands
    message += `🔧 *GENIEACS*\n`;
    message += `• *check [number]* — Check customer ONU status\n`;
    message += `• *checkstatus [number]* — Alias check customer status\n`;
    message += `• *checkall* — Check all devices\n`;
    message += `• *refresh* — Refresh device data\n`;
    message += `• *changessid [number] [ssid]* — Change WiFi SSID\n`;
    message += `• *changepass [number] [password]* — Change WiFi password\n`;
    message += `• *reboot [number]* — Restart customer ONU\n`;
    message += `• *tag [number] [tag]* — Add tag\n`;
    message += `• *untag [number] [tag]* — Delete tag\n`;
    message += `• *tags [number]* — View tags\n`;
    message += `• *addtag [device_id] [number]* — Add tag device\n`;
    message += `• *addpppoe_tag [user] [number]* — Add tag PPPoE\n\n`;

    // Search Commands
    message += `🔍 *SEARCH*\n`;
    message += `• *search [name/pppoe_username]* — Search customer data\n`;
    message += `• *search andi* — Search customer with name "andi"\n`;
    message += `• *search leha* — Search customer with PPPoE username "leha"\n\n`;

    // Debug Commands
    message += `🔧 *DEBUG*\n`;
    message += `• *debuggenieacs [number]* — Debug customer GenieACS data\n`;
    message += `• *debug [number]* — Debug data GenieACS (short)\n`;
    message += `• *debuggenieacs 087786722675* — Debug data GenieACS\n`;
    message += `• *listdevices* — List all devices in GenieACS\n\n`;

    // Mikrotik Commands
    message += `🌐 *MIKROTIK*\n`;
    message += `• *interfaces* — List interfaces\n`;
    message += `• *interface [name]* — Interface details\n`;
    message += `• *enableif [name]* — Enable interface\n`;
    message += `• *disableif [name]* — Disable interface\n`;
    message += `• *ipaddress* — IP Address\n`;
    message += `• *routes* — Routing table\n`;
    message += `• *dhcp* — DHCP leases\n`;
    message += `• *ping [ip] [count]* — Ping test\n`;
    message += `• *logs [topics] [count]* — Mikrotik logs\n`;
    message += `• *firewall [chain]* — Firewall status\n`;
    message += `• *users* — List users\n`;
    message += `• *profiles [type]* — List profiles\n`;
    message += `• *identity [name]* — Router info\n`;
    message += `• *clock* — Router time\n`;
    message += `• *resource* — Resource info\n`;
    message += `• *reboot* — Restart router\n\n`;

    // Hotspot & PPPoE Commands
    message += `📶 *HOTSPOT & PPPoE*\n`;
    message += `• *vcr [username] [profile] [number]* — Create voucher\n`;
    message += `• *hotspot* — Active hotspot users\n`;
    message += `• *pppoe* — Active PPPoE users\n`;
    message += `• *offline* — Offline PPPoE users\n`;
    message += `• *users* — List all users\n`;
    message += `• *addhotspot [user] [pass] [profile]* — Add user\n`;
    message += `• *addpppoe [user] [pass] [profile] [ip]* — Add PPPoE\n`;
    message += `• *setprofile [user] [profile]* — Change profile\n`;
    message += `• *remove [username]* — Delete user\n\n`;

    // OTP & System Commands
    message += `🛡️ *OTP & SYSTEM*\n`;
    message += `• *otp [number]* — Send OTP\n`;
    message += `• *status* — System status\n`;
    message += `• *logs* — Application logs\n`;
    message += `• *restart* — Restart application\n`;
    message += `• *confirm restart* — Confirm restart\n`;
    message += `• *Debug resource* — Debug resource\n`;
    message += `• *checkgroup* — Check group status & number\n`;
    message += `• *ya/iya/yes* — Confirm yes\n`;
    message += `• *tidak/no/batal* — Confirm no\n\n`;

    message += `🔧 *TROUBLE REPORT MANAGEMENT:*\n`;
    message += `• *trouble* — View list of active trouble reports\n`;
    message += `• *status [id]* — View trouble report details\n`;
    message += `• *update [id] [status] [notes]* — Update report status\n`;
    message += `• *selesai [id] [notes]* — Complete report\n`;
    message += `• *catatan [id] [notes]* — Add note\n`;
    message += `• *help trouble* — Trouble report help\n\n`;

    message += `👥 *AGENT MANAGEMENT:*\n`;
    message += `• *daftaragent* — List all agents\n`;
    message += `• *tambahagent [username] [name] [phone] [password]* — Add new agent\n`;
    message += `• *saldoagent [agent_name/agent_id]* — Check agent balance\n`;
    message += `• *tambahsaldoagent [agent_name/agent_id] [amount] [notes]* — Add agent balance\n`;
    message += `• *statistikagent* — Agent statistics\n`;
    message += `• *requestagent* — List pending balance requests\n`;
    message += `• *setujuirequest [id] [notes]* — Approve balance request\n`;
    message += `• *tolakrequest [id] [reason]* — Reject balance request\n`;
    message += `• *bantuanagent* — Agent command help\n\n`;

    message += `🌐 *PPPoE MANAGEMENT:*\n`;
    message += `• *addpppoe [user] [pass] [profile] [ip] [info]* — Add PPPoE user\n`;
    message += `• *editpppoe [user] [field] [value]* — Edit PPPoE user\n`;
    message += `• *delpppoe [user] [reason]* — Delete PPPoE user\n`;
    message += `• *pppoe [filter]* — View PPPoE users list\n`;
    message += `• *checkpppoe [user]* — Check PPPoE user status\n`;
    message += `• *restartpppoe [user]* — Restart PPPoE connection\n`;
    message += `• *help pppoe* — PPPoE help\n\n`;

    message += `ℹ️ *SYSTEM INFO:*\n`;
    message += `• *version* — Application version info\n`;
    message += `• *info* — Complete system info\n\n`;

    message += `💡 *TIPS:*\n`;
    message += `• All commands are case-insensitive\n`;
    message += `• Can use prefix ! or /\n`;
    message += `• Example: !status or /status\n\n`;

    message += `${FOOTER_INFO}`;

    return message;
}

/**
 * Help message for technicians (focus on daily tasks)
 */
function getTechnicianHelpMessage() {
    let message = `🔧 *TECHNICIAN SPECIAL MENU*\n\n`;

    // Commands most frequently used by technicians
    message += `📱 *CHECK CUSTOMER STATUS*\n`;
    message += `• *check [number]* — Check customer ONU status\n`;
    message += `• *checkstatus [number]* — Alias check customer status\n`;
    message += `• *status* — System status WhatsApp\n\n`;

    message += `🔧 *TROUBLE REPORT (HIGH PRIORITY)*\n`;
    message += `• *trouble* — View list of active trouble reports\n`;
    message += `• *status [id]* — View trouble report details\n`;
    message += `• *update [id] [status] [notes]* — Update report status\n`;
    message += `• *selesai [id] [notes]* — Complete report\n`;
    message += `• *catatan [id] [notes]* — Add note\n`;
    message += `• *help trouble* — Trouble report help\n\n`;

    message += `🌐 *PPPoE MANAGEMENT (NEW INSTALLATION)*\n`;
    message += `• *addpppoe [user] [pass] [profile] [ip] [info]* — Add PPPoE user\n`;
    message += `• *editpppoe [user] [field] [value]* — Edit PPPoE user\n`;
    message += `• *checkpppoe [user]* — Check PPPoE user status\n`;
    message += `• *restartpppoe [user]* — Restart PPPoE connection\n`;
    message += `• *help pppoe* — PPPoE help\n\n`;

    message += `🔧 *CUSTOMER DEVICES*\n`;
    message += `• *changessid [number] [ssid]* — Change WiFi SSID\n`;
    message += `• *changepass [number] [password]* — Change WiFi password\n`;
    message += `• *reboot [number]* — Restart customer ONU\n`;
    message += `• *refresh [device_id]* — Refresh device data\n\n`;

    message += `🔍 *CUSTOMER SEARCH*\n`;
    message += `• *search [name/pppoe_username]* — Search customer data\n`;
    message += `• *search andi* — Search customer with name "andi"\n`;
    message += `• *search leha* — Search customer with PPPoE username "leha"\n\n`;

    message += `🔧 *DEBUG*\n`;
    message += `• *debug [number]* — Debug customer GenieACS data\n`;
    message += `• *debuggenieacs [number]* — Complete GenieACS data debug\n`;
    message += `• *listdevices* — List all devices in GenieACS\n\n`;

    message += `🌐 *MIKROTIK (IF NEEDED)*\n`;
    message += `• *ping [ip] [count]* — Ping test\n`;
    message += `• *interfaces* — List interfaces\n`;
    message += `• *resource* — Resource info router\n\n`;

    message += `💡 *TECHNICIAN SPECIFIC TIPS:*\n`;
    message += `• Always update trouble report after completion\n`;
    message += `• Test connection before finishing\n`;
    message += `• Record all changes for audit\n`;
    message += `• Use *help trouble* or *help pppoe* for detailed help\n\n`;

    message += `📞 *SPECIAL HELP:*\n`;
    message += `• *help trouble* — Trouble report help\n`;
    message += `• *help pppoe* — PPPoE help\n`;
    message += `• *admin* — Complete admin menu\n\n`;

    message += `ℹ️ *SYSTEM INFO:*\n`;
    message += `• *version* — Application version info\n`;
    message += `• *info* — Complete system info\n\n`;

    message += `${FOOTER_INFO}`;

    return message;
}

/**
 * Help message for customers
 */
function getCustomerHelpMessage() {
    let message = `📱 *CUSTOMER MENU*\n\n`;

    message += `🔐 *REGISTRATION*\n`;
    message += `• *reg [number/name]* — Register this WhatsApp to customer account\n\n`;

    // Commands for customers
    message += `🔧 *YOUR DEVICE*\n`;
    message += `• *status* — Check your device status\n`;
    message += `• *changewifi [name]* — Change WiFi name\n`;
    message += `• *changepass [password]* — Change WiFi password\n`;
    message += `• *devices* — View WiFi connected devices\n`;
    message += `• *speedtest* — Device bandwidth info\n`;
    message += `• *diagnostic* — Network diagnostics\n`;
    message += `• *history* — Connection history\n`;
    message += `• *refresh* — Refresh device data\n\n`;

    message += `🔍 *SEARCH*\n`;
    message += `• *search [name]* — Search other customer data\n`;
    message += `• *search andi* — Search customer with name "andi"\n\n`;

    message += `📞 *HELP*\n`;
    message += `• *menu* — Show this menu\n`;
    message += `• *help* — Show help\n`;
    message += `• *info* — Service information\n\n`;

    message += `💡 *TIPS:*\n`;
    message += `• Make sure your device is registered in the system\n`;
    message += `• Use format: changewifi NewWiFiName\n`;
    message += `• Password minimum 8 characters\n\n`;

    message += `${FOOTER_INFO}`;

    return message;
}

/**
 * General help message (for non-admin)
 */
function getGeneralHelpMessage() {
    let message = `🤖 *BOT MENU*\n\n`;

    message += `📱 *FOR CUSTOMERS*\n`;
    message += `• *reg [number]* — WhatsApp registration\n`;
    message += `• *status* — Check device status\n`;
    message += `• *changewifi [name]* — Change WiFi name\n`;
    message += `• *changepass [password]* — Change WiFi password\n`;
    message += `• *menu* — Show this menu\n\n`;

    message += `👨‍💼 *FOR ADMIN*\n`;
    message += `• *admin* — Complete admin menu\n`;
    message += `• *help* — General help\n\n`;

    message += `🔧 *FOR TECHNICIANS*\n`;
    message += `• *technician* — Technician special menu\n`;
    message += `• *help* — General help\n\n`;

    message += `💡 *INFO:*\n`;
    message += `• Type *admin* for admin special menu\n`;
    message += `• Type *technician* for technician special menu\n`;
    message += `• All commands are case-insensitive\n\n`;

    message += `ℹ️ *SYSTEM INFO:*\n`;
    message += `• *version* — Application version info\n`;
    message += `• *info* — Complete system info\n\n`;

    message += `${FOOTER_INFO}`;

    return message;
}

// Billing help messages
function getBillingHelpMessage() {
    return `📊 *BILLING MENU HELP*\n\n` +
        `*Customer Management:*\n` +
        `• addcustomer [nama] [phone] [paket] - Add new customer\n` +
        `• editcustomer [phone] [field] [value] - Edit customer data\n` +
        `• delcustomer [phone] - Delete customer\n` +
        `• listcustomers - List all customers\n` +
        `• findcustomer [phone/username] - Search customer\n\n` +

        `*Payment Management:*\n` +
        `• payinvoice [invoice_id] [amount] [method] - Pay invoice\n` +
        `• tagihan [nomor_customer] - Check payment status\n` +
        `• paidcustomers - List paid customers\n` +
        `• overduecustomers - List overdue customers\n` +
        `• billingstats - Billing statistics\n\n` +

        `*Package Management:*\n` +
        `• addpackage [nama] [speed] [harga] - Add package\n` +
        `• listpackages - List all packages\n\n` +

        `*Invoice Management:*\n` +
        `• createinvoice [phone] [amount] [due_date] - Create invoice\n` +
        `• listinvoices [phone] - List customer invoices\n\n` +

        `*Usage Examples:*\n` +
        `addcustomer "John Doe" 081234567890 "Package Premium"\n` +
        `payinvoice 123 500000 cash\n` +
        `tagihan 081234567890\n` +
        `paidcustomers`;
}

/**
 * Get application version info
 */
function getVersionInfo() {
    const settings = getSettingsWithCache();

    return {
        version: settings.app_version || '1.0.0',
        versionName: settings.version_name || 'Unknown Version',
        versionDate: settings.version_date || 'Unknown Date',
        versionNotes: settings.version_notes || 'No release notes',
        buildNumber: settings.build_number || 'Unknown Build',
        companyHeader: settings.company_header || '📱 NBB Wifiber',
        footerInfo: settings.footer_info || 'Info Contact : 03036783333'
    };
}

/**
 * Format version message for WhatsApp
 */
function getVersionMessage() {
    const versionInfo = getVersionInfo();

    let message = `ℹ️ *APPLICATION VERSION INFO*\n\n`;
    message += `🏢 *${versionInfo.companyHeader}*\n\n`;
    message += `📱 *Version:* ${versionInfo.version}\n`;
    message += `📝 *Name:* ${versionInfo.versionName}\n`;
    message += `📅 *Date:* ${versionInfo.versionDate}\n`;
    message += `🔧 *Build:* ${versionInfo.buildNumber}\n`;
    message += `📋 *Notes:* ${versionInfo.versionNotes}\n\n`;
    message += `${versionInfo.footerInfo}`;

    return message;
}

/**
 * Format system info message for WhatsApp
 */
function getSystemInfoMessage() {
    const versionInfo = getVersionInfo();

    let message = `🖥️ *COMPLETE SYSTEM INFO*\n\n`;
    message += `🏢 *${versionInfo.companyHeader}*\n\n`;
    message += `📱 *Application Version:* ${versionInfo.version}\n`;
    message += `📝 *Version Name:* ${versionInfo.versionName}\n`;
    message += `📅 *Release Date:* ${versionInfo.versionDate}\n`;
    message += `🔧 *Build Number:* ${versionInfo.buildNumber}\n\n`;

    message += `⚙️ *MAIN FEATURES:*\n`;
    message += `• WhatsApp Bot with Role System\n`;
    message += `• Admin, Technician, and Customer Portal\n`;
    message += `• Trouble Report Management\n`;
    message += `• PPPoE User Management\n`;
    message += `• GenieACS Integration\n`;
    message += `• MikroTik Integration\n`;
    message += `• Billing & Invoice System\n`;
    message += `• Payment Gateway Integration\n\n`;

    message += `📋 *Release Notes:*\n`;
    message += `${versionInfo.versionNotes}\n\n`;

    message += `${versionInfo.footerInfo}`;

    return message;
}

module.exports = {
    getAdminHelpMessage,
    getTechnicianHelpMessage,
    getCustomerHelpMessage,
    getGeneralHelpMessage,
    getBillingHelpMessage,
    getVersionInfo,
    getVersionMessage,
    getSystemInfoMessage
}; 
