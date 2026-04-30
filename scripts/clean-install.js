/**
 * Script untuk membersihkan seluruh data transaksi dan log (Clean Install/Reset)
 * Namun tetap mempertahankan data Master (Package Billing & Data Customer)
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbPath = path.join(__dirname, '../data/billing.db');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database billing.db not found di:', dbPath);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

const tablesToReset = [
    'invoices',
    'payments',
    'payment_gateway_transactions',
    'expenses',
    'collector_payments',
    'collectors',
    'technicians',
    'customers',
    'packages',
    'odps',
    'cable_routes',
    'network_segments',
    'odp_connections',
    'cable_maintenance_logs',
    'app_settings',
    'system_settings'
];

console.log('🧹 Starting TOTAL data cleaning process...');
console.log('⚠️ WARNING: ALL data will be deleted (Invoice, Customer, Package, Bill, Collector)!');

db.serialize(() => {
    // Disable foreign keys temporarily to allow mass delete
    db.run('PRAGMA foreign_keys = OFF');

    let completed = 0;
    tablesToReset.forEach(table => {
        db.run(`DELETE FROM ${table}`, function (err) {
            if (err) {
                if (err.message.includes('no such table')) {
                    // console.log(`- Table ${table} does not exist yet, skipped.`);
                } else {
                    console.error(`❌ Failed to delete table ${table}:`, err.message);
                }
            } else {
                console.log(`✅ Tabel ${table} successful dikosongkan.`);
                // Reset auto-increment counter
                db.run(`UPDATE sqlite_sequence SET seq = 0 WHERE name = '${table}'`);
            }

            completed++;
            if (completed === tablesToReset.length) {
                finish();
            }
        });
    });

    function finish() {
        db.run('PRAGMA foreign_keys = ON', () => {
            console.log('\n✨ CLEANUP COMPLETE!');
            console.log('System is now clean but Customer & Package data remains intact.');
            console.log('Please restart the application.');
            db.close();
        });
    }
});
