const fs = require('fs');
const path = require('path');

// Function to check compatible WhatsApp Web version
async function checkWhatsAppVersion() {
    try {
        console.log('Checking compatible WhatsApp Web version...');
        
        // Baileys version being used
        const baileysPkg = require('../package.json');
        const baileysVersion = baileysPkg.dependencies['@whiskeysockets/baileys'];
        console.log(`Versi Baileys yang diinstal: ${baileysVersion}`);
        
        // Check if node_modules directory exists
        const nodeModulesPath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys');
        if (fs.existsSync(nodeModulesPath)) {
            console.log('Baileys directory found');
            
            // Check package.json version in node_modules
            try {
                const installedPkg = require('../node_modules/@whiskeysockets/baileys/package.json');
                console.log(`Versi Baileys yang terinstal: ${installedPkg.version}`);
            } catch (pkgError) {
                console.log('Cannot read package.json from node_modules');
            }
            
            // Check WhatsApp Web version
            try {
                const versionFilePath = path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Defaults/baileys-version.json');
                if (fs.existsSync(versionFilePath)) {
                    const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
                    console.log('Current WhatsApp Web version:', versionData);
                } else {
                    console.log('Version file not found, using default version');
                }
            } catch (versionError) {
                console.log('Cannot read WhatsApp Web version:', versionError.message);
            }
        } else {
            console.log('Direktori node_modules/@whiskeysockets/baileys not found');
        }
        
        console.log('✅ WhatsApp version check completed');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error checking WhatsApp version:', error.message);
        process.exit(1);
    }
}

// Run check
checkWhatsAppVersion();