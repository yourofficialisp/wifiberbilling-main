const fs = require('fs');
const path = require('path');

// Function to test WhatsApp connection
async function testWhatsAppConnection() {
    try {
        console.log('Testing WhatsApp connection...');
        
        // Check if WhatsApp configuration file exists
        const whatsappConfigPath = path.join(__dirname, '../config/whatsapp.js');
        if (fs.existsSync(whatsappConfigPath)) {
            console.log('✅ WhatsApp configuration file found');
        } else {
            console.log('❌ WhatsApp configuration file not found');
            process.exit(1);
        }
        
        // Check if WhatsApp session directory exists
        const sessionDir = path.join(__dirname, '../whatsapp-session');
        if (fs.existsSync(sessionDir)) {
            console.log('✅ WhatsApp session directory found');
            
            // Check session directory contents
            const sessionFiles = fs.readdirSync(sessionDir);
            console.log(`📁 Available session files: ${sessionFiles.length} file`);
            
            if (sessionFiles.length > 0) {
                console.log('📝 Session files found:');
                sessionFiles.forEach(file => {
                    console.log(`  - ${file}`);
                });
            }
        } else {
            console.log('⚠️ WhatsApp session directory not found (will be created during connection)');
        }
        
        // Check Baileys version
        try {
            const baileysPkg = require('../package.json');
            const baileysVersion = baileysPkg.dependencies['@whiskeysockets/baileys'];
            console.log(`📱 Baileys version in use: ${baileysVersion}`);
        } catch (versionError) {
            console.log('⚠️ Cannot check Baileys version:', versionError.message);
        }
        
        // Check if node_modules @whiskeysockets/baileys exists
        const baileysNodeModulesPath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys');
        if (fs.existsSync(baileysNodeModulesPath)) {
            console.log('✅ Library @whiskeysockets/baileys found in node_modules');
        } else {
            console.log('❌ Library @whiskeysockets/baileys not found in node_modules');
            console.log('💡 Run "npm install" to install dependencies');
            process.exit(1);
        }
        
        console.log('\n✅ WhatsApp connection test completed');
        console.log('\n💡 To connect WhatsApp:');
        console.log('1. Run application with "npm start"');
        console.log('2. Wait for QR code to appear in terminal');
        console.log('3. Scan QR code with WhatsApp');
        console.log('4. Ensure internet connection is stable');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error while testing WhatsApp connection:', error.message);
        process.exit(1);
    }
}

// Run test
testWhatsAppConnection();