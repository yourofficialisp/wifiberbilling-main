const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { getSetting } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const { adminAuth } = require('./adminAuth');
const logger = require('../config/logger');

// Database connection
const dbPath = path.join(__dirname, '../data/billing.db');
const db = new sqlite3.Database(dbPath);

/**
 * GET /admin/technicians - Technician management page
 */
router.get('/', adminAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const statusFilter = (req.query.status || '').toLowerCase() === 'all' ? 'all' : 'active';

        // Get technicians with pagination
        const technicians = await new Promise((resolve, reject) => {
            const query = `
                SELECT id, name, phone, role, is_active, created_at, last_login, area_coverage, join_date, whatsapp_group_id
                FROM technicians
                ${statusFilter === 'active' ? 'WHERE is_active = 1' : ''}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `;
            const params = [limit, offset];
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get total count
        const totalTechnicians = await new Promise((resolve, reject) => {
            const sql = statusFilter === 'active' 
                ? 'SELECT COUNT(*) as count FROM technicians WHERE is_active = 1'
                : 'SELECT COUNT(*) as count FROM technicians';
            db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        // Calculate statistics
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN role = 'technician' THEN 1 ELSE 0 END) as technician,
                    SUM(CASE WHEN role = 'field_officer' THEN 1 ELSE 0 END) as field_officer,
                    SUM(CASE WHEN role = 'collector' THEN 1 ELSE 0 END) as collector
                FROM technicians
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0] || {});
            });
        });

        const totalPages = Math.ceil(totalTechnicians / limit);

        res.render('admin/technicians', {
            title: 'Kelola Technician - Admin Panel',
            page: 'technicians',
            technicians,
            stats,
            pagination: {
                currentPage: page,
                totalPages,
                totalTechnicians,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            filterStatus: statusFilter,
            settings: {
                logo_filename: getSetting('logo_filename', 'logo.png'),
                company_header: getSetting('company_header', 'GEMBOK')
            },
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading technicians page:', error);
        res.status(500).send('Internal Server Error');
    }
});

/**
 * POST /admin/technicians/add - Add new technician
 */
