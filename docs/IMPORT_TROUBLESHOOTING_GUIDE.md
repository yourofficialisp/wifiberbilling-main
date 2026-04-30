# Import Data Customer - Troubleshooting Guide

## ✅ **Status: Import Berfungsi dengan Baik**

Setelah testing menyeluruh, sistem import Excel berfungsi dengan baik. Berikut adalah panduan troubleshooting untuk masalah yang mungkin terjadi.

## 🔍 **Troubleshooting Steps**

### **1. Periksa Server Status**
```bash
# Cek apakah server berjalan
netstat -ano | findstr :3002

# Jika tidak ada output, start server:
node app.js
```

### **2. Periksa Autentikasi**
- Pastikan sudah login sebagai admin
- Username: `admin`
- Password: `admin`
- URL: `http://localhost:3002/admin/login`

### **3. Periksa Format Excel**
```excel
Header yang benar:
name | phone | pppoe_username | email | address | package_id | pppoe_profile | status | auto_suspension | billing_day

Example data:
John Doe | 081234567890 | john_doe | john@example.com | Jln. Example 123 | 1 | default | active | 1 | 15
```

### **4. Validasi Data**
- ✅ **Nama**: Wajib diisi, tidak boleh kosong
- ✅ **Phone**: Wajib diisi, format: angka, +, -, spasi, ()
- ✅ **Package ID**: Harus ada di database
- ✅ **Billing Day**: 1-28 (default: 15)

## 📊 **Test Results**

### **Import Test Successful:**
```json
{
  "success": true,
  "summary": {
    "created": 1,
    "updated": 0,
    "failed": 2
  },
  "errors": [
    {
      "row": 4,
      "error": "Nama/Phone wajib"
    },
    {
      "row": 3,
      "error": "Format nomor telepon invalid"
    }
  ]
}
```

### **Data Successful Diimport:**
```
ID: 1027, Name: Test Customer Valid, Phone: 081234567888
```

## ⚠️ **Error yang Sering Terjadi**

### **1. "Nama/Phone wajib"**
**Penyebab:** Kolom name atau phone kosong
**Solusi:** Pastikan semua baris memiliki nama dan nomor telepon

### **2. "Format nomor telepon invalid"**
**Penyebab:** Nomor telepon mengandung characters yang tidak diizinkan
**Solusi:** Gunakan hanya angka, +, -, spasi, ()

### **3. "File XLSX not found"**
**Penyebab:** File tidak terupload dengan benar
**Solusi:** Pastikan file berformat .xlsx dan tidak corrupt

### **4. "Worksheet not found"**
**Penyebab:** File Excel tidak memiliki worksheet
**Solusi:** Pastikan file Excel memiliki at least 1 worksheet

## 🚀 **Cara Menggunakan Import**

### **Step 1: Login Admin**
```
URL: http://localhost:3002/admin/login
Username: admin
Password: admin
```

### **Step 2: Buka Page Customers**
```
URL: http://localhost:3002/admin/billing/customers
```

### **Step 3: Klik Import**
- Klik tombol "Restore Data Customer"
- Select file Excel (.xlsx)
- Klik "Import"

### **Step 4: View Hasil**
- **Created**: Customer baru yang successful dibuat
- **Updated**: Customer yang successful diupdate
- **Failed**: Customer yang gagal diimport
- **Errors**: Detail error untuk troubleshooting

## 🔧 **Advanced Troubleshooting**

### **Test Import dengan Script**
```javascript
// Buat file test_import.js
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

async function testImport() {
    // Login
    const loginResponse = await axios.post('http://localhost:3002/admin/login', {
        username: 'admin',
        password: 'admin'
    });
    
    const cookies = loginResponse.headers['set-cookie'];
    
    // Import
    const formData = new FormData();
    formData.append('file', fs.readFileSync('your_file.xlsx'));
    
    const response = await axios.post('http://localhost:3002/admin/billing/import/customers/xlsx', formData, {
        headers: {
            ...formData.getHeaders(),
            'Cookie': cookies.join('; ')
        }
    });
    
    console.log(response.data);
}

testImport();
```

### **Cek Database**
```javascript
// Buat file check_db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/billing.db');

db.all('SELECT id, username, name, phone FROM customers ORDER BY id DESC LIMIT 10', (err, rows) => {
    if (err) console.error(err);
    else {
        console.log('Latest customers:');
        rows.forEach(row => console.log(row));
    }
    db.close();
});
```

## 📞 **Support**

Jika masih ada masalah:
1. Periksa log server untuk error detail
2. Test dengan file Excel sample
3. Periksa format data Excel
4. Contact developer untuk bantuan lebih lanjut

## 🎯 **Kesimpulan**

**Import Excel berfungsi dengan baik!** Sistem sudah:
- ✅ Validasi data yang ketat
- ✅ Error handling yang proper
- ✅ Response yang informatif
- ✅ Database integration yang aman
