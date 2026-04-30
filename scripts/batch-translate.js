/**
 * Batch Translation Script for Gembok Bill Application
 * Automatically translates Indonesian text to English in all EJS files
 */

const fs = require('fs');
const path = require('path');

// Indonesian to English translation mappings - comprehensive list
const translations = {
    // Longer phrases - MUST be processed first to avoid partial replacements
    'Apakah You yakin ingin menghapus': 'Are you sure you want to delete',
    'Apakah You yakin ingin': 'Are you sure you want to',
    'Silakan masukkan': 'Please enter',
    'Mohon tunggu sebentar': 'Please wait a moment',
    'Back ke halaman': 'Back to',
    'Successful disimpan': 'Successfully saved',
    'Successful diubah': 'Successfully updated',
    'Successful dihapus': 'Successfully deleted',
    'Failed to save': 'Failed to save',
    'Tidak ada data': 'No data available',
    'Data not found': 'Data not found',
    'Processing': 'Processing',
    'Loading': 'Loading',
    'No data': 'No data yet',
    'Contact customer service': 'Contact customer service',

    // Page titles
    'Login Customer': 'Customer Login',
    'Login Admin': 'Admin Login',
    'Login Agent': 'Agent Login',
    'Portal Customer': 'Customer Portal',
    'Dashboard': 'Dashboard',

    // Common UI elements - buttons, actions
    'Login': 'Login',
    'Logout': 'Logout',
    'List': 'Register',
    'Save': 'Save',
    'Cancel': 'Cancel',
    'Delete': 'Delete',
    'Add': 'Add',
    'Back': 'Back',
    'Continuekan': 'Continue',
    'View': 'View',
    'Close': 'Close',
    'Kirim': 'Send',
    'Print': 'Print',

    // Status
    'Successful': 'Successful',
    'Failed': 'Failed',
    'Sukses': 'Success',
    'Aktif': 'Active',
    'Waiting': 'Waiting',
    'Pending': 'Pending',

    // Common words
    'Loginkan': 'Enter',
    'Select': 'Select',
    'Konfirmasi': 'Confirm',
    'Yakin': 'Sure',
    'Tidak': 'No',
    'Atau': 'Or',

    // Form labels
    'Nama': 'Name',
    'Alamat': 'Address',
    'Phone': 'Phone',
    'Quantity': 'Amount',
    'Harga': 'Price',
    'Durasi': 'Duration',
    'Date': 'Date',
    'Waktu': 'Time',

    // Roles
    'Customer': 'Customer',
    'Admin': 'Admin',
    'Agent': 'Agent',
    'Technician': 'Technician',

    // Billing/Payment
    'Payment': 'Payment',
    'Bill': 'Bill',
    'Transaksi': 'Transaction',
    'Balance': 'Balance',
    'Voucher': 'Voucher',
};

// Function to translate file content
function translateContent(content) {
    let translated = content;

    // Sort translations by length (longest first) to handle longer phrases correctly
    const sortedTranslations = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);

    for (const [indonesian, english] of sortedTranslations) {
        // Use global regex for replacement
        const regex = new RegExp(indonesian.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        translated = translated.replace(regex, english);
    }

    return translated;
}

// Function to recursively find all EJS files
function findEjsFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'data') {
                findEjsFiles(filePath, fileList);
            }
        } else if (file.endsWith('.ejs')) {
            fileList.push(filePath);
        }
    });

    return fileList;
}

// Main execution
function main() {
    const viewsDir = path.join(__dirname, '..', 'views');

    if (!fs.existsSync(viewsDir)) {
        console.error('Views directory not found at:', viewsDir);
        return;
    }

    console.log('🔍 Finding all EJS files...');
    const ejsFiles = findEjsFiles(viewsDir);
    console.log(`📝 Found ${ejsFiles.length} EJS files\n`);

    let translatedCount = 0;
    let skippedCount = 0;

    ejsFiles.forEach(filePath => {
        try {
            const originalContent = fs.readFileSync(filePath, 'utf8');
            const translatedContent = translateContent(originalContent);

            if (originalContent !== translatedContent) {
                fs.writeFileSync(filePath, translatedContent, 'utf8');
                translatedCount++;
                console.log(`✅ ${path.relative(viewsDir, filePath)}`);
            } else {
                skippedCount++;
            }
        } catch (error) {
            console.error(`❌ Error: ${path.relative(viewsDir, filePath)} - ${error.message}`);
        }
    });

    console.log('\n📊 Translation Summary:');
    console.log(`   ✅ Translated: ${translatedCount} files`);
    console.log(`   ⏭️  Skipped: ${skippedCount} files`);
    console.log(`   📁 Total: ${ejsFiles.length} files`);
    console.log('\n✨ Batch translation completed!');
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { translateContent, translations };
