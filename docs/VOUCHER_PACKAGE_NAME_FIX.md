# PERBAIKAN PACKAGE NAME VOUCHER - Tripay Payment Display

## 📋 Masalah yang Diperbaiki

**Masalah**: Di halaman pembayaran Tripay, rincian pembelian menampilkan "BRONZE" (nama package dari billing system) bukan "10k" (nama package voucher).

**Root Cause**: Saat membuat invoice untuk voucher, kita menggunakan `package_id = 1` yang mengacu ke package "BRONZE" di database, sehingga `package_name` yang ditampilkan adalah "BRONZE".

**Expected Result**: Rincian pembelian harus menampilkan nama voucher package (e.g., "10rb - 5 Day") bukan nama package billing.

---

## 🔧 **PERBAIKAN YANG DIIMPLEMENTASIKAN**

### 1. **✅ Modifikasi Pembuatan Invoice Voucher**

**File**: `routes/publicVoucher.js`  
**Route**: `/purchase`

**Sebelum**:
```javascript
const sql = `INSERT INTO invoices (customer_id, invoice_number, amount, status, created_at, due_date, notes, package_id)
           VALUES (?, ?, ?, 'pending', datetime('now'), ?, ?, ?)`;
db.run(sql, [19, invoiceId, totalAmount, dueDate, `Voucher Hotspot ${selectedPackage.name} x${quantity}`, 1], ...);
```

**Sesudah**:
```javascript
const sql = `INSERT INTO invoices (customer_id, invoice_number, amount, status, created_at, due_date, notes, package_id, package_name)
           VALUES (?, ?, ?, 'pending', datetime('now'), ?, ?, ?, ?)`;
db.run(sql, [19, invoiceId, totalAmount, dueDate, `Voucher Hotspot ${selectedPackage.name} x${quantity}`, 1, selectedPackage.name], ...);
```

**Perubahan**:
- ✅ Menambahkan field `package_name` ke INSERT statement
- ✅ Menggunakan `selectedPackage.name` (e.g., "10rb - 5 Day") sebagai `package_name`

### 2. **✅ Modifikasi getInvoiceById untuk Voucher**

**File**: `config/billing.js`  
**Method**: `getInvoiceById`

**Sebelum**:
```javascript
async getInvoiceById(id) {
    const sql = `SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.id = ?`;
    // ... return row as is
}
```

**Sesudah**:
```javascript
async getInvoiceById(id) {
    const sql = `SELECT i.*, c.username, c.name as customer_name, c.phone as customer_phone,
                       p.name as package_name, p.speed as package_speed
                FROM invoices i
                JOIN customers c ON i.customer_id = c.id
                JOIN packages p ON i.package_id = p.id
                WHERE i.id = ?`;
    
    this.db.get(sql, [id], (err, row) => {
        if (err) {
            reject(err);
        } else {
            // Check if this is a voucher invoice by looking at invoice_number pattern
            if (row && row.invoice_number && row.invoice_number.includes('INV-VCR-')) {
                // Extract voucher package name from notes field
                // Format: "Voucher Hotspot 10rb - 5 Day x1"
                const notes = row.notes || '';
                const voucherMatch = notes.match(/Voucher Hotspot (.+?) x\d+/);
                if (voucherMatch) {
                    row.package_name = voucherMatch[1]; // e.g., "10rb - 5 Day"
                }
            }
            resolve(row);
        }
    });
}
```

**Perubahan**:
- ✅ Deteksi invoice voucher berdasarkan pattern `INV-VCR-`
- ✅ Extract nama voucher package dari field `notes`
- ✅ Override `package_name` dengan nama voucher yang benar

---

## 🔄 **FLOW YANG DIPERBAIKI**

### **Sebelum** (Incorrect):
1. **Customer beli voucher** "10rb - 5 Day"
2. **Invoice dibuat** dengan `package_id = 1` (BRONZE)
3. **Payment gateway** mengambil `package_name` dari JOIN dengan tabel `packages`
4. **Page Tripay** menampilkan "BRONZE" ❌

### **Sesudah** (Correct):
1. **Customer beli voucher** "10rb - 5 Day"
2. **Invoice dibuat** dengan `package_name = "10rb - 5 Day"`
3. **getInvoiceById** mendeteksi invoice voucher dan override `package_name`
4. **Page Tripay** menampilkan "10rb - 5 Day" ✅

---

## 🎯 **BENEFITS**

### 1. **User Experience**
- ✅ **Correct Display**: Customer melihat nama voucher yang benar
- ✅ **Clear Information**: Rincian pembelian sesuai dengan yang dibeli
- ✅ **Professional**: Page pembayaran terlihat profesional

### 2. **Business Benefits**
- ✅ **Brand Consistency**: Name voucher konsisten di semua tempat
- ✅ **Customer Trust**: Customer tidak bingung dengan nama yang salah
- ✅ **Clear Billing**: Bill jelas menunjukkan apa yang dibeli

