
# 📋 DEPLOY VIA GITHUB CHECKLIST

## ✅ Pre-Deploy Checklist

### 1. Files & Directories
- [ ] All source code files have been committed to GitHub
- [ ] settings.json file has been configured for server
- [ ] .gitignore file already ignores sensitive files (database, logs, session)

### 2. Dependencies
- [ ] package.json is complete with all dependencies
- [ ] Node.js version >= 14.0.0 (recommended v18+)
- [ ] npm or yarn available on server

### 3. Database
- [ ] Database will be created automatically on first run
- [ ] Or upload database backup to server
- [ ] Make sure data/ directory exists and is writable

### 4. Server Configuration
- [ ] settings.json has been adjusted for server
- [ ] IP address, port, and credentials are correct
- [ ] WhatsApp session will be created automatically

## 🚀 Deploy Steps

### 1. Clone from GitHub
```bash
git clone https://github.com/yourofficialisp/wifiber-billing
cd gembok-bill
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configuration
```bash
# Edit settings.json according to server
nano settings.json
```

### 4. Setup Database (if not exists)
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
```

## 🔧 Post-Deploy Verification

### 1. Check Application
- [ ] Application runs without error
- [ ] Web interface can be accessed
- [ ] Database connected properly

### 2. Check Backup/Restore Features
- [ ] Admin settings page can be accessed
- [ ] Database backup feature works
- [ ] Database restore feature works

### 3. Check Export Features
- [ ] Export customers to Excel works
- [ ] Export financial report works
- [ ] Excel file can be downloaded

### 4. Check WhatsApp Bot
- [ ] WhatsApp bot connected
- [ ] QR code can be scanned
- [ ] Commands work

## ⚠️ Troubleshooting

### Database Error
- Check data/ directory permissions
- Restore from backup if needed
- Check application log for error details

### Dependencies Error
- Run npm install --force
- Check Node.js version
- Update npm if needed

### WhatsApp Error
- Delete whatsapp-session/ folder
- Restart application
- Re-scan QR code

### Backup/Restore Error
- Check backup/ directory permissions
- Check disk space
- Check application log
