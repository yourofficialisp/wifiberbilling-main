# Data Management for Gembok Bill

## Database Structure

Database uses SQLite and table structure is defined in migration files in [`migrations/`](file:///e:/gembok-bill211025/migrations) folder.

## Initial Data Setup

For new server, run the following command:

```bash
npm run setup
```

This will:
1. Install all dependencies
2. Run all migration files to create database structure
3. Create required initial data

## Migration Files

All migration files are in [`migrations/`](file:///e:/gembok-bill211025/migrations) folder and run sequentially based on filename.

## Environment Configuration

Copy [.env.example](file:///e:/gembok-bill211025/.env.example) file to .env and adjust its values:

```bash
cp .env.example .env
```

Then edit .env file with configuration appropriate for your environment.

## Security

- Never include .env file or other sensitive data in repository
- Use .env.example as template for configuration
- Make sure config/superadmin.txt file only contains appropriate numbers