### 3. **Technical Benefits**
- ✅ **Backward Compatible**: Invoice lama tetap berfungsi
- ✅ **Flexible**: Bisa menangani berbagai format nama voucher
- ✅ **Maintainable**: Mudah di-maintain dan di-debug

---

## 🧪 **TESTING**

### 1. **Test Voucher Package Display**
```bash
# 1. Beli voucher "10rb - 5 Day" via /voucher
# 2. Pay via payment gateway
# 3. Cek halaman Tripay
# 4. Verifikasi rincian pembelian menampilkan "10rb - 5 Day"
```

### 2. **Test Different Voucher Packages**
```bash
# Test dengan berbagai paket voucher:
# - 3rb - 1 Day
# - 5rb - 2 Day  
# - 10rb - 5 Day
# - 15rb - 8 Day
# - 25rb - 15 Day
# - 50rb - 30 Day
```

### 3. **Test Invoice Customer (Tidak Berubah)**
```bash
# 1. Pay invoice customer biasa
# 2. Cek halaman Tripay
# 3. Verifikasi masih menampilkan "BRONZE", "SILVER", dll
```

---

## 📊 **IMPACT ANALYSIS**

### **Files Modified**:
1. **`routes/publicVoucher.js`**:
   - ✅ Menambahkan field `package_name` ke INSERT invoice
   - ✅ Menggunakan `selectedPackage.name` sebagai `package_name`

2. **`config/billing.js`**:
   - ✅ Modifikasi `getInvoiceById` untuk deteksi voucher invoice
   - ✅ Override `package_name` dengan nama voucher yang benar

### **Database Impact**:
- ✅ **No Schema Changes**: No changes struktur database
- ✅ **Backward Compatible**: Invoice lama tetap berfungsi
- ✅ **Data Consistency**: Name voucher konsisten di semua tempat

### **Performance Impact**:
- ✅ **Minimal**: Hanya penambahan regex matching
- ✅ **No Additional Queries**: Tidak ada query database tambahan
- ✅ **Same Performance**: Performa sama dengan sebelumnya

---

## 🔮 **FUTURE IMPROVEMENTS**

### 1. **Dedicated Voucher Package Table**
```sql
-- Buat tabel khusus untuk voucher packages
CREATE TABLE voucher_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id TEXT UNIQUE NOT NULL, -- '3k', '5k', '10k', etc.
    name TEXT NOT NULL, -- '3rb - 1 Day', '5rb - 2 Day', etc.
    price DECIMAL(10,2) NOT NULL,
    duration TEXT NOT NULL, -- '1 hari', '2 hari', etc.
    profile TEXT NOT NULL, -- Mikrotik profile
    enabled BOOLEAN DEFAULT 1
);
```

### 2. **Enhanced Package Name Extraction**
```javascript
// Support untuk berbagai format nama voucher
const voucherPatterns = [
    /Voucher Hotspot (.+?) x\d+/,
    /Voucher (.+?) x\d+/,
    /(.+?) Voucher x\d+/
];
```

### 3. **Package Name Validation**
```javascript
// Validasi nama package sebelum disimpan
function validateVoucherPackageName(packageName) {
    const validPatterns = [
        /^\d+rb - \d+ hari$/i,
        /^\d+k - \d+ hari$/i
    ];
    return validPatterns.some(pattern => pattern.test(packageName));
}
```

---

## 📝 **MIGRATION NOTES**

### **Backward Compatibility**:
- ✅ **Existing Invoices**: Invoice lama tetap menampilkan nama package yang benar
- ✅ **Voucher Invoices**: Invoice voucher baru menampilkan nama voucher
- ✅ **No Breaking Changes**: Semua fitur lama tetap berfungsi

### **Deployment**:
- ✅ **No Database Migration**: Tidak perlu migrasi database
- ✅ **No Configuration Changes**: Tidak perlu konfigurasi tambahan
- ✅ **Immediate Effect**: Perubahan langsung berlaku

### **Rollback Plan**:
- ✅ **Easy Rollback**: Tinggal hapus modifikasi di `getInvoiceById`
- ✅ **No Data Loss**: Tidak ada data yang hilang
- ✅ **Quick Fix**: Bisa di-rollback dalam hitungan menit

---

## 🎉 **SUMMARY**

Sekarang halaman pembayaran Tripay menampilkan nama voucher yang benar:

- **Invoice Customer** → "BRONZE", "SILVER", dll (tidak berubah)
- **Voucher** → "10rb - 5 Day", "5rb - 2 Day", dll (diperbaiki)

Customer tidak lagi bingung melihat "BRONZE" saat membeli voucher "10rb - 5 Day".

---

*Dokumentasi ini dibuat pada: 27 January 2025*
*Status: IMPLEMENTED ✅*
