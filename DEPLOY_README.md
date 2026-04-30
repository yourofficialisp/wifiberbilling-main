# 🚀 GEMBOK-BILL - Deploy Guide

## 📋 Quick Deploy

### 1. Clone Repository
```bash
git clone https://github.com/yourofficialisp/wifiber-billing
cd gembok-bill
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Settings
```bash
# Copy template settings
cp settings.server.template.json settings.json

# Edit settings according to server
nano settings.json
```

### 4. Setup Database
```bash
# Database will be created automatically on first run
# Or restore from backup:
# cp backup/billing.db data/billing.db
```

### 5. Run Application
```bash
# Development
npm run dev

# Production
npm start

# Or with PM2
pm2 start app.js --name gembok-bill
pm2 save
pm2 startup
```

## 🔧 Configuration

### Server Settings
Edit `settings.json` with your server configuration:

- **server_host**: Your server IP
- **server_port**: Application port (default: 3003)
- **genieacs_url**: URL GenieACS server
- **mikrotik_host**: IP Mikrotik router
- **admin_password**: Admin password (change from default)

### Database
- SQLite database will be created automatically at `data/billing.db`
- Backup database tersimpan di `data/backup/`
- Restore database via admin panel

### WhatsApp Bot
- WhatsApp session will be created automatically
- Scan QR code on first run
- Session saved in `whatsapp-session/`

## 📊 Features

### ✅ Backup & Restore
- Automatic database backup
- Manual backup via admin panel
- Restore database easily
- Export data to Excel

### ✅ Export Excel
- Complete customer export
- Export financial reports
- Export with styling and summary

### ✅ WhatsApp Bot
- Admin commands
- Technician commands
- Customer commands
- Auto-notifications

### ✅ Network Mapping
- ODP management
- Cable routing
- Real-time device status
- Technician access

## 🔧 Troubleshooting

### Database Error
```bash
# Check permissions
chmod 755 data/
chmod 644 data/billing.db

# Restore from backup
cp data/backup/latest.db data/billing.db
```

### Dependencies Error
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### WhatsApp Error
```bash
# Delete session and restart
rm -rf whatsapp-session/
pm2 restart gembok-bill
```

## 📞 Support

- **Documentation**: README.md
- **Issues**: GitHub Issues
- **Contact**: 03036783333

---

**GEMBOK-BILL v2.1.1** - WhatsApp Modular + Role System + Network Mapping