router.post('/add', adminAuth, async (req, res) => {
    try {
        const { name, phone, role, notes, whatsapp_group_id } = req.body;

        // Input validation
        if (!name || !phone || !role) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, phone number, and role are required' 
            });
        }

        // Role validation
        const validRoles = ['technician', 'field_officer', 'collector'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role invalid' 
            });
        }

        // Clean phone number
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('62')) {
            cleanPhone = '0' + cleanPhone.slice(2);
        }

        // Check if phone already exists
        const existingTechnician = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM technicians WHERE phone = ?', [cleanPhone], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingTechnician) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nomor telepon sudah terdaftar' 
            });
        }

        // Insert new technician
        const result = await new Promise((resolve, reject) => {
            const sql = `
                INSERT INTO technicians (name, phone, role, area_coverage, whatsapp_group_id, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;

            db.run(sql, [name, cleanPhone, role, notes || 'Area Default', whatsapp_group_id || null], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`New technician added: ${name} (${cleanPhone}) with role: ${role}`);
            
            res.json({ 
                success: true, 
                message: 'Technician added successfully',
                technician: {
                    id: result.id,
                    name,
                    phone: cleanPhone,
                    role,
                    area_coverage: notes || 'Area Default'
                }
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to add technician' 
            });
        }

    } catch (error) {
        logger.error('Error adding technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error occurred: ' + error.message 
        });
    }
});

/**
 * GET /admin/technicians/:id - Get technician details
 */
router.get('/:id', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;

        const technician = await new Promise((resolve, reject) => {
            db.get('SELECT *, whatsapp_group_id FROM technicians WHERE id = ?', [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!technician) {
            return res.status(404).json({ 
                success: false, 
                message: 'Technician not found' 
            });
        }

        res.json({ 
            success: true, 
            technician 
        });

    } catch (error) {
        logger.error('Error getting technician details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error occurred' 
        });
    }
});

/**
 * PUT /admin/technicians/:id/update - Update technician
 */
router.put('/:id/update', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;
        const { name, phone, role, notes, whatsapp_group_id } = req.body;

        // Input validation
        if (!name || !phone || !role) {
            return res.status(400).json({
                success: false,
                message: 'Name, phone number, and role are required'
            });
        }

        // Role validation
        const validRoles = ['technician', 'field_officer', 'collector'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Role invalid' 
            });
        }

        // Clean phone number
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('62')) {
            cleanPhone = '0' + cleanPhone.slice(2);
        }

        // Check if phone already exists for other technicians
        const existingTechnician = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM technicians WHERE phone = ? AND id != ?', [cleanPhone, technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingTechnician) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number already registered by another technician' 
            });
        }

        // Update technician
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians
                SET name = ?, phone = ?, role = ?, area_coverage = ?, whatsapp_group_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            db.run(sql, [name, cleanPhone, role, notes || 'Area Default', whatsapp_group_id || null, technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`Technician updated: ${name} (${cleanPhone}) with role: ${role}`);
            
            res.json({ 
                success: true, 
                message: 'Technician updated successfully'
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Technician not found' 
            });
        }

    } catch (error) {
        logger.error('Error updating technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error occurred: ' + error.message 
        });
    }
});

/**
 * POST /admin/technicians/:id/toggle-status - Toggle technician active status
 */
router.post('/:id/toggle-status', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;
        const { is_active } = req.body;

        if (typeof is_active !== 'boolean') {
            return res.status(400).json({ 
                success: false, 
                message: 'Status must be a boolean' 
            });
        }

        // Update technician status
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians 
                SET is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            
            db.run(sql, [is_active ? 1 : 0, technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            const statusText = is_active ? 'diaktifkan' : 'dinonaktifkan';
            logger.info(`Technician ${technicianId} status ${statusText}`);
            
            res.json({ 
                success: true, 
                message: `Technician successful ${statusText}`,
                is_active: is_active
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Technician not found' 
            });
        }

    } catch (error) {
        logger.error('Error toggling technician status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error occurred: ' + error.message 
        });
    }
});

/**
 * POST /admin/technicians/bulk/activate
 * POST /admin/technicians/bulk/deactivate
 * POST /admin/technicians/bulk/delete
 */
router.post('/bulk/activate', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'No IDs selected' });

        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE technicians SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
        const result = await new Promise((resolve, reject) => {
            db.run(sql, ids, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
        });
        return res.json({ success: true, message: `Successfully activated ${result.changes} technicians` });
    } catch (error) {
        logger.error('Bulk activate technicians error:', error);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
});

router.post('/bulk/deactivate', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'No IDs selected' });

        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE technicians SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
        const result = await new Promise((resolve, reject) => {
            db.run(sql, ids, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
        });
        return res.json({ success: true, message: `Successfully deactivated ${result.changes} technicians` });
    } catch (error) {
        logger.error('Bulk deactivate technicians error:', error);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
});

router.post('/bulk/delete', adminAuth, async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
        if (ids.length === 0) return res.status(400).json({ success: false, message: 'No IDs selected' });

        // Check active jobs per technician
        const canDelete = [];
        const blocked = [];
        for (const id of ids) {
            const activeJobs = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM installation_jobs WHERE assigned_technician_id = ? AND status IN ('assigned','in_progress')`, [id], (err, row) => {
                    if (err) reject(err); else resolve(row.count);
                });
            });
            if (activeJobs > 0) blocked.push(id); else canDelete.push(id);
        }

        let changes = 0;
        if (canDelete.length) {
            const placeholders = canDelete.map(() => '?').join(',');
            const sql = `UPDATE technicians SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`;
            const result = await new Promise((resolve, reject) => {
                db.run(sql, canDelete, function(err){ if (err) reject(err); else resolve({ changes: this.changes }); });
            });
            changes = result.changes;
        }

        const msgParts = [];
        if (changes) msgParts.push(`deleted: ${changes}`);
        if (blocked.length) msgParts.push(`failed (has active job): ${blocked.length}`);
        return res.json({ success: true, message: `Bulk delete completed (${msgParts.join(', ')})`, deleted: changes, blocked });
    } catch (error) {
        logger.error('Bulk delete technicians error:', error);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
});

/**
 * DELETE /admin/technicians/:id - Delete technician (soft delete)
 */
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        const technicianId = req.params.id;

        // Check if technician has any installation jobs (all statuses)
        const totalJobs = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM installation_jobs 
                WHERE assigned_technician_id = ?
            `, [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        // Check if technician has active installation jobs
        const activeJobs = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count 
                FROM installation_jobs 
                WHERE assigned_technician_id = ? AND status IN ('assigned', 'in_progress')
            `, [technicianId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        if (activeJobs > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete technician with active tasks' 
            });
        }

        // If technician has no jobs at all → perform HARD DELETE
        if (totalJobs === 0) {
            const hardResult = await new Promise((resolve, reject) => {
                const delSql = `DELETE FROM technicians WHERE id = ?`;
                db.run(delSql, [technicianId], function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                });
            });

            if (hardResult.changes > 0) {
                logger.info(`Technician ${technicianId} hard deleted (no related jobs)`);
                return res.json({ 
                    success: true, 
                    message: 'Technician permanently deleted successfully' 
                });
            }
        }

        // Otherwise do SOFT DELETE - set is_active to 0
        const result = await new Promise((resolve, reject) => {
            const sql = `
                UPDATE technicians 
                SET is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            db.run(sql, [technicianId], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });

        if (result.changes > 0) {
            logger.info(`Technician ${technicianId} soft deleted (has historical jobs)`);
            
            res.json({ 
                success: true, 
                message: 'Technician deleted successfully'
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Technician not found' 
            });
        }

    } catch (error) {
        logger.error('Error deleting technician:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error occurred: ' + error.message 
        });
    }
});

module.exports = router;
