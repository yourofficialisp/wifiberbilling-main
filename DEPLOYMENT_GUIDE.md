# Gembok Bill Deployment Guide

This document explains how to deploy Gembok Bill application on a new server with fresh data.

## Prerequisites

- Node.js >= 14.0.0
- npm >= 6.0.0
- Access to SQLite database (for development) or MySQL (for production)
- Access to WhatsApp Business (for WhatsApp Gateway features)

## Project Structure

```
gembok-bill/
├── app.js                  # Application entry point
├── package.json            # Dependencies and scripts
├── config/                 # Configuration files
├── data/                   # Database and backup files
├── migrations/             # Database migration files
├── public/                 # Static files
├── routes/                 # API endpoints
├── scripts/                # Utility scripts
├── utils/                  # Utility functions
└── views/                  # EJS templates
```

## Installation on New Server

### 1. Clone Repository

```bash
git clone <your-repository-url>
cd gembok-bill
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Copy file [.env.example](file:///e:/gembok-bill211025/.env.example) to .env:

```bash
cp .env.example .env
```

Edit file .env with configuration appropriate for your environment:

```bash
# Database
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=gembok_bill

# WhatsApp
WHATSAPP_SESSION_PATH=./whatsapp-session
ADMIN_NUMBER=6281234567890

# Mikrotik
MIKROTIK_HOST=192.168.1.1
MIKROTIK_USER=admin
MIKROTIK_PASSWORD=password

# GenieACS
GENIEACS_URL=http://localhost:7557
GENIEACS_USERNAME=admin
GENIEACS_PASSWORD=password
```

### 4. Database Initialization

Run setup script to initialize database:

```bash
npm run setup
```

This script will:
1. Run all migration files in [migrations/](file:///e:/gembok-bill211025/migrations) folder
2. Create required table structures
3. Create required initial data

### 5. Run Additional Migrations (If Needed)

If database structure errors occur after setup, run SQL migrations manually:

```bash
npm run run-sql-migrations
```

### 6. Run Application

For production:
```bash
npm start
```

For development (with auto-reload):
```bash
npm run dev
```

## WhatsApp Configuration

1. After application runs, QR code will appear in terminal
2. Scan the QR code with WhatsApp that will be used as bot
3. After connected, bot will be ready to use

## Data Migration (If Needed)

If you have data from old system, you can use migration files in [data/backup/](file:///e:/gembok-bill211025/data/backup/) folder to import data.

## Update and Maintenance

To update application:
```bash
git pull
npm install
```

To run latest database migrations:
```bash
npm run run-sql-migrations
```

## Troubleshooting

### WhatsApp Connection Issues

If experiencing WhatsApp connection issues:
1. Make sure WhatsApp number used is not registered on other device
2. Delete WhatsApp session folder: `rm -rf ./whatsapp-session`
3. Restart application and re-scan QR code

### Database Issues

If experiencing database issues:
1. Check .env file for correct database configuration
2. Make sure database service is running
3. Run database migrations: `npm run run-sql-migrations`
4. Check application log for error details

### Error "no such column"

If error appears like "SQLITE_ERROR: no such column: invoice_type", this means database structure has not been updated. Run:

```bash
npm run run-sql-migrations
```

## Security

- Never include .env file in repository
- Use strong passwords for all services
- Limit server access only to trusted users
- Perform database backups regularly

## Support

For further assistance, please contact development team or create issue in GitHub repository.