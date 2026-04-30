#!/usr/bin/env node

/**
 * Script untuk mempersiapkan project untuk diunggah ke GitHub
 * Remove sensitive data and replace with dummy data
 */

const fs = require('fs');
const path = require('path');

// Function to remove sensitive files
function removeSensitiveFiles() {
    const sensitiveFiles = [
        'config/superadmin.txt',
        'data/billing.db',
        'data/billing.db-shm',
        'data/billing.db-wal',
        'data/billing.db.backup'
    ];
    
    console.log('🗑️  Removing sensitive files...');
    
    sensitiveFiles.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`  ✅ Dihapus: ${file}`);
            } catch (error) {
                console.log(`  ⚠️  Failed to delete: ${file} - ${error.message}`);
            }
        } else {
            console.log(`  ℹ️  Not found: ${file}`);
        }
    });
}

// Function to create dummy configuration files
function createDummyConfigFiles() {
    console.log('\n📝 Creating dummy configuration files...');
    
    // Create empty superadmin.txt
    const superadminPath = path.join(__dirname, '..', 'config', 'superadmin.txt');
    try {
        fs.writeFileSync(superadminPath, '');
        console.log('  ✅ Created: config/superadmin.txt (empty)');
    } catch (error) {
        console.log(`  ⚠️  Failed to create superadmin.txt: ${error.message}`);
    }
    
    // Create .env.example
    const envExamplePath = path.join(__dirname, '..', '.env.example');
    const envExampleContent = `# Example file konfigurasi environment
# Salin file ini ke .env dan sesuaikan nilainya

# Database
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=gembok_bill

# WhatsApp
WHATSAPP_SESSION_PATH=./whatsapp-session
ADMIN_NUMBER=6281234567890

# Mikrotik
MIKROTIK_HOST=192.168.1.1
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=password

# GenieACS
GENIEACS_URL=http://localhost:7557
GENIEACS_USERNAME=admin
GENIEACS_PASSWORD=password

# Payment Gateway
MIDTRANS_SERVER_KEY=your_midtrans_server_key
MIDTRANS_CLIENT_KEY=your_midtrans_client_key

# Xendit
XENDIT_SECRET_KEY=your_xendit_secret_key

# Application
PORT=3000
NODE_ENV=development
SECRET_KEY=your_secret_key_here
`;
    
    try {
        fs.writeFileSync(envExamplePath, envExampleContent);
        console.log('  ✅ Created: .env.example');
    } catch (error) {
        console.log(`  ⚠️  Failed to create .env.example: ${error.message}`);
    }
}

// Fungsi untuk membersihkan file konfigurasi
function cleanConfigFiles() {
    console.log('\n🧼 Membersihkan file konfigurasi...');
    
    // File konfigurasi yang mungkin mengandung data sensitif
    const configFiles = [
        'config/settingsManager.js'
    ];
    
    // For now, we only give a warning
    // Because this file may contain important logic that should not be changed
    configFiles.forEach(file => {
        console.log(`  ℹ️  Check and ensure no sensitive data in: ${file}`);
    });
}

// Function to create empty database
function createEmptyDatabase() {
    console.log('\n💾 Creating empty database...');
    
    // Create empty database file for reference
    const emptyDbPath = path.join(__dirname, '..', 'data', 'empty-database.sql');
    const emptyDbContent = `-- Database schema kosong untuk Gembok Bill
-- Use migration files in migrations/ folder to create database structure
    
-- Example struktur tabel dasar (lihat file migrations/ untuk detail lengkap)
-- CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT);
-- CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT);
-- CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, status TEXT);
`;
    
    try {
        fs.writeFileSync(emptyDbPath, emptyDbContent);
        console.log('  ✅ Created: data/empty-database.sql');
    } catch (error) {
        console.log(`  ⚠️  Failed to create empty-database.sql: ${error.message}`);
    }
}

// Function to create README for data
function createDataReadme() {
    console.log('\n📄 Creating data documentation...');
    
    const readmePath = path.join(__dirname, '..', 'DATA_README.md');
    const readmeContent = `# Data Management untuk Gembok Bill

## Struktur Database

Database uses SQLite and table structure is defined in migration files in the [`migrations/`](file:///e:/gembok-bill211025/migrations) folder.

## Inisialisasi Data Awal

For new server, run the following command:

\`\`\`bash
npm run setup
\`\`\`

This will:
1. Install all dependencies
2. Run all migration files to create database structure
3. Create initial data that is needed

## Migration Files

All migration files are located in the [migrations/](file:///e:/gembok-bill211025/migrations) folder and are run in sequence based on file name.

## Environment Configuration

Salin file [.env.example](file:///e:/gembok-bill211025/.env.example) ke .env dan sesuaikan nilainya:

\`\`\`bash
cp .env.example .env
\`\`\`

Then edit the .env file with the correct configuration for your environment.

## Security

- Never include .env file or other sensitive data in repository
- Use .env.example as template for configuration
- Make sure config/superadmin.txt only contains the correct number
`;

    try {
        fs.writeFileSync(readmePath, readmeContent);
        console.log('  Created: DATA_README.md');
    } catch (error) {
        console.log(`  ⚠️  Failed to create DATA_README.md: ${error.message}`);
    }
}

// Fungsi utama
async function main() {
    console.log('🚀 Starting GitHub project preparation...\n');
    
    try {
        removeSensitiveFiles();
        createDummyConfigFiles();
        cleanConfigFiles();
        createEmptyDatabase();
        createDataReadme();
        
        console.log('\n✅ Preparation completed!');
        console.log('\n📋 Next steps:');
        console.log('1. Check generated files');
        console.log('2. Ensure no sensitive data remains');
        console.log('3. Commit dan push ke GitHub');
        console.log('4. For new server, use "npm run setup" for initialization');
    } catch (error) {
        console.error('\n❌ Error occurred:', error.message);
        process.exit(1);
    }
}

// Run script
if (require.main === module) {
    main();
}

module.exports = {
    removeSensitiveFiles,
    createDummyConfigFiles,
    cleanConfigFiles,
    createEmptyDatabase,
    createDataReadme
};