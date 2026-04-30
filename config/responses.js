// Collection of bot responses for various questions and commands

const { getSetting } = require('./settingsManager');

// Format message with header and footer
function formatWithHeaderFooter(message) {
    const COMPANY_HEADER = getSetting('company_header', "📱 NBB Wifiber 📱\n\n");
    const FOOTER_SEPARATOR = "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
    const FOOTER_INFO = FOOTER_SEPARATOR + getSetting('footer_info', "Powered by CyberNet");
    
    return `${COMPANY_HEADER}${message}${FOOTER_INFO}`;
}

// Response for help/menu commands
const menuResponse = `*COMMAND LIST*

*Mikrotik:*
• *resource* - Info resource router
• *hotspot* - List user hotspot aktif
• *pppoe* - List koneksi PPPoE aktif
• *offline* - List user PPPoE offline
• *addhotspot [user] [pass] [profile]* - Add user hotspot
• *delhotspot [user]* - Delete user hotspot
• *addpppoe [user] [pass] [profile] [ip]* - Add secret PPPoE
• *delpppoe [user]* - Delete secret PPPoE
• *setprofile [user] [profile]* - Edit profile PPPoE

*GenieACS:*
• *status* - Cek status perangkat
• *info wifi* - Info WiFi You
• *gantiwifi [nama]* - Ganti nama WiFi
• *gantipass [password]* - Ganti password WiFi
• *restart* - Restart perangkat
• *addwan [no] [tipe] [mode]* - Add WAN
• *addtag [device] [no]* - Add tag customer
• *addpppoe_tag [user] [no]* - Add tag via PPPoE`;

// Respons untuk pertanyaan tentang WiFi/SSID
const wifiResponses = [
    {
        title: "Cara Ganti Name WiFi (SSID) dan Password",
        content: `Halo Kak! 👋

Mau ganti nama WiFi atau passwordnya? Gampang banget kok! Ikuti langkah-langkah berikut ya:

*📱 Lewat WhatsApp*
Ketik perintah berikut:
• *gantiwifi [nama]* - untuk ubah nama WiFi
• *gantipass [password]* - untuk ubah password WiFi
Example: gantiwifi RumahKu atau gantipass Pass123Aman

*📱 Lewat Aplikasi ISP Monitor*
1. Login ke aplikasi ISP Monitor dengan nomor customer Kakak
2. Login ke menu Dashboard
3. Tekan tombol "WiFi Settings"
4. Ganti nama SSID (nama WiFi) dan password sesuai keinginan
5. Tekan "Save" dan tunggu beberapa detik sampai perangkat ter-update

*🌐 Lewat Device ONT Langsung*
1. Buka browser dan ketik 192.168.1.1 di address bar
2. Login dengan username & password admin (bisa ditanyakan ke teknisi kami)
3. Search menu "WLAN" atau "Wireless"
4. Edit nama SSID dan password
5. Save perubahan dan restart jika diperlukan

If still confused, you can chat our CS for further assistance! 😊

#KoneksiStabil #WiFiNgebut`
    },
    {
        title: "Tips for Optimal WiFi Speed",
        content: `Hai Customer Setia! ✨

Biar WiFi makin ngebut, coba tips berikut ini:

*🚀 WiFi Settings Optimal:*
1. Gunakan nama WiFi (SSID) yang unik tanpa characters khusus
2. Select password yang kuat (min. 8 characters kombinasi huruf & angka)
3. Untuk perangkat terbaru, pisahkan jaringan 2.4GHz & 5GHz untuk performa terbaik
   - 2.4GHz: jangkauan lebih jauh, cocok untuk browsing biasa
   - 5GHz: lebih cepat tapi jangkauan lebih pendek, ideal untuk streaming & gaming

*📍 Penempatan Router:*
- Letakkan di tengah rumah/ruangan
- Hindari dekat barang elektronik lain & tembok tebal

Need help with settings? Please reply to this chat! 🙌

#InternetCepat #WiFiLancar`
    },
    {
        title: "Panduan Pengamanan Jaringan WiFi",
        content: `Halo Kak! 🔐

Keamanan WiFi itu penting banget nih! Berikut tips mengamankan jaringan WiFi Kakak:

*🛡️ Settings Keamanan WiFi:*
1. Ganti nama WiFi (SSID) default jadi nama yang tidak mudah ditebak
2. Pakai password yang kuat (min. 12 characters, kombinasi huruf besar-kecil, angka, & simbol)
3. Aktifkan enkripsi WPA3 (atau at least WPA2) di pengaturan router
4. Sembunyikan SSID jika perlu (router tidak akan muncul di daftar WiFi umum)
5. Update firmware router secara berkala

Never share your WiFi password with anyone! If you need help setting up security, our technical team is ready to assist 🚀

#WiFiAman #PrivasiTerjaga`
    }
];

// Respons untuk perintah status
const statusResponse = (data) => {
    return `📰 *STATUS PERANGKAT*

• Status: ${data.isOnline ? '🟢 Online' : '❌ Offline'}
• Serial Number: ${data.serialNumber}
• Firmware: ${data.firmware}
• Uptime: ${data.uptime}
• Signal (RX): ${data.rxPower} dBm
• IP PPPoE: ${data.pppoeIP}
• Username PPPoE: ${data.pppUsername}
• SSID 2.4GHz: ${data.ssid}
• SSID 5GHz: ${data.ssid5G}
• Connected Devices: ${data.connectedUsers}

Last Inform: ${data.lastInform}

Untuk informasi WiFi lengkap, kirim: info wifi
Untuk restart perangkat, kirim: restart`;
};

