# SISTEM DUAL WEBHOOK - INVOICE vs VOUCHER

## 📋 **OVERVIEW**

Aplikasi ini memiliki **dua sistem pembayaran online** yang berbeda dengan webhook handler yang terpisah:

1. **Invoice Payment** → Webhook ke `/payment/webhook/tripay`
2. **Voucher Payment** → Webhook ke `/voucher/payment-webhook`

---

## 🔧 **KONFIGURASI WEBHOOK**

### **1. Invoice Payment Webhook**
- **URL**: `/payment/webhook/tripay`
- **Handler**: `routes/payment.js` → `POST /webhook/tripay`
- **Gateway**: Tripay, Midtrans, Xendit
- **Callback URL**: `${appBaseUrl}/payment/webhook/tripay`

### **2. Voucher Payment Webhook**
- **URL**: `/voucher/payment-webhook`
- **Handler**: `routes/publicVoucher.js` → `POST /payment-webhook`
- **Gateway**: Tripay, Midtrans, Xendit
- **Callback URL**: `${appBaseUrl}/voucher/payment-webhook`

---

## 🎯 **PERBEDAAN CALLBACK URL**

### **Sebelum Perbaikan** ❌
```javascript
// Semua payment (invoice + voucher) menggunakan callback yang sama
callback_url: `${appBaseUrl}/payment/webhook/tripay`
```

### **Sesudah Perbaikan** ✅
```javascript
// Callback URL berdasarkan paymentType
callback_url: paymentType === 'voucher' 
    ? `${appBaseUrl}/voucher/payment-webhook` 
    : `${appBaseUrl}/payment/webhook/tripay`
```

---

## 🔄 **FLOW PEMBAYARAN**

### **Invoice Payment Flow:**
1. **Customer bayar invoice** → `/admin/billing`
2. **Payment gateway** → Tripay/Midtrans/Xendit
3. **Webhook** → `/payment/webhook/tripay`
4. **Handler** → `routes/payment.js`
5. **Update status** → `invoices` table
6. **Redirect** → `/payment/finish`

### **Voucher Payment Flow:**
1. **Customer beli voucher** → `/voucher`
2. **Payment gateway** → Tripay/Midtrans/Xendit
3. **Webhook** → `/voucher/payment-webhook`
4. **Handler** → `routes/publicVoucher.js`
5. **Generate voucher** → Mikrotik
6. **Update status** → `voucher_purchases` table
7. **Send WhatsApp** → Customer
8. **Redirect** → `/voucher/finish`

---

## 🛠️ **IMPLEMENTASI TEKNIS**

### **1. Payment Gateway Configuration**

**File**: `config/paymentGateway.js`

```javascript
// TripayGateway.createPaymentWithMethod()
const orderData = {
    // ... other fields
    callback_url: paymentType === 'voucher' 
        ? `${appBaseUrl}/voucher/payment-webhook` 
        : `${appBaseUrl}/payment/webhook/tripay`,
    return_url: paymentType === 'voucher' 
        ? `${appBaseUrl}/voucher/finish` 
        : `${appBaseUrl}/payment/finish`
};
```

### **2. Payment Type Parameter**

**File**: `config/billing.js`

```javascript
// BillingManager.createOnlinePaymentWithMethod()
async createOnlinePaymentWithMethod(invoiceId, gateway = null, method = null, paymentType = 'invoice') {
    // paymentType: 'invoice' atau 'voucher'
    const paymentResult = await this.paymentGateway.createPaymentWithMethod(paymentData, gateway, method, paymentType);
}
```

### **3. Voucher Payment Creation**

**File**: `routes/publicVoucher.js`

```javascript
// Route POST /purchase
const paymentResult = await billingManager.createOnlinePaymentWithMethod(
    invoiceDbId, 
    gateway, 
    method, 
    'voucher'  // ← paymentType = 'voucher'
);
```

---

## 📊 **WEBHOOK HANDLER COMPARISON**

| Aspect | Invoice Webhook | Voucher Webhook |
|--------|----------------|-----------------|
| **URL** | `/payment/webhook/tripay` | `/voucher/payment-webhook` |
| **Handler** | `routes/payment.js` | `routes/publicVoucher.js` |
| **Database** | `invoices` table | `voucher_purchases` table |
| **Action** | Update invoice status | Generate voucher + send WhatsApp |
| **Redirect** | `/payment/finish` | `/voucher/finish` |
| **Gateway Support** | Tripay, Midtrans, Xendit | Tripay, Midtrans, Xendit |

---

## 🔍 **DEBUGGING WEBHOOK**

### **1. Cek Webhook URL di Payment Gateway Dashboard**

**Tripay Dashboard:**
- Login ke dashboard Tripay
- Cek webhook URL: `https://yourdomain.com/voucher/payment-webhook`
- Pastikan webhook aktif

**Midtrans Dashboard:**
- Midtrans tidak menggunakan webhook callback
- Menggunakan redirect URL: `https://yourdomain.com/voucher/finish`

**Xendit Dashboard:**
- Xendit tidak menggunakan webhook callback
- Menggunakan redirect URL: `https://yourdomain.com/voucher/finish`

### **2. Test Webhook Manual**

```bash
# Test webhook voucher
curl -X POST https://yourdomain.com/voucher/payment-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "INV-VCR-1234567890-1",
    "status": "success",
    "amount": 10000,
    "payment_type": "tripay"
  }'
```

### **3. Monitor Log Server**

```bash
# Monitor log saat payment dilakukan
tail -f logs/app.log | grep -i webhook
```

---

## ⚠️ **TROUBLESHOOTING**

### **Masalah Umum:**

#### **1. Webhook tidak diterima**
- **Penyebab**: URL webhook salah di payment gateway dashboard
- **Solusi**: Update webhook URL di dashboard payment gateway

#### **2. Voucher tidak ter-generate**
- **Penyebab**: Webhook diterima tapi gagal generate voucher
- **Solusi**: Cek koneksi Mikrotik dan log error

#### **3. Status tidak ter-update**
- **Penyebab**: Webhook handler gagal memproses payload
- **Solusi**: Cek log error dan validasi payload

#### **4. Redirect salah halaman**
- **Penyebab**: `return_url` salah di payment gateway
- **Solusi**: Cek konfigurasi `return_url` di `TripayGateway`

---

## 🧪 **TESTING**

### **1. Test Invoice Payment**
```bash
# 1. Buat invoice di admin panel
# 2. Pay via payment gateway
# 3. Cek webhook diterima di /payment/webhook/tripay
# 4. Verifikasi status invoice ter-update
```

### **2. Test Voucher Payment**
```bash
# 1. Beli voucher di /voucher
# 2. Pay via payment gateway
# 3. Cek webhook diterima di /voucher/payment-webhook
# 4. Verifikasi voucher ter-generate di Mikrotik
# 5. Verifikasi WhatsApp terkirim ke customer
```

---

## 📝 **MIGRATION NOTES**

### **Backward Compatibility:**
- ✅ **Existing Invoices**: Tetap menggunakan webhook `/payment/webhook/tripay`
- ✅ **New Vouchers**: Menggunakan webhook `/voucher/payment-webhook`
- ✅ **No Breaking Changes**: Semua fitur lama tetap berfungsi

### **Deployment:**
- ✅ **No Database Migration**: Tidak perlu migrasi database
- ✅ **No Configuration Changes**: Tidak perlu konfigurasi tambahan
- ✅ **Immediate Effect**: Perubahan langsung berlaku

---

## 🎉 **SUMMARY**

Sekarang sistem memiliki **dual webhook handler** yang terpisah:

- **Invoice Payment** → `/payment/webhook/tripay` → Update invoice status
- **Voucher Payment** → `/voucher/payment-webhook` → Generate voucher + send WhatsApp

**Callback URL** di payment gateway sekarang dinamis berdasarkan `paymentType`:
- `paymentType === 'voucher'` → `/voucher/payment-webhook`
- `paymentType === 'invoice'` → `/payment/webhook/tripay`

---

*Dokumentasi ini dibuat pada: 27 January 2025*
*Status: IMPLEMENTED ✅*
