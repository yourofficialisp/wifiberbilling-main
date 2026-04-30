#!/usr/bin/env node

/**
 * Database verification script for production
 * Ensures all required tables exist in database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to the billing database
const dbPath = path.join(__dirname, '../data/billing.db');

// Tables that must exist in production
const requiredTables = [
    'invoices',
    'customers',
    'packages',
    'payments',
    'payment_gateway_transactions',
    'odps',
    'cable_routes',
    'technicians',
    'trouble_reports'  // Newly added table
];

// Columns that must exist in specific tables
const requiredColumns = {
    invoices: [
        'id', 'customer_id', 'package_id', 'invoice_number', 'amount',
        'base_amount', 'tax_rate', 'due_date', 'status', 'payment_date',
        'payment_method', 'payment_gateway', 'payment_token', 'payment_url',
        'payment_status', 'notes', 'created_at', 'description', 'invoice_type', 'package_name'
    ],
    customers: [
        'id', 'name', 'username', 'phone', 'pppoe_username', 'email', 'address',
        'latitude', 'longitude', 'package_id', 'odp_id', 'pppoe_profile',
        'status', 'auto_suspension', 'billing_day', 'whatsapp_lid', 'password'
    ],
    packages: [
        'id', 'name', 'price', 'tax_rate', 'description', 'speed',
        'status', 'created_at', 'pppoe_profile'
    ]
};

// Function to verify table existence
function verifyTablesExist(db) {
    return new Promise((resolve, reject) => {
        console.log('🔍 Verifying required table existence...');

        const missingTables = [];
        let completed = 0;

        requiredTables.forEach(tableName => {
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tableName], (err, row) => {
                if (err) {
                    console.error(`❌ Error checking table ${tableName}:`, err.message);
                    missingTables.push(tableName);
                } else if (!row) {
                    console.error(`❌ Table ${tableName} not found`);
                    missingTables.push(tableName);
                } else {
                    console.log(`✅ Table ${tableName} found`);
                }

                completed++;
                if (completed === requiredTables.length) {
                    if (missingTables.length > 0) {
                        reject(new Error(`Missing tables: ${missingTables.join(', ')}`));
                    } else {
                        resolve();
                    }
                }
            });
        });
    });
}

// Function to verify columns in table
function verifyTableColumns(db, tableName, requiredCols) {
    return new Promise((resolve, reject) => {
        console.log(`\n🔍 Verifying columns in table ${tableName}...`);

        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
            if (err) {
                reject(new Error(`Error checking columns in table ${tableName}: ${err.message}`));
                return;
            }

            const existingColumns = columns.map(col => col.name);
            const missingColumns = requiredCols.filter(col => !existingColumns.includes(col));

            if (missingColumns.length > 0) {
                console.error(`❌ Missing columns in table ${tableName}: ${missingColumns.join(', ')}`);
                reject(new Error(`Missing columns in table ${tableName}: ${missingColumns.join(', ')}`));
            } else {
                console.log(`✅ All columns in table ${tableName} complete`);
                resolve();
            }
        });
    });
}

// Main verification function
async function verifyProductionDatabase() {
    let db;

    try {
        console.log('🚀 Starting production database verification...');

        // Open database connection
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                throw new Error(`Error opening database: ${err.message}`);
            }
            console.log('✅ Connected to billing database');
        });

        // Verify tables
        await verifyTablesExist(db);

        // Verify important columns
        for (const [tableName, columns] of Object.entries(requiredColumns)) {
            await verifyTableColumns(db, tableName, columns);
        }

        console.log('\n🎉 Production database verification successful!');
        console.log('✅ All required tables exist');
        console.log('✅ All required columns exist');
        console.log('✅ Database ready for production');

        return true;

    } catch (error) {
        console.error('\n💥 Production database verification failed!');
        console.error('❌ Error:', error.message);
        return false;

    } finally {
        // Close database connection
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                } else {
                    console.log('🔒 Database connection closed');
                }
            });
        }
    }
}

// Run verification if script is executed directly
if (require.main === module) {
    verifyProductionDatabase()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Unexpected error:', error.message);
            process.exit(1);
        });
}

module.exports = { verifyProductionDatabase };
