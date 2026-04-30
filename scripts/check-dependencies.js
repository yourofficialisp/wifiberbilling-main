#!/usr/bin/env node

/**
 * Dependency Checker untuk Gembok Bill
 * Check native modules and provide recommendations if there are issues
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Checking Gembok Bill dependencies...\n');

// Cek package.json
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log('✅ package.json found');

    // Cek dependencies penting
    const criticalDeps = ['sqlite3', 'bcrypt', 'node-routeros'];
    const missingDeps = [];

    criticalDeps.forEach(dep => {
        if (!packageJson.dependencies[dep]) {
            missingDeps.push(dep);
        }
    });

    if (missingDeps.length > 0) {
        console.log(`⚠️  Missing critical dependencies: ${missingDeps.join(', ')}`);
    } else {
        console.log('✅ All critical dependencies are listed');
    }

} catch (error) {
    console.log('❌ package.json not found or invalid');
}

// Cek node_modules
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
    console.log('✅ node_modules directory exists');

    // Cek sqlite3 binary
    const sqlite3Binary = path.join(nodeModulesPath, 'sqlite3', 'build', 'Release', 'node_sqlite3.node');
    if (fs.existsSync(sqlite3Binary)) {
        console.log('✅ SQLite3 binary exists');

        try {
            // Cek apakah binary valid
            require(sqlite3Binary);
            console.log('✅ SQLite3 binary is valid');
        } catch (error) {
            console.log('❌ SQLite3 binary is corrupted or incompatible');
            console.log('💡 Run: npm rebuild sqlite3');
        }
    } else {
        console.log('⚠️  SQLite3 binary not found');
        console.log('💡 Run: npm install sqlite3 --build-from-source');
    }
} else {
    console.log('❌ node_modules directory not found');
    console.log('💡 Run: npm install');
}

// Cek sistem requirements
try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    console.log(`✅ Node.js version: ${nodeVersion}`);

    if (nodeVersion.startsWith('v20') || nodeVersion.startsWith('v18')) {
        console.log('✅ Node.js version is compatible');
    } else {
        console.log('⚠️  Node.js version might not be optimal (recommended: v18-20)');
    }
} catch (error) {
    console.log('❌ Cannot detect Node.js version');
}

// Cek build tools (untuk Linux)
try {
    const hasGcc = execSync('which gcc', { encoding: 'utf8' }).trim();
    const hasMake = execSync('which make', { encoding: 'utf8' }).trim();
    const hasPython = execSync('which python3', { encoding: 'utf8' }).trim();

    if (hasGcc && hasMake && hasPython) {
        console.log('✅ Build tools available');
    } else {
        console.log('⚠️  Some build tools missing (required for native modules)');
        console.log('💡 Run: sudo apt install -y build-essential python3-dev');
    }
} catch (error) {
    console.log('⚠️  Cannot check build tools');
}

// Rekomendasi akhir
console.log('\n📋 Recommendations:');
console.log('1. If SQLite3 errors occur, run: npm rebuild');
console.log('2. For Linux servers, run: npm install sqlite3 --build-from-source');
console.log('3. Use PM2 for production: pm2 start app.js --name gembok-bill');
console.log('4. Check logs with: pm2 logs gembok-bill');

console.log('\n🎯 Ready to run: npm start');
