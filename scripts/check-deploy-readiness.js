#!/usr/bin/env node

/**
 * Script to check deployment readiness via GitHub
 * Ensure all components will run normally after git clone + npm install
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

class DeployReadinessChecker {
    constructor() {
        this.projectRoot = path.join(__dirname, '..');
        this.requiredFiles = [
            'package.json',
            'app.js',
            'settings.json',
            'config/billing.js',
            'config/whatsapp.js',
            'config/mikrotik.js',
            'config/genieacs.js',
            'config/logger.js',
            'config/settingsManager.js'
        ];
        this.requiredDirs = [
            'config',
            'routes',
            'views',
            'public',
            'data',
            'logs',
            'whatsapp-session'
        ];
    }

    async checkRequiredFiles() {
        console.log('📁 Checking required files...');
        
        const missingFiles = [];
        
        this.requiredFiles.forEach(file => {
            const filePath = path.join(this.projectRoot, file);
            if (!fs.existsSync(filePath)) {
                missingFiles.push(file);
            }
        });

        if (missingFiles.length === 0) {
            console.log('✅ All required files are available');
        } else {
            console.log('❌ File yang hilang:');
            missingFiles.forEach(file => console.log(`  - ${file}`));
        }

        return missingFiles.length === 0;
    }

    async checkRequiredDirectories() {
        console.log('📂 Checking required directories...');
        
        const missingDirs = [];
        
        this.requiredDirs.forEach(dir => {
            const dirPath = path.join(this.projectRoot, dir);
            if (!fs.existsSync(dirPath)) {
                missingDirs.push(dir);
            }
        });

        if (missingDirs.length === 0) {
            console.log('✅ All required directories are available');
        } else {
            console.log('❌ Direktori yang hilang:');
            missingDirs.forEach(dir => console.log(`  - ${dir}`));
        }

        return missingDirs.length === 0;
    }

    async checkPackageJson() {
        console.log('📦 Checking package.json...');
        
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf8'));
            
            // Check critical dependencies
            const criticalDeps = [
                'express',
                'sqlite3',
                'axios',
                'ejs',
                'exceljs',
                'multer',
                'node-cron',
                'winston'
            ];

            const missingDeps = criticalDeps.filter(dep => !packageJson.dependencies[dep]);
            
            if (missingDeps.length === 0) {
                console.log('✅ Semua dependencies penting tersedia');
            } else {
                console.log('❌ Dependencies yang hilang:');
                missingDeps.forEach(dep => console.log(`  - ${dep}`));
            }

            return missingDeps.length === 0;
        } catch (error) {
            console.log('❌ Error membaca package.json:', error.message);
            return false;
        }
    }

    async checkSettingsJson() {
        console.log('⚙️ Checking settings.json...');
        
        try {
            const settings = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'settings.json'), 'utf8'));
            
            // Check critical settings
            const criticalSettings = [
                'server_host',
                'server_port',
                'admin_username',
                'admin_password',
                'genieacs_url',
                'mikrotik_host'
            ];

            const missingSettings = criticalSettings.filter(setting => !settings[setting]);
            
            if (missingSettings.length === 0) {
                console.log('✅ Semua setting penting tersedia');
            } else {
                console.log('❌ Setting yang hilang:');
                missingSettings.forEach(setting => console.log(`  - ${setting}`));
            }

            return missingSettings.length === 0;
        } catch (error) {
            console.log('❌ Error membaca settings.json:', error.message);
            return false;
        }
    }

    async checkDatabaseStructure() {
        console.log('🗄️ Checking database structure...');
        
        const dbPath = path.join(this.projectRoot, 'data/billing.db');
        
        if (!fs.existsSync(dbPath)) {
            console.log('⚠️  Database not found, will be created automatically on first run');
            return true;
        }

        try {
            const db = new sqlite3.Database(dbPath);
            
            // Check critical tables
            const tables = await new Promise((resolve, reject) => {
                db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows.map(row => row.name));
                });
            });

            const requiredTables = ['customers', 'packages', 'technicians', 'odps', 'invoices'];
            const missingTables = requiredTables.filter(table => !tables.includes(table));
            
            if (missingTables.length === 0) {
                console.log('✅ Semua tabel database tersedia');
            } else {
                console.log('❌ Tabel yang hilang:');
                missingTables.forEach(table => console.log(`  - ${table}`));
            }

            db.close();
            return missingTables.length === 0;
        } catch (error) {
            console.log('❌ Error checking database:', error.message);
            return false;
        }
    }

    async checkBackupRestoreFunctionality() {
        console.log('💾 Checking backup/restore feature...');
        
        // Check if backup/restore route exists
        const adminSettingFile = path.join(this.projectRoot, 'routes/adminSetting.js');
        
        if (!fs.existsSync(adminSettingFile)) {
            console.log('❌ File routes/adminSetting.js not found');
            return false;
        }

        const content = fs.readFileSync(adminSettingFile, 'utf8');
        
        const requiredRoutes = [
            'router.post(\'/backup\'',
            'router.post(\'/restore\'',
            'router.get(\'/backups\''
        ];

        const missingRoutes = requiredRoutes.filter(route => !content.includes(route));
        
        if (missingRoutes.length === 0) {
            console.log('✅ Fitur backup/restore tersedia');
        } else {
            console.log('❌ Route backup/restore yang hilang:');
            missingRoutes.forEach(route => console.log(`  - ${route}`));
        }

        return missingRoutes.length === 0;
    }

    async checkExportFunctionality() {
        console.log('📊 Checking Excel export feature...');
        
        const adminBillingFile = path.join(this.projectRoot, 'routes/adminBilling.js');
        
        if (!fs.existsSync(adminBillingFile)) {
            console.log('❌ File routes/adminBilling.js not found');
            return false;
        }

        const content = fs.readFileSync(adminBillingFile, 'utf8');
        
        const requiredExports = [
            'router.get(\'/export/customers.xlsx\'',
            'ExcelJS',
            'workbook.xlsx.write'
        ];

        const missingExports = requiredExports.filter(exportFeature => !content.includes(exportFeature));
        
        if (missingExports.length === 0) {
            console.log('✅ Fitur export Excel tersedia');
        } else {
            console.log('❌ Fitur export yang hilang:');
            missingExports.forEach(exportFeature => console.log(`  - ${exportFeature}`));
        }

        return missingExports.length === 0;
    }

    async generateDeployChecklist() {
        console.log('📋 Creating deployment checklist...');
        
        const checklist = `
# 📋 CHECKLIST DEPLOY VIA GITHUB

## ✅ Pre-Deploy Checklist

### 1. File & Direktori
- [ ] All source code files have been committed to GitHub
- [ ] File settings.json has been configured for server
- [ ] File .gitignore has been set to ignore sensitive files (database, logs, session)

### 2. Dependencies
- [ ] package.json is complete with all dependencies
- [ ] Node.js version >= 14.0.0 (direkomendasikan v18+)
- [ ] npm atau yarn tersedia di server

### 3. Database
- [ ] Database will be created automatically on first run
- [ ] Atau upload database backup ke server
- [ ] Ensure data/ directory exists and is writable

### 4. Konfigurasi Server
- [ ] settings.json has been adjusted for server
- [ ] IP address, port, and credentials are correct
- [ ] WhatsApp session will be created automatically

## 🚀 Deploy Steps

### 1. Clone dari GitHub
\`\`\`bash
git clone https://github.com/yourofficialisp/wifiber-billing
cd gembok-bill
\`\`\`

### 2. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Konfigurasi
\`\`\`bash
# Edit settings.json sesuai server
nano settings.json
\`\`\`

### 4. Setup Database (if not yet available)
\`\`\`bash
# Database will be created automatically on first run
# Atau restore dari backup:
# cp backup/billing.db data/billing.db
\`\`\`

### 5. Jalankan Aplikasi
\`\`\`bash
# Development
npm run dev

# Production
npm start

# Atau dengan PM2
pm2 start app.js --name gembok-bill
\`\`\`

## 🔧 Post-Deploy Verification

### 1. Cek Aplikasi
- [ ] Aplikasi berjalan tanpa error
- [ ] Web interface can be accessed
- [ ] Database terhubung dengan baik

### 2. Cek Fitur Backup/Restore
- [ ] Admin settings page can be accessed
- [ ] Fitur backup database berfungsi
- [ ] Fitur restore database berfungsi

### 3. Cek Fitur Export
- [ ] Export customers ke Excel berfungsi
- [ ] Export financial report berfungsi
- [ ] Excel files can be downloaded

### 4. Cek WhatsApp Bot
- [ ] WhatsApp bot terhubung
- [ ] QR code can be scanned
- [ ] Commands berfungsi

## ⚠️ Troubleshooting

### Database Error
- Cek permissions direktori data/
- Restore from backup if needed
- Cek log aplikasi untuk error detail

### Dependencies Error
- Jalankan npm install --force
- Cek Node.js version
- Update npm if needed

### WhatsApp Error
- Delete folder whatsapp-session/
- Restart aplikasi
- Scan QR code ulang

### Backup/Restore Error
- Cek permissions direktori backup/
- Cek disk space
- Cek log aplikasi
`;

        const checklistFile = path.join(this.projectRoot, 'DEPLOY_CHECKLIST.md');
        fs.writeFileSync(checklistFile, checklist);
        
        console.log(`📋 Checklist deploy tersimpan: ${path.basename(checklistFile)}`);
        return checklistFile;
    }

    async runFullCheck() {
        console.log('🚀 Starting deployment readiness check...\n');
        
        const results = {
            files: await this.checkRequiredFiles(),
            directories: await this.checkRequiredDirectories(),
            packageJson: await this.checkPackageJson(),
            settingsJson: await this.checkSettingsJson(),
            database: await this.checkDatabaseStructure(),
            backupRestore: await this.checkBackupRestoreFunctionality(),
            export: await this.checkExportFunctionality()
        };

        console.log('\n📊 HASIL PENGECEKAN:');
        console.log(`Files: ${results.files ? '✅' : '❌'}`);
        console.log(`Directories: ${results.directories ? '✅' : '❌'}`);
        console.log(`Package.json: ${results.packageJson ? '✅' : '❌'}`);
        console.log(`Settings.json: ${results.settingsJson ? '✅' : '❌'}`);
        console.log(`Database: ${results.database ? '✅' : '❌'}`);
        console.log(`Backup/Restore: ${results.backupRestore ? '✅' : '❌'}`);
        console.log(`Export: ${results.export ? '✅' : '❌'}`);

        const allPassed = Object.values(results).every(result => result);
        
        if (allPassed) {
            console.log('\n🎉 ALL CHECKS PASSED!');
            console.log('✅ Aplikasi siap untuk deploy via GitHub');
        } else {
            console.log('\n⚠️  THERE ARE ISSUES THAT NEED TO BE FIXED!');
            console.log('❌ Fix the issues above before deploying');
        }

        // Generate checklist
        await this.generateDeployChecklist();
        
        return allPassed;
    }
}

// Main execution
async function main() {
    const checker = new DeployReadinessChecker();
    await checker.runFullCheck();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = DeployReadinessChecker;
