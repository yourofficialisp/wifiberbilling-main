#!/usr/bin/env node

/**
 * Script to verify invoice settings
 * Run: node scripts/verify-invoice-settings.js
 */

const fs = require('fs');
const path = require('path');

// Path to settings.json
const settingsPath = path.join(__dirname, '../settings.json');

// Fields required for invoice
const requiredFields = [
    'company_header',
    'payment_bank_name',
    'payment_account_number',
    'payment_account_holder',
    'contact_phone'
];

// Optional fields for invoice
const optionalFields = [
    'company_slogan',
    'company_website',
    'invoice_notes',
    'contact_email',
    'contact_address',
    'contact_whatsapp',
    'footer_info',
    'logo_filename'
];

// Fields used in template
const templateFields = [
    ...requiredFields,
    ...optionalFields
];

function verifySettings() {
    console.log('🔍 Verifying Invoice Settings...\n');
    
    try {
        // Read settings.json
        const settingsContent = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(settingsContent);
        
        console.log('✅ Settings.json successfully read\n');
        
        // Check required fields
        console.log('📋 Required Fields:');
        let allRequiredPresent = true;
        
        requiredFields.forEach(field => {
            if (settings[field] && settings[field].toString().trim() !== '') {
                console.log(`  ✅ ${field}: "${settings[field]}"`);
            } else {
                console.log(`  ❌ ${field}: MISSING or EMPTY`);
                allRequiredPresent = false;
            }
        });
        
        console.log('\n📋 Optional Fields:');
        optionalFields.forEach(field => {
            if (settings[field] && settings[field].toString().trim() !== '') {
                console.log(`  ✅ ${field}: "${settings[field]}"`);
            } else {
                console.log(`  ⚠️  ${field}: Not available or empty (optional)`);
            }
        });
        
        // Check logo file
        console.log('\n🖼️  Logo File:');
        const logoPath = path.join(__dirname, '../public/img', settings.logo_filename || 'logo.png');
        if (fs.existsSync(logoPath)) {
            console.log(`  ✅ Logo found: ${settings.logo_filename || 'logo.png'}`);
        } else {
            console.log(`  ❌ Logo not found: ${settings.logo_filename || 'logo.png'}`);
        }
        
        // Summary
        console.log('\n📊 SUMMARY:');
        if (allRequiredPresent) {
            console.log('  ✅ All required fields available');
        } else {
            console.log('  ❌ There are required fields that are missing or empty');
        }
        
        // Check for unused fields
        console.log('\n🔍 Fields not used in invoice:');
        const allSettingsFields = Object.keys(settings);
        const unusedFields = allSettingsFields.filter(field => !templateFields.includes(field));
        
        if (unusedFields.length > 0) {
            unusedFields.forEach(field => {
                console.log(`  ℹ️  ${field}: Not used in invoice template`);
            });
        } else {
            console.log('  ✅ All settings fields used');
        }
        
        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (!settings.company_slogan) {
            console.log('  - Add company_slogan for company tagline');
        }
        if (!settings.company_website) {
            console.log('  - Add company_website for complete information');
        }
        if (!settings.invoice_notes) {
            console.log('  - Add invoice_notes for payment information');
        }
        if (!settings.contact_email) {
            console.log('  - Add contact_email for email communication');
        }
        if (!settings.contact_address) {
            console.log('  - Add contact_address for office address');
        }
        
        console.log('\n🎯 Status: ' + (allRequiredPresent ? 'READY' : 'NEEDS ATTENTION'));
        
    } catch (error) {
        console.error('❌ Error reading settings:', error.message);
        process.exit(1);
    }
}

function showTemplateUsage() {
    console.log('\n📝 TEMPLATE USAGE:');
    console.log('Fields used in invoice-print.ejs template:');
    
    templateFields.forEach(field => {
        console.log(`  <%= appSettings.${field} %>`);
    });
    
    console.log('\n💡 Tips:');
    console.log('  - Edit settings.json to change values');
    console.log('  - No need to restart application');
    console.log('  - Refresh invoice page to see changes');
}

// Main execution
if (require.main === module) {
    verifySettings();
    showTemplateUsage();
}

module.exports = { verifySettings, showTemplateUsage };
