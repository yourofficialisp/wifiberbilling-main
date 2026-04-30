#!/usr/bin/env node

/**
 * Script untuk test menu admin dan customer
 */

const { getAdminHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage } = require('../config/help-messages');

console.log('🧪 TEST MENU WHATSAPP BOT\n');

// Test menu admin
console.log('📋 MENU ADMIN:');
console.log('='.repeat(50));
console.log(getAdminHelpMessage());
console.log('\n');

// Test menu customer
console.log('📱 CUSTOMER MENU:');
console.log('='.repeat(50));
console.log(getCustomerHelpMessage());
console.log('\n');

// Test menu umum
console.log('🤖 GENERAL MENU:');
console.log('='.repeat(50));
console.log(getGeneralHelpMessage());
console.log('\n');

console.log('✅ Test menu completed!');
console.log('\n💡 How to use:');
console.log('• Send "admin" to bot for admin menu');
console.log('• Send "customer" or "customer" for customer menu');
console.log('• Send "menu" or "help" for general menu');
console.log('\n🔧 Test commands:');
console.log('• admin - Complete admin menu');
console.log('• customer - Customer menu');
console.log('• customer - Customer menu (alias)');
console.log('• menu - General menu');
console.log('• help - General menu (alias)'); 