# Invoice Print System - Gembok Bill

## Overview
The invoice printing system is a key feature of the Gembok Bill application that allows admins to print and download invoices in a printable or PDF format.

## Main Features

### 1. Print Invoice
- **Route**: `/admin/billing/invoices/:id/print`
- **Method**: GET
- **Authentication**: Required (Admin only)
- **Template**: `views/admin/billing/invoice-print.ejs`

### 2. Download PDF
- **Feature**: Generate PDF from invoice
- **Library**: html2pdf.js
- **Format**: A4 Portrait
- **Quality**: High resolution

### 3. Print-friendly Design
- **CSS Print Media**: Optimized for printer
- **Page Size**: A4 (21cm x 29.7cm)
- **Margins**: 0.5cm
- **Color Support**: Full color with print color adjust

## Database Structure

### Invoices Table
```sql
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'unpaid',
    payment_date DATETIME,
    payment_method TEXT,
    payment_gateway TEXT,
    payment_token TEXT,
    payment_url TEXT,
    payment_status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (package_id) REFERENCES packages (id)
);
```

### Customers Table
```sql
CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    username TEXT UNIQUE NOT NULL,
    -- ... other fields
);
```

### Packages Table
```sql
CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    speed TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    description TEXT,
    -- ... other fields
);
```

## Invoice Data Query

### getInvoiceById Function
```javascript
async getInvoiceById(id) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT i.*, c.username as customer_username, c.name as customer_name, 
                   c.phone as customer_phone, c.address as customer_address,
                   p.name as package_name, p.speed as package_speed
            FROM invoices i
            JOIN customers c ON i.customer_id = c.id
            JOIN packages p ON i.package_id = p.id
            WHERE i.id = ?
        `;
        
        this.db.get(sql, [id], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}
```

## Invoice Template

### Layout Structure
1. **Header**: Company logo, company name, invoice number
2. **Customer Info**: Name, username, phone, address
3. **Invoice Info**: Date created, due date, status
4. **Amount Box**: Prominent total bill
5. **Service Details**: Service table with package and price
6. **Notes**: Additional notes (if any)
7. **Payment Instructions**: Payment methods (bank and cash)
8. **Footer**: Contact information and footer

### CSS Features
- **Responsive Design**: Works on screen and print
- **Print Optimization**: 
  - `@media print` styles
  - `print-color-adjust: exact`
  - Proper page margins
- **Color Support**: 
  - Blue theme (#007bff)
  - Status badges (success, warning, danger)
  - Table styling

## JavaScript Features

### Print Function
```javascript
function printInvoice() {
    window.print();
}
```

### PDF Download
```javascript
function downloadAsPDF() {
    const element = document.querySelector('.container-fluid');
    const opt = {
        margin: 0.5,
        filename: 'invoice-<%= invoice.invoice_number %>.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'cm', format: 'a4', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(element).save();
}
```

### Auto-hide Print Buttons
```javascript
window.addEventListener('beforeprint', function() {
    document.querySelector('.print-button').style.display = 'none';
});

window.addEventListener('afterprint', function() {
    document.querySelector('.print-button').style.display = 'block';
});
```

## Settings Configuration

### Company Information
```json
{
  "company_header": "ALIJAYA DIGITAL NETWORK",
  "footer_info": "Info Contact : 03036783333",
  "logo_filename": "logo.png"
}
```

### Payment Information
```json
{
  "payment_bank_name": "BCA",
  "payment_account_number": "1234567890",
  "payment_account_holder": "ALIJAYA DIGITAL NETWORK",
  "payment_cash_address": "Jl. Example No. 123",
  "payment_cash_hours": "08:00 - 17:00"
}
```

### Contact Information
```json
{
  "contact_phone": "0812-3456-7890",
  "contact_email": "info@example.com",
  "contact_address": "Jl. Example No. 123, Kota",
  "contact_whatsapp": "03036783333"
}
```

## Troubleshooting

### Common Issues

#### 1. Logo Not Showing
- **Problem**: Logo path incorrect
- **Solution**: Ensure logo exists at `/public/img/logo.png`
- **Check**: File `logo.png` exists in `public/img/` directory

#### 2. Customer Address Empty
- **Problem**: Address field not in database
- **Solution**: Field already handled with fallback "Address unavailable"
- **Check**: Query already includes `c.address as customer_address`

#### 3. Package Speed Not Showing
- **Problem**: Speed field not in database
- **Solution**: Field already handled with fallback "Speed unavailable"
- **Check**: Query already includes `p.speed as package_speed`

#### 4. Print Not Working
- **Problem**: CSS print media not supported
- **Solution**: Use modern browser (Chrome, Firefox, Edge)
- **Check**: Ensure `@media print` styles exist

#### 5. PDF Download Error
- **Problem**: Library html2pdf.js not loading
- **Solution**: Check internet connection for CDN
- **Alternative**: Use browser print feature

### Debug Steps
1. **Check Console**: View error in browser console
2. **Check Network**: Ensure all resources load
3. **Check Database**: Verify invoice data exists
4. **Check Authentication**: Ensure logged in as admin
5. **Check Route**: Verify route `/admin/billing/invoices/:id/print`

## Testing

### Manual Test
1. Login as admin
2. Open invoices page
3. Click print button on invoice
4. Test print feature and download PDF

### Automated Test
Use file `test-invoice.html` for automated testing:
- Health check server
- Admin authentication
- Invoice list access
- Invoice print access

## Performance Optimization

### Database
- Query using JOIN for single request
- Index on foreign keys
- Prepared statements for security

### Frontend
- CSS optimized for print
- Lazy loading for images
- Minified external libraries

### Caching
- Settings cached with `getSettingsWithCache`
- Session management for admin
- Static file caching

## Security

### Authentication
- Admin-only access with middleware
- Session-based authentication
- CSRF protection

### Data Validation
- Input sanitization
- SQL injection prevention
- XSS protection

### File Access
- Static files served from public directory
- Logo files validated
- Path traversal protection

## Future Enhancements

### Planned Features
1. **Email Invoice**: Send invoice via email
2. **WhatsApp Invoice**: Send invoice via WhatsApp
3. **Bulk Print**: Print multiple invoices
4. **Custom Templates**: Multiple invoice designs
5. **Digital Signature**: E-signature support

### Technical Improvements
1. **PDF Generation**: Server-side PDF generation
2. **Template Engine**: Dynamic template system
3. **Multi-language**: Internationalization support
4. **Mobile App**: Native mobile application
5. **API Integration**: RESTful API for external systems

## Support

### Contact
- **Developer**: Admin System
- **Email**: info@example.com
- **WhatsApp**: 03036783333

### Documentation
- **API Docs**: `/docs/api.md`
- **User Manual**: `/docs/user-manual.md`
- **Admin Guide**: `/docs/admin-guide.md`

### Version History
- **v1.0.0**: Initial release with basic invoice printing
- **v1.1.0**: Added PDF download functionality
- **v1.2.0**: Improved print styling and responsiveness
