#!/usr/bin/env node

/**
 * Script to update WhatsApp file with new help messages
 */

const fs = require('fs');
const path = require('path');

// Function to update WhatsApp file
function updateWhatsAppFile(filePath) {
    try {
        console.log(`📝 Updating file: ${filePath}`);
        
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Import help messages
        const importHelp = `const { getAdminHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage } = require('./help-messages');`;
        
        // Check if import already exists
        if (!content.includes('require(\'./help-messages\')')) {
            // Add import after existing require statements
            const requireIndex = content.lastIndexOf('require(');
            if (requireIndex !== -1) {
                const insertIndex = content.indexOf('\n', requireIndex) + 1;
                content = content.slice(0, insertIndex) + importHelp + '\n' + content.slice(insertIndex);
            }
        }
        
        // Update sendAdminMenuList function
        const adminMenuPattern = /async function sendAdminMenuList\(remoteJid\) \{[\s\S]*?\}/;
        const newAdminMenu = `async function sendAdminMenuList(remoteJid) {
        try {
            console.log(`Displaying admin menu to ${remoteJid}`);
            
            // Use help message from separate file
            const adminMessage = getAdminHelpMessage();
            
            // Send admin menu message
            await sock.sendMessage(remoteJid, { text: adminMessage });
            console.log(`Admin menu message sent to ${remoteJid}`);
            
        } catch (error) {
            console.error('Error sending admin menu:', error);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nError displaying admin menu:\n${error.message}` 
            });
        }
    }`;
        
        if (adminMenuPattern.test(content)) {
            content = content.replace(adminMenuPattern, newAdminMenu);
        }
        
        // Update sendHelpMessage function for customer
        const helpPattern = /async function sendHelpMessage\(remoteJid\) \{[\s\S]*?\}/;
        const newHelp = `async function sendHelpMessage(remoteJid) {
        try {
            console.log(`Displaying help message to ${remoteJid}`);
            
            // Use help message from separate file
            const helpMessage = getGeneralHelpMessage();
            
            // Send help message
            await sock.sendMessage(remoteJid, { text: helpMessage });
            console.log(`Help message sent to ${remoteJid}`);
            
        } catch (error) {
            console.error('Error sending help message:', error);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nError displaying help:\n${error.message}` 
            });
        }
    }`;
        
        if (helpPattern.test(content)) {
            content = content.replace(helpPattern, newHelp);
        }
        
        // Add function for customer menu
        const customerMenuFunction = `
    // Function to display customer menu
    async function sendCustomerMenu(remoteJid) {
        try {
            console.log(`Displaying customer menu to ${remoteJid}`);
            
            // Use help message from separate file
            const customerMessage = getCustomerHelpMessage();
            
            // Send customer menu message
            await sock.sendMessage(remoteJid, { text: customerMessage });
            console.log(`Customer menu message sent to ${remoteJid}`);
            
        } catch (error) {
            console.error('Error sending customer menu:', error);
            await sock.sendMessage(remoteJid, { 
                text: `❌ *ERROR*\n\nError displaying customer menu:\n${error.message}` 
            });
        }
    }`;
        
        // Add customer menu function before module.exports
        const moduleExportsIndex = content.lastIndexOf('module.exports');
        if (moduleExportsIndex !== -1) {
            content = content.slice(0, moduleExportsIndex) + customerMenuFunction + '\n\n' + content.slice(moduleExportsIndex);
        }
        
        // Save updated file
        fs.writeFileSync(filePath, content);
        console.log(`✅ Successfully updated: ${filePath}`);
        
    } catch (error) {
        console.error(`❌ Error updating ${filePath}:`, error.message);
    }
}

// List of files that need to be updated
const filesToUpdate = [
    'config/whatsapp.js',
    'config/whatsapp_temp.js',
    'config/whatsapp_backup.js'
];

// Run update for all files
console.log('🚀 Starting help messages update...\n');

filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        updateWhatsAppFile(filePath);
    } else {
        console.log(`⚠️ File not found: ${filePath}`);
    }
});

console.log('\n✅ Update help messages completed!');
console.log('\n📋 Summary of changes:');
console.log('• Adding help-messages.js import');
console.log('• Updating sendAdminMenuList function');
console.log('• Updating sendHelpMessage function');
console.log('• Adding sendCustomerMenu function');
console.log('\n💡 Tips:');
console.log('• Restart application after update');
console.log('• Test "admin" command for admin menu');
console.log('• Test "menu" command for general menu');
console.log('• Test "customer" command for customer menu'); 