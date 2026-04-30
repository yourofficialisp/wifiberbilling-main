#!/usr/bin/env node

// Script to test admin functionality
const fs = require('fs');
const path = require('path');

// Load settings
const { getSetting } = require('../config/settingsManager');
const settings = {};
settings.admins = getSetting('admins', []);
settings.technician_numbers = getSetting('technician_numbers', []);

console.log('=== Test Admin Functionality ===\n');

// Test admin numbers
console.log('📋 Admin Configuration:');
console.log(`Admin numbers: ${JSON.stringify(settings.admins)}`);
console.log(`Technician numbers: ${JSON.stringify(settings.technician_numbers)}`);
console.log('');

// Test isAdminNumber function
function testIsAdminNumber(number) {
    try {
        const cleanNumber = number.replace(/\D/g, '');
        
        // Check admin from settings.json
        const adminNumbers = settings.admins || [];
        for (const adminNumber of adminNumbers) {
            const cleanAdminNumber = adminNumber.replace(/\D/g, '');
            if (cleanNumber === cleanAdminNumber) {
                return true;
            }
        }
        
        // Check technician numbers from settings.json
        const technicianNumbers = settings.technician_numbers || [];
        for (const techNumber of technicianNumbers) {
            const cleanTechNumber = techNumber.replace(/\D/g, '');
            if (cleanNumber === cleanTechNumber) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('Error in testIsAdminNumber:', error);
        return false;
    }
}

// Test numbers
const testNumbers = [
    '923036783333',
    '03036783333',
    '03001234567',
    '03009876543',
    '03001112223' // Test number that is not admin
];

console.log(' Testing Admin Number Validation:');
for (const number of testNumbers) {
    const isAdmin = testIsAdminNumber(number);
    console.log(`${number}: ${isAdmin ? ' Admin' : ' Not Admin'}`);
}
console.log('');

// Test message
const testMessage = ` *TEST ADMIN BOT*\n\n` +
    ` This is a test message to verify admin functions\n` +
    ` Time: ${new Date().toLocaleString()}\n\n` +
    ` If you receive this message, it means:\n` +
    `• isAdminNumber function is working properly\n` +
    `• Message delivery to admin successful\n` +
    `• Bot is ready to use\n\n` +
    ` *NBB Wifiber*`;

console.log(' Test message to be sent:');
console.log(testMessage);
console.log('');

// Check superadmin.txt file
try {
    const superAdminPath = path.join(__dirname, '../config/superadmin.txt');
    if (fs.existsSync(superAdminPath)) {
        const superAdmin = fs.readFileSync(superAdminPath, 'utf8').trim();
        console.log(` Super admin: ${superAdmin}`);
    } else {
        console.log(' File superadmin.txt not found');
    }
} catch (error) {
    console.log(' Error reading superadmin.txt:', error.message);
}

console.log('');
console.log(' Admin test script completed.');
console.log(' Tips: Run the application with "node scripts/restart-on-error.js"');
console.log(' Test by sending "menu" or "admin" message to WhatsApp bot');