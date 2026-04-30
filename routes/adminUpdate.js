const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Helper untuk menjalankan command shell
function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stderr, stdout });
            } else {
                resolve(stdout);
            }
        });
    });
}

// GET: Page Update
router.get('/', async (req, res) => {
    try {
        const settings = getSettingsWithCache();

        // Cek versi git saat ini
        let currentVersion = 'Unknown';
        let latestCommitMsg = '';
        let lastUpdate = '';

        try {
            const hash = await runCommand('git rev-parse --short HEAD', process.cwd());
            const msg = await runCommand('git log -1 --pretty=%B', process.cwd());
            const date = await runCommand('git log -1 --format=%cd', process.cwd());

            currentVersion = hash.trim();
            latestCommitMsg = msg.trim();
            lastUpdate = date.trim();
        } catch (e) {
            console.error('Git info error:', e);
        }

        res.render('admin/update', {
            title: 'System Update',
            settings,
            currentVersion,
            latestCommitMsg,
            lastUpdate,
            user: req.session.user || { name: 'Admin', role: 'admin' },
            page: 'update',
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        console.error('Render update page error:', error);
        res.status(500).send('Error loading update page');
    }
});

// POST: Cek Update
router.post('/check', async (req, res) => {
    try {
        // Fetch origin
        await runCommand('git fetch origin', process.cwd());

        // Cek status local vs remote
        const status = await runCommand('git status -uno', process.cwd());
        const log = await runCommand('git log HEAD..origin/main --oneline', process.cwd());

        let updateAvailable = false;
        if (status.includes('behind') || log.trim().length > 0) {
            updateAvailable = true;
        }

        res.json({
            success: true,
            updateAvailable,
            log: log.trim(),
            message: updateAvailable ? 'Update tersedia!' : 'Sistem sudah versi terbaru.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to check update: ' + (error.stderr || error.error.message)
        });
    }
});

// POST: Lakukan Update
router.post('/perform', async (req, res) => {
    // Set timeout lebih lama
    req.setTimeout(300000); // 5 minutes

    // Backup settings.json
    const settingsPath = path.join(process.cwd(), 'settings.json');
    const backupPath = path.join(process.cwd(), 'settings.json.pre-update-backup');
    let settingsRestored = false;

    try {
        if (fs.existsSync(settingsPath)) {
            fs.copyFileSync(settingsPath, backupPath);
            console.log('Backed up settings.json configuration');
        }
    } catch (e) {
        console.error('Failed to backup settings:', e);
        return res.status(500).json({ success: false, message: 'Failed backup settings.json, update cancelled.' });
    }

    try {
        // 1. Git Pull
        // Use 'ours' strategy for settings.json if there are conflicts, although it should be ignored
        // But regular git pull is sufficient if file is ignored
        const pullOutput = await runCommand('git pull origin main', process.cwd());

        // 2. Restore settings.json if lost or overwritten (safety net)
        // We compare if file changes drastically or is lost
        if (!fs.existsSync(settingsPath) && fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, settingsPath);
            settingsRestored = true;
            console.log('Restored settings.json from backup (file was missing)');
        }

        // 3. NPM Install
        const npmOutput = await runCommand('npm install --production', process.cwd());

        // 4. Database Migrations
        const migrateOutput = await runCommand('npm run migrate', process.cwd());

        res.json({
            success: true,
            pullOutput,
            npmOutput,
            migrateOutput,
            settingsRestored,
            message: 'Update successful! Please restart the application (manual or via button).'
        });

    } catch (error) {
        // Try to restore settings if update completely fails
        if (fs.existsSync(backupPath)) {
            try {
                fs.copyFileSync(backupPath, settingsPath);
                console.log('Restored settings.json after failed update');
            } catch (restoreErr) {
                console.error('Failed to restore settings after error:', restoreErr);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Update failed: ' + (error.stderr || error.message),
            details: error
        });
    }
});

module.exports = router;