// Respons untuk perintah info wifi
const wifiInfoResponse = (data) => {
    return `📶 *Informasi WiFi You*

*SSID 2.4GHz:* ${data.ssid}
*SSID 5GHz:* ${data.ssid5G}

Untuk mengganti nama WiFi, kirim:
gantiwifi NamaBaruYou

To change your WiFi password, type:
gantipass NewPassword`;
};

// Respons untuk perintah ganti wifi
const changeWifiResponse = {
    processing: (newSSID) => `⏳ *Processing Request*

Changing WiFi name to "${newSSID}"...
This process will take a few minutes.`,
    
    success: (newSSID) => `✅ *WIFI NAME CHANGED SUCCESSFULLY*

New WiFi name: ${newSSID}

Your device will restart in a few minutes and WiFi will be available with the new name.`,
    
    error: (error) => `❌ *ERROR*

Error changing WiFi name: ${error}`,
    
    invalidFormat: `❌ *FORMAT SALAH*

Name WiFi harus antara 3-32 characters.

Example: gantiwifi MyHome`
};

// Respons untuk perintah ganti password
const changePasswordResponse = {
    processing: `⏳ *Processing Request*

Changing WiFi password...
This process will take a few minutes.`,
    
    success: `✅ *PASSWORD WIFI CHANGED SUCCESSFULLY*

New WiFi password has been set.

Your device will restart in a few minutes and WiFi will be available with the new password.`,
    
    error: (error) => `❌ *ERROR*

Error changing WiFi password: ${error}`,
    
    invalidFormat: `❌ *FORMAT SALAH*

Password WiFi harus antara 8-63 characters.

Example: gantipass Password123`
};

// Respons untuk perintah restart
const restartResponse = {
    confirmation: `⚠️ *KONFIRMASI RESTART*

Are you sure you want to restart the device? All internet and WiFi connections will be disconnected for a few minutes.

Reply with *yes* to continue or *no* to cancel.`,
    
    processing: `⏳ *Processing Request*

Restarting your device...
This process will take a few minutes.`,
    
    success: `✅ *RESTART SENT SUCCESSFULLY*

Your device will restart in a few minutes. Internet and WiFi connections will be temporarily disconnected during the restart process.`,
    
    cancelled: `✅ *RESTART CANCELLED*

Device restart request has been cancelled.`,
    
    expired: `❌ *CONFIRMATION EXPIRED*

Restart request has expired. Please send restart command again if you still want to restart the device.`,
    
    error: (error) => `❌ *ERROR*

Terjadi kesalahan saat me-restart perangkat: ${error}`
};

// Response for device not found
const deviceNotFoundResponse = `❌ *DEVICE NOT FOUND*

Sorry, your device is not found in our system. Please contact admin for assistance.`;

// Response for general error
const generalErrorResponse = (error) => `❌ *ERROR*

An error occurred: ${error}

Please try again later.`;

// Fungsi untuk mendapatkan respons berdasarkan kata kunci
function getResponseByKeywords(message) {
    const lowerMessage = message.toLowerCase();
    
    // Deteksi kata kunci terkait WiFi/SSID
    if (containsWifiKeywords(lowerMessage)) {
        // Logika untuk memilih respons yang paling sesuai
        if (lowerMessage.includes('ganti') || lowerMessage.includes('ubah') || 
            lowerMessage.includes('cara') || lowerMessage.includes('bagaimana')) {
            // This is a question about how to change WiFi
            return wifiResponses[0];
        } else if (lowerMessage.includes('lemot') || lowerMessage.includes('lambat') || 
                  lowerMessage.includes('cepat') || lowerMessage.includes('kencang') ||
                  lowerMessage.includes('ngebut')) {
            // Ini pertanyaan tentang kecepatan
            return wifiResponses[1];
        } else if (lowerMessage.includes('aman') || lowerMessage.includes('keamanan') || 
                  lowerMessage.includes('bahaya') || lowerMessage.includes('bobol')) {
            // Ini pertanyaan tentang keamanan
            return wifiResponses[2];
        }
        
        // Select respons secara random dari array wifiResponses jika tidak ada yang spesifik
        return wifiResponses[Math.floor(Math.random() * wifiResponses.length)];
    }
    
    // Backkan null jika tidak ada keyword yang cocok
    return null;
}

// Helper function untuk cek apakah pesan mengandung kata kunci terkait WiFi
function containsWifiKeywords(message) {
    const wifiKeywords = ['wifi', 'ssid', 'password', 'internet', 'router', 'modem', 'koneksi'];
    return wifiKeywords.some(keyword => message.includes(keyword));
}

module.exports = {
    formatWithHeaderFooter,
    menuResponse,
    wifiResponses,
    statusResponse,
    wifiInfoResponse,
    changeWifiResponse,
    changePasswordResponse,
    restartResponse,
    deviceNotFoundResponse,
    generalErrorResponse,
    getResponseByKeywords
};
