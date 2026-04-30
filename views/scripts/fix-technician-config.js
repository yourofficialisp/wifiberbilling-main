#!/usr/bin/env node

/**
 * Script to fix technician configuration
 * Removing invalid numbers and fixing format
 */

const fs = require('fs');
const path = require('path');

// Load settings
const settingsPath = path.join(__dirname, '..', 'settings.json');
let settings = {};

try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    console.log('✅ Settings loaded successfully');
} catch (error) {
    console.error('❌ Error loading settings:', error.message);
    process.exit(1);
}

// Function to clean phone number
function cleanPhoneNumber(number) {
    if (!number) return null;
    
    // Remove all non-digit characters
    let cleaned = number.replace(/\D/g, '');
    
    // If starts with 0, replace with 62
    if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.substring(1);
    }
    
    // If not starting with 62, add it
    if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
    }
    
    // Ensure length is at least 12 digits (62 + 10 digit number)
    if (cleaned.length < 12) {
        return null;
    }
    
    return cleaned;
}

// Function to validate group ID
function validateGroupId(groupId) {
    if (!groupId) return false;
    
    // Group ID format must be: number@g.us
    const groupIdPattern = /^\d+@g\.us$/;
    return groupIdPattern.test(groupId);
}

// Fix configuration
function fixTechnicianConfig() {
    console.log('\n🔧 Fixing technician configuration...\n');
    
    let hasChanges = false;
    
    // Fix technician numbers
    const technicianNumbers = [];
    let i = 0;
    
    while (settings[`technician_numbers.${i}`]) {
        const number = settings[`technician_numbers.${i}`];
        const cleanedNumber = cleanPhoneNumber(number);
        
        if (cleanedNumber) {
            technicianNumbers.push(cleanedNumber);
            if (number !== cleanedNumber) {
                console.log(`📞 Fixed technician number ${i + 1}: ${number} → ${cleanedNumber}`);
                hasChanges = true;
            }
        } else {
            console.log(`❌ Removed invalid technician number ${i + 1}: ${number}`);
            hasChanges = true;
        }
        
        i++;
    }
    
    // Update cleaned technician numbers
    technicianNumbers.forEach((number, index) => {
        settings[`technician_numbers.${index}`] = number;
    });
    
    // Remove invalid numbers
    let j = technicianNumbers.length;
    while (settings[`technician_numbers.${j}`]) {
        delete settings[`technician_numbers.${j}`];
        j++;
    }
    
    // Fix group ID
    const currentGroupId = settings.technician_group_id;
    if (currentGroupId && !validateGroupId(currentGroupId)) {
        console.log(`❌ Invalid group ID format: ${currentGroupId}`);
        console.log('💡 Group ID must be in format: 120363029715729111@g.us');
        console.log('💡 Please update manually in Admin Settings');
    }
    
    // Also fix admin numbers
    const adminNumbers = [];
    let k = 0;
    
    // Check old format (admins.0) and new format (admin_numbers.0)
    while (settings[`admin_numbers.${k}`] || settings[`admins.${k}`]) {
        const number = settings[`admin_numbers.${k}`] || settings[`admins.${k}`];
        const cleanedNumber = cleanPhoneNumber(number);
        
        if (cleanedNumber) {
            adminNumbers.push(cleanedNumber);
            if (number !== cleanedNumber) {
                console.log(`📞 Fixed admin number ${k + 1}: ${number} → ${cleanedNumber}`);
                hasChanges = true;
            }
        } else {
            console.log(`❌ Removed invalid admin number ${k + 1}: ${number}`);
            hasChanges = true;
        }
        
        k++;
    }
    
    // Update cleaned admin numbers (use new format)
    adminNumbers.forEach((number, index) => {
        settings[`admin_numbers.${index}`] = number;
        // Delete old format if exists
        delete settings[`admins.${index}`];
    });
    
    // Remove invalid admin numbers (old and new formats)
    let l = adminNumbers.length;
    while (settings[`admin_numbers.${l}`] || settings[`admins.${l}`]) {
        delete settings[`admin_numbers.${l}`];
        delete settings[`admins.${l}`];
        l++;
    }
    
    // Save changes if any
    if (hasChanges) {
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            console.log('\n✅ Settings successfully fixed and saved');
        } catch (error) {
            console.error('❌ Error saving settings:', error.message);
            return;
        }
    } else {
        console.log('\n✅ No changes required');
    }
    
    // Show summary
    console.log('\n📊 CONFIGURATION SUMMARY:');
    console.log('========================');
    
    console.log('\n👥 Admin Numbers:');
    if (adminNumbers.length > 0) {
        adminNumbers.forEach((number, index) => {
            console.log(`  ${index + 1}. ${number}`);
        });
    } else {
        console.log('  ❌ No valid admin numbers');
    }
    
    console.log('\n🔧 Technician Numbers:');
    if (technicianNumbers.length > 0) {
        technicianNumbers.forEach((number, index) => {
            console.log(`  ${index + 1}. ${number}`);
        });
    } else {
        console.log('  ❌ No valid technician numbers');
    }
    
    console.log('\n📱 Technician Group:');
    if (settings.technician_group_id) {
        if (validateGroupId(settings.technician_group_id)) {
            console.log(`  ✅ ${settings.technician_group_id}`);
        } else {
            console.log(`  ❌ ${settings.technician_group_id} (incorrect format)`);
        }
    } else {
        console.log('  ❌ Not configured');
    }
    
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Restart application: node app.js');
    console.log('2. Test with command: checkgroup');
    console.log('3. Ensure bot is added to technician group');
    console.log('4. Test message sending to technician numbers');
}

// Run fix
if (require.main === module) {
    fixTechnicianConfig();
}

module.exports = { fixTechnicianConfig, cleanPhoneNumber, validateGroupId }; 