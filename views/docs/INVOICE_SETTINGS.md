# Invoice Settings Configuration - Gembok Bill

## Overview
This document explains all settings fields used to customize invoices without needing to restart the application.

## Settings Fields Used

### 1. Company Information
```json
{
  "company_header": "ALIJAYA DIGITAL NETWORK",
  "company_slogan": "Solusi Internet Terdepan",
  "logo_filename": "logo.png"
}
```

**Kegunaan:**
- `company_header`: Company name displayed in invoice header
- `company_slogan`: Company slogan or tagline
- `logo_filename`: Logo file name (must exist in `/public/img/`)

### 2. Footer Information
```json
{
  "footer_info": "Info Contact : 03036783333"
}
```

**Usage:**
- `footer_info`: Additional information displayed in invoice footer

### 3. Payment Information
```json
{
  "payment_bank_name": "BCA",
  "payment_account_number": "1234567890",
  "payment_account_holder": "ALIJAYA DIGITAL NETWORK",
  "payment_cash_address": "Jl. Example No. 123",
  "payment_cash_hours": "08:00 - 17:00"
}
```

**Usage:**
- `payment_bank_name`: Bank name for transfer
- `payment_account_number`: Bank account number
- `payment_account_holder`: Account holder name
- `payment_cash_address`: Office address for cash payment
- `payment_cash_hours`: Office operating hours

### 4. Contact Information
```json
{
  "contact_phone": "0812-3456-7890",
  "contact_email": "info@example.com",
  "contact_address": "Jl. Example No. 123, Kota",
  "contact_whatsapp": "03036783333"
}
```

**Usage:**
- `contact_phone`: Office phone number
- `contact_email`: Office email
- `contact_address`: Office address
- `contact_whatsapp`: Office WhatsApp number

### 5. Company Additional Info
```json
{
  "company_website": "https://alijaya.net",
  "invoice_notes": "Payment can be made via bank transfer or cash payment at our office. Thank you for your trust."
}
```

**Usage:**
- `company_website`: Company website
- `invoice_notes`: Additional notes displayed on each invoice

## How to Use

### 1. Edit Settings.json
```bash
# Open settings.json file
nano settings.json

# Or edit with your favorite editor
code settings.json
```

### 2. Update Desired Fields
```json
{
  "company_header": "NEW COMPANY NAME",
  "company_slogan": "NEW SLOGAN",
  "payment_bank_name": "NEW BANK",
  "payment_account_number": "1234567890",
  "contact_phone": "081234567890"
}
```

### 3. Save File
After editing, save the `settings.json` file. Changes will take effect immediately without restarting the application.

## Hot-Reload System

Application uses hot-reload system for settings:

### 1. Settings Manager
```javascript
const { getSetting, getSettingsWithCache } = require('./config/settingsManager');
```

### 2. Cache System
- Settings are cached for optimal performance
- Cache is automatically refreshed when file changes
- No need to restart application

### 3. Template Integration
```ejs
<%= appSettings.companyHeader %>
<%= appSettings.payment_bank_name %>
<%= appSettings.contact_phone %>
```

## Complete Customization Example

### Invoice Modern
```json
{
  "company_header": "TECHNOLOGY SOLUTIONS",
  "company_slogan": "Innovation at Your Fingertips",
  "company_website": "https://techsolutions.com",
  "payment_bank_name": "Mandiri",
  "payment_account_number": "1440012345678",
  "payment_account_holder": "PT. TECHNOLOGY SOLUTIONS",
  "contact_phone": "021-1234567",
  "contact_email": "info@techsolutions.com",
  "contact_address": "Jl. Sudirman No. 123, Jakarta Pusat",
  "contact_whatsapp": "081234567890",
  "invoice_notes": "Payment can be made via bank transfer, e-wallet, or cash payment at our office. Thank you for your trust in using our services."
}
```

### Invoice Traditional
```json
{
  "company_header": "WARUNG INTERNET",
  "company_slogan": "Cheap and Fast Internet",
  "company_website": "https://warunginternet.com",
  "payment_bank_name": "BRI",
  "payment_account_number": "1234567890",
  "payment_account_holder": "WARUNG INTERNET",
  "contact_phone": "081234567890",
  "contact_email": "info@warunginternet.com",
  "contact_address": "Jl. Raya No. 45, Desa",
  "contact_whatsapp": "081234567890",
  "invoice_notes": "Payment can be made at the shop or via bank transfer. Thank you."
}
```

## Settings Validation

### 1. Required Fields
The following fields must exist and cannot be empty:
- `company_header`
- `payment_bank_name`
- `payment_account_number`
- `payment_account_holder`
- `contact_phone`

### 2. Optional Fields
The following fields are optional and can be left empty:
- `company_slogan`
- `company_website`
- `invoice_notes`
- `contact_email`
- `contact_address`
- `contact_whatsapp`

### 3. Format Validation
- `contact_phone`: Must be a valid phone number
- `contact_email`: Must be a valid email
- `company_website`: Must be a valid URL (optional)

## Troubleshooting

### 1. Settings Not Changing
**Problem:** Changes in settings.json not appearing in invoice
**Solution:** 
- Ensure file is saved correctly
- Check JSON syntax (no trailing commas)
- Refresh invoice page

### 2. Empty Fields
**Problem:** Certain fields not appearing or empty
**Solution:**
- Ensure field exists in settings.json
- Check field name (case sensitive)
- Ensure value is not empty

### 3. JSON Error
**Problem:** Application error due to incorrect JSON format
**Solution:**
- Validate JSON with online tool
- Check commas and quotes
- Ensure JSON structure is correct

## Best Practices

### 1. Backup Settings
```bash
# Backup before editing
cp settings.json settings.json.backup
```

### 2. Test Changes
- Test invoice after changing settings
- Ensure all fields appear correctly
- Check format and layout

### 3. Version Control
- Commit settings changes to git
- Document changes made
- Update documentation if there are new fields

## Monitoring

### 1. Log Files
Check logs for settings errors:
```bash
tail -f logs/error.log
tail -f logs/info.log
```

### 2. Health Check
```bash
curl http://localhost:3003/health
```

### 3. Settings Status
```javascript
// Check settings in console
console.log(require('./config/settingsManager').getSettingsWithCache());
```

## Support

### Contact
- **Developer**: Admin System
- **Email**: info@example.com
- **WhatsApp**: 03036783333

### Documentation
- **Invoice System**: `/docs/INVOICE_SYSTEM.md`
- **API Docs**: `/docs/api.md`
- **User Manual**: `/docs/user-manual.md`
