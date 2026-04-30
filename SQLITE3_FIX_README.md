# 🚨 Troubleshooting: SQLite3 ELF Header Error

## Problem
```
Error: /home/user/wifiber-billing/node_modules/sqlite3/build/Release/node_sqlite3.node: invalid ELF header
```

## Cause
- SQLite3 binary compiled for different architecture
- Different Node.js version between development and production server
- Native modules not compatible with Linux server system

## Complete Solution

### ✅ **Automatic Solution (Recommended)**

#### 1. **Postinstall script already handles this:**
```bash
npm install  # Automatically runs npm rebuild
```

#### 2. **If still error, try manual:**
```bash
# Rebuild native modules
npm rebuild

# Or rebuild specific for sqlite3
npm rebuild sqlite3
```

#### 3. **Build from source for Linux:**
```bash
npm install sqlite3 --build-from-source
```

### 🔧 **Manual Solution (Advanced)**

#### 1. **Install build tools:**
```bash
sudo apt update
sudo apt install -y build-essential python3-dev libsqlite3-dev
```

#### 2. **Clean install:**
```bash
# Delete old node_modules
rm -rf node_modules package-lock.json

# Reinstall
npm install

# Rebuild for this system
npm rebuild
```

#### 3. **Force rebuild all native modules:**
```bash
# Rebuild all native modules
npm rebuild

# Or specific for sqlite3
npm install sqlite3 --build-from-source --sqlite=/usr
```

### 🎯 **Quick Fix Commands**

```bash
# Enter application directory
cd ~/gembok-bill

# Quick fix 1: Automatic rebuild
npm rebuild

# Quick fix 2: Clean install
rm -rf node_modules && npm install

# Quick fix 3: Build from source
npm install sqlite3 --build-from-source

# Quick fix 4: Install stable version
npm install sqlite3@5.1.1 --build-from-source
```

### ✅ **Installation Verification**

```bash
# Check sqlite3 version
npm list sqlite3

# Test application
npm start

# If successful, will appear:
# 🚀 CacheManager initialized with default TTL: 5 minutes
```

### 🚨 **Advanced Troubleshooting**

#### If still error after rebuild:

1. **Check Node.js version:**
```bash
node --version  # Make sure v20+
```

2. **Check system architecture:**
```bash
uname -m  # x86_64, aarch64, etc
```

3. **Check system SQLite3 library:**
```bash
ldconfig -p | grep sqlite
```

4. **Force rebuild with environment variables:**
```bash
export npm_config_build_from_source=true
export npm_config_sqlite=/usr
npm install sqlite3
```

### 📞 **Support**

If still experiencing problems:
- **WhatsApp:** 03036783333
- **GitHub Issues:** [Create Issue](https://github.com/yourofficialisp/wifiber-billing/issues)
- **Telegram:** [https://t.me/NBBWifiber](https://t.me/NBBWifiber)

---

**🎯 By following the steps above, the application will run normally on the new Linux server!**
