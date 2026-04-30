const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../config/logger');
const { adminAuth } = require('./adminAuth');
const { getSetting } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const CableNetworkUtils = require('../utils/cableNetworkUtils');

// Middleware to get application settings
const getAppSettings = (req, res, next) => {
    req.appSettings = {
        companyHeader: getSetting('company_header', 'ISP Monitor'),
        companyName: getSetting('company_name', 'ISP Company'),
        companyAddress: getSetting('company_address', ''),
        companyPhone: getSetting('company_phone', ''),
        companyEmail: getSetting('company_email', ''),
        logoUrl: getSetting('logo_url', ''),
        whatsappNumber: getSetting('whatsapp_number', ''),
        whatsappApiKey: getSetting('whatsapp_api_key', ''),
        midtransServerKey: getSetting('midtrans_server_key', ''),
        midtransClientKey: getSetting('midtrans_client_key', ''),
        xenditSecretKey: getSetting('xendit_secret_key', ''),
        xenditPublicKey: getSetting('xendit_public_key', ''),
        timezone: getSetting('timezone', 'Asia/Karachi')
    };
    next();
};

// Database path
const dbPath = path.join(__dirname, '../data/billing.db');

// Helper function for database connection
function getDatabase() {
    return new sqlite3.Database(dbPath);
}

// ===== CABLE NETWORK DASHBOARD =====

// GET: Main Cable Network Page
router.get('/', adminAuth, getAppSettings, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Get general statistics
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    (SELECT COUNT(*) FROM odps) as total_odps,
                    (SELECT COUNT(*) FROM odps WHERE status = 'active') as active_odps,
                    (SELECT COUNT(*) FROM odps WHERE status = 'maintenance') as maintenance_odps,
                    (SELECT COUNT(*) FROM cable_routes) as total_cables,
                    (SELECT COUNT(*) FROM cable_routes WHERE status = 'connected') as connected_cables,
                    (SELECT COUNT(*) FROM customers WHERE latitude IS NOT NULL AND longitude IS NOT NULL) as mapped_customers
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0]);
            });
        });

        // Ambil ODP terbaru
        const recentODPs = await new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM odps 
                ORDER BY created_at DESC 
                LIMIT 5
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Ambil cable routes terbaru
        const recentCables = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, c.name as customer_name, c.phone as customer_phone
                FROM cable_routes cr
                LEFT JOIN customers c ON cr.customer_id = c.id
                ORDER BY cr.created_at DESC 
                LIMIT 5
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        db.close();

        res.render('admin/cable-network/dashboard', {
            title: 'Cable Network Dashboard',
            page: 'cable-network',
            stats,
            recentODPs,
            recentCables,
            appSettings: req.appSettings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });

    } catch (error) {
        logger.error('Error loading cable network dashboard:', error);
        res.status(500).render('error', { 
            error: 'Failed to load cable network dashboard',
            appSettings: req.appSettings 
        });
    }
});

// ===== ODP MANAGEMENT =====

// GET: Page ODP Management
router.get('/odp', adminAuth, getAppSettings, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Get ODP data with statistics and parent ODP info
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.*, 
                       p.name as parent_name,
                       p.code as parent_code,
                       COUNT(CASE WHEN cr.customer_id IS NOT NULL THEN cr.id END) as connected_customers,
                       COUNT(CASE WHEN cr.status = 'connected' AND cr.customer_id IS NOT NULL THEN 1 END) as active_connections
                FROM odps o
                LEFT JOIN odps p ON o.parent_odp_id = p.id
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                GROUP BY o.id
                ORDER BY o.name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get parent ODP data for dropdown (only ODPs that don't have a parent)
        const parentOdps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, name, code, capacity, used_ports, status
                FROM odps 
                WHERE parent_odp_id IS NULL AND status = 'active'
                ORDER BY name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.render('admin/cable-network/odp', {
            title: 'ODP Management',
            page: 'cable-network-odp',
            appSettings: req.appSettings,
            odps: odps,
            parentOdps: parentOdps,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading ODP page:', error);
        res.status(500).render('error', {
            message: 'Error loading ODP page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// POST: Add new ODP
router.post('/odp', adminAuth, async (req, res) => {
    try {
        const { 
            name, code, parent_odp_id, latitude, longitude, address, capacity, status, notes,
            enable_connection, from_odp_id, connection_type, cable_capacity, connection_status, connection_notes, cable_length
        } = req.body;
        
        // Input validation
        if (!name || !code || !latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Name, code, latitude, and longitude are required'
            });
        }
        
        // Coordinate validation
        if (!CableNetworkUtils.validateODPCoordinates(parseFloat(latitude), parseFloat(longitude))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid coordinates'
            });
        }
        
        const db = getDatabase();
        
        // Check if code already exists
        const existingODP = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM odps WHERE code = ?', [code], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingODP) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'ODP code already in use'
            });
        }
        
        // Insert new ODP
        const newODPId = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO odps (name, code, parent_odp_id, latitude, longitude, address, capacity, status, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [name, code, parent_odp_id || null, latitude, longitude, address, capacity || 64, status || 'active', notes], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        // If ODP connection is enabled
        if (enable_connection && from_odp_id) {
            try {
                // Validate source ODP exists
                const sourceODP = await new Promise((resolve, reject) => {
                    db.get('SELECT id, name, code FROM odps WHERE id = ?', [from_odp_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
                
                if (!sourceODP) {
                    throw new Error('Source ODP not found');
                }
                
                // Check if connection already exists
                const existingConnection = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT id FROM odp_connections 
                        WHERE (from_odp_id = ? AND to_odp_id = ?) OR (from_odp_id = ? AND to_odp_id = ?)
                    `, [from_odp_id, newODPId, newODPId, from_odp_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
                
                if (existingConnection) {
                    logger.warn(`Connection already exists between ODP ${from_odp_id} and ${newODPId}`);
                } else {
                    // Insert ODP connection
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT INTO odp_connections (from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, notes)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `, [
                            from_odp_id, 
                            newODPId, 
                            connection_type || 'fiber', 
                            cable_length || null, 
                            cable_capacity || '1G', 
                            connection_status || 'active', 
                            connection_notes || `Auto-created connection from ${sourceODP.name} to ${name}`
                        ], function(err) {
                            if (err) reject(err);
                            else resolve(this.lastID);
                        });
                    });
                    
                    logger.info(`ODP connection created: ${sourceODP.name} (${sourceODP.code}) -> ${name} (${code})`);
                }
            } catch (connectionError) {
                logger.error('Error creating ODP connection:', connectionError);
                // Don't fail entire process if connection fails
            }
        }
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP added successfully' + (enable_connection ? ' with cable connection' : ''),
            data: { id: newODPId }
        });
        
    } catch (error) {
        logger.error('Error adding ODP:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add ODP'
        });
    }
});

// PUT: Update ODP
router.put('/odp/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, parent_odp_id, latitude, longitude, address, capacity, status, notes } = req.body;
        
        // Log received data
        console.log('Updating ODP ID:', id);
        console.log('Received data:', { name, code, parent_odp_id, latitude, longitude, address, capacity, status, notes });
        
        const db = getDatabase();
        
        // Check if ODP exists before update
        const existingODP = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM odps WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!existingODP) {
            db.close();
            return res.status(404).json({
                success: false,
                message: 'ODP not found'
            });
        }
        
        console.log('Existing ODP before update:', existingODP);
        
        const result = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE odps 
                SET name = ?, code = ?, parent_odp_id = ?, latitude = ?, longitude = ?, address = ?, 
                    capacity = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [name, code, parent_odp_id || null, latitude, longitude, address, capacity, status || 'active', notes, id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        console.log('Update result:', result);
        
        // Verify data after update
        const updatedODP = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM odps WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        console.log('ODP after update:', updatedODP);
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP updated successfully',
            data: updatedODP
        });
        
    } catch (error) {
        logger.error('Error updating ODP:', error);
        console.error('Error updating ODP:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update ODP'
        });
    }
});

// DELETE: Delete ODP
router.delete('/odp/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const db = getDatabase();
        
        // Enable foreign keys for cascade delete
        await new Promise((resolve, reject) => {
            db.run("PRAGMA foreign_keys = ON", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        // Check if ODP exists
        const existingODP = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM odps WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!existingODP) {
            db.close();
            return res.status(404).json({
                success: false,
                message: 'ODP not found'
            });
        }
        
        // Delete ODP (cable_routes will be automatically deleted due to cascade delete)
        const result = await new Promise((resolve, reject) => {
            db.run('DELETE FROM odps WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: `ODP "${existingODP.name}" deleted successfully. All connected cables are also deleted.`
        });
        
    } catch (error) {
        logger.error('Error deleting ODP:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete ODP'
        });
    }
});

// ===== CABLE ROUTE MANAGEMENT =====

// GET: Page Cable Route Management
router.get('/cables', adminAuth, getAppSettings, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Get cable routes data with customer and ODP details
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude,
                       o.name as odp_name, o.code as odp_code,
                       o.latitude as odp_latitude, o.longitude as odp_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                JOIN odps o ON cr.odp_id = o.id
                ORDER BY cr.created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get ODP data for dropdown
        const odps = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM odps WHERE status = "active" ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get customers data without cable route
        const customersWithoutCable = await new Promise((resolve, reject) => {
            db.all(`
                SELECT c.* FROM customers c
                LEFT JOIN cable_routes cr ON c.id = cr.customer_id
                WHERE cr.id IS NULL AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
                ORDER BY c.name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.render('admin/cable-network/cables', {
            title: 'Cable Route Management',
            page: 'cable-network-cables',
            appSettings: req.appSettings,
            cableRoutes: cableRoutes,
            odps: odps,
            customersWithoutCable: customersWithoutCable,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading cable routes page:', error);
        res.status(500).render('error', {
            message: 'Error loading cable routes page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// POST: Add Cable Route
router.post('/cables', adminAuth, async (req, res) => {
    try {
        const { customer_id, odp_id, cable_length, cable_type, port_number, notes } = req.body;
        
        // Input validation
        if (!customer_id || !odp_id) {
            return res.status(400).json({
                success: false,
                message: 'Customer and ODP are required'
            });
        }
        
        const db = getDatabase();
        
        // Check if customer already has cable route
        const existingRoute = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM cable_routes WHERE customer_id = ?', [customer_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingRoute) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Customer already has cable route'
            });
        }
        
        // Calculate cable length automatically if not filled
        let calculatedLength = cable_length;
        if (!cable_length) {
            const customer = await new Promise((resolve, reject) => {
                db.get('SELECT latitude, longitude FROM customers WHERE id = ?', [customer_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            const odp = await new Promise((resolve, reject) => {
                db.get('SELECT latitude, longitude FROM odps WHERE id = ?', [odp_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (customer && odp) {
                calculatedLength = CableNetworkUtils.calculateCableDistance(
                    { latitude: customer.latitude, longitude: customer.longitude },
                    { latitude: odp.latitude, longitude: odp.longitude }
                );
            }
        }
        
        // Insert cable route
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO cable_routes (customer_id, odp_id, cable_length, cable_type, port_number, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [customer_id, odp_id, calculatedLength, cable_type || 'Fiber Optic', port_number, notes], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Jalur kabel added successfully',
            data: { 
                id: this.lastID,
                cable_length: calculatedLength
            }
        });
        
    } catch (error) {
        logger.error('Error adding cable route:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add cable path'
        });
    }
});

// PUT: Update Cable Route Status
router.put('/cables/:id/status', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        const db = getDatabase();
        
        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE cable_routes 
                SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [status, notes, id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'Status kabel updated successfully'
        });
        
    } catch (error) {
        logger.error('Error updating cable status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cable status'
        });
    }
});

// PUT: Update Cable Route
router.put('/cables/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { cable_type, cable_length, port_number, status, notes } = req.body;
        
        // Log received data
        console.log('Updating Cable Route ID:', id);
        console.log('Received data:', { cable_type, cable_length, port_number, status, notes });
        
        const db = getDatabase();
        
        // Check if cable route exists before update
        const existingCable = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM cable_routes WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!existingCable) {
            db.close();
            return res.status(404).json({
                success: false,
                message: 'Cable route not found'
            });
        }
        
        console.log('Existing cable route before update:', existingCable);
        
        const result = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE cable_routes 
                SET cable_type = ?, cable_length = ?, port_number = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [cable_type, cable_length, port_number, status || 'connected', notes, id], function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });
        
        console.log('Update result:', result);
        
        // Verify data after update
        const updatedCable = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM cable_routes WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        console.log('Cable route after update:', updatedCable);
        
        db.close();
        
        res.json({
            success: true,
            message: 'Cable route updated successfully',
            data: updatedCable
        });
        
    } catch (error) {
        logger.error('Error updating cable route:', error);
        console.error('Error updating cable route:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cable route'
        });
    }
});

// ===== API ENDPOINTS =====

// GET: API untuk data ODP dan Cable Routes untuk mapping
router.get('/api/mapping-data', adminAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Ambil data ODP
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.*, 
                       COUNT(cr.id) as connected_customers,
                       COUNT(CASE WHEN cr.status = 'connected' THEN 1 END) as active_connections
                FROM odps o
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                GROUP BY o.id
                ORDER BY o.name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Get cable routes data with details
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude,
                       o.name as odp_name, o.latitude as odp_latitude, o.longitude as odp_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                JOIN odps o ON cr.odp_id = o.id
                WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Ambil data network segments
        const networkSegments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ns.*, 
                       o1.name as start_odp_name, o1.latitude as start_latitude, o1.longitude as start_longitude,
                       o2.name as end_odp_name, o2.latitude as end_latitude, o2.longitude as end_longitude
                FROM network_segments ns
                JOIN odps o1 ON ns.start_odp_id = o1.id
                LEFT JOIN odps o2 ON ns.end_odp_id = o2.id
                WHERE ns.status = 'active'
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        // Analisis statistik
        const odpAnalysis = CableNetworkUtils.analyzeODPCapacity(odps);
        const cableAnalysis = CableNetworkUtils.analyzeCableStatus(cableRoutes);
        
        res.json({
            success: true,
            data: {
                odps: odps,
                cableRoutes: cableRoutes,
                networkSegments: networkSegments,
                analysis: {
                    odps: odpAnalysis,
                    cables: cableAnalysis
                }
            }
        });
        
    } catch (error) {
        logger.error('Error getting mapping data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get mapping data'
        });
    }
});

// GET: Page Analytics
router.get('/analytics', adminAuth, getAppSettings, async (req, res) => {
    try {
        res.render('admin/cable-network/analytics', {
            title: 'Cable Network Analytics',
            page: 'cable-network-analytics',
            appSettings: req.appSettings,
            versionInfo: getVersionInfo(),
            versionBadge: getVersionBadge()
        });
    } catch (error) {
        logger.error('Error loading analytics page:', error);
        res.status(500).render('error', {
            message: 'Error loading analytics page',
            error: error.message,
            appSettings: req.appSettings
        });
    }
});

// GET: API untuk statistik cable network
router.get('/api/statistics', adminAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Statistik ODP
        const odpStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_odps,
                    SUM(capacity) as total_capacity,
                    SUM(used_ports) as total_used_ports,
                    COUNT(CASE WHEN status = 'active' THEN 1 END) as active_odps,
                    COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_odps
                FROM odps
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        // Statistik Cable Routes
        const cableStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_cables,
                    SUM(cable_length) as total_length,
                    COUNT(CASE WHEN status = 'connected' THEN 1 END) as connected_cables,
                    COUNT(CASE WHEN status = 'disconnected' THEN 1 END) as disconnected_cables,
                    COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_cables,
                    COUNT(CASE WHEN status = 'damaged' THEN 1 END) as damaged_cables
                FROM cable_routes
            `, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: {
                odps: odpStats,
                cables: cableStats,
                utilization: odpStats.total_capacity > 0 ? 
                    (odpStats.total_used_ports / odpStats.total_capacity) * 100 : 0
            }
        });
        
    } catch (error) {
        logger.error('Error getting statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get statistics'
        });
    }
});

// GET: API untuk analytics data
router.get('/api/analytics', adminAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Get ODP data with statistics
        const odps = await new Promise((resolve, reject) => {
            db.all(`
                SELECT o.*, 
                       COUNT(CASE WHEN cr.customer_id IS NOT NULL THEN cr.id END) as connected_customers,
                       COUNT(CASE WHEN cr.status = 'connected' AND cr.customer_id IS NOT NULL THEN 1 END) as active_connections
                FROM odps o
                LEFT JOIN cable_routes cr ON o.id = cr.odp_id
                GROUP BY o.id
                ORDER BY o.name
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Ambil data cable routes
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude,
                       o.name as odp_name, o.latitude as odp_latitude, o.longitude as odp_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                JOIN odps o ON cr.odp_id = o.id
                WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        // Analyze data for analytics
        const odpAnalysis = CableNetworkUtils.analyzeODPCapacity(odps);
        const cableAnalysis = CableNetworkUtils.analyzeCableStatus(cableRoutes);
        
        // Calculate utilization rate
        const totalCapacity = odpAnalysis.totalCapacity;
        const totalUsed = odpAnalysis.totalUsed;
        const utilization = totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0;
        
        // Calculate health score
        const connectedCables = cableAnalysis.connected;
        const totalCables = cableAnalysis.total;
        const healthScore = totalCables > 0 ? (connectedCables / totalCables) * 100 : 100;
        
        // Generate alerts
        const alerts = [];
        
        // Alert for ODP with high capacity
        odpAnalysis.critical.forEach(odp => {
            alerts.push({
                type: 'danger',
                icon: 'bx-error-circle',
                title: 'Critical ODP Capacity',
                message: `${odp.name} is at ${((odp.used_ports / odp.capacity) * 100).toFixed(1)}% capacity`
            });
        });
        
        // Alert for disconnected cables
        if (cableAnalysis.disconnected > 0) {
            alerts.push({
                type: 'warning',
                icon: 'bx-wifi-off',
                title: 'Disconnected Cables',
                message: `${cableAnalysis.disconnected} cables are disconnected`
            });
        }
        
        // Alert for damaged cables
        if (cableAnalysis.damaged > 0) {
            alerts.push({
                type: 'danger',
                icon: 'bx-error',
                title: 'Damaged Cables',
                message: `${cableAnalysis.damaged} cables are damaged and need repair`
            });
        }
        
        // Top ODPs by usage
        const topODPs = odps
            .sort((a, b) => (b.used_ports / b.capacity) - (a.used_ports / a.capacity))
            .slice(0, 5);
        
        // Simulate trend data (in real implementation, this will be taken from historical data)
        const utilizationTrend = {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            data: [65, 70, 75, 68, 72, utilization]
        };
        
        // Simulasi performance metrics
        const performance = {
            avgUptime: 99.5,
            avgResponseTime: 15,
            maintenanceCount: 3
        };
        
        // Simulasi cost analysis
        const totalCableLength = cableRoutes.reduce((sum, route) => 
            sum + (parseFloat(route.cable_length) || 0), 0);
        const costPerKm = 25000; // IDR per km
        const totalInvestment = totalCableLength * costPerKm;
        
        const cost = {
            costPerKm: costPerKm,
            totalInvestment: totalInvestment
        };
        
        res.json({
            success: true,
            data: {
                odps: {
                    total: odpAnalysis.total,
                    healthy: odpAnalysis.healthy.length,
                    warning: odpAnalysis.warning.length,
                    critical: odpAnalysis.critical.length,
                    utilization: odpAnalysis.utilization,
                    heatmap: odps.map(odp => ({
                        name: odp.name,
                        code: odp.code,
                        used_ports: odp.used_ports,
                        capacity: odp.capacity
                    }))
                },
                cables: {
                    total: cableAnalysis.total,
                    connected: cableAnalysis.connected,
                    disconnected: cableAnalysis.disconnected,
                    maintenance: cableAnalysis.maintenance,
                    damaged: cableAnalysis.damaged,
                    healthPercentage: cableAnalysis.healthPercentage,
                    totalLength: totalCableLength
                },
                utilization: utilization,
                healthScore: healthScore,
                alerts: alerts,
                topODPs: topODPs,
                utilizationTrend: utilizationTrend,
                performance: performance,
                cost: cost
            }
        });
        
    } catch (error) {
        logger.error('Error getting analytics data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get analytics data'
        });
    }
});

// GET: API untuk cable routes berdasarkan ODP ID
router.get('/api/odp/:id/cable-routes', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        
        const cableRoutes = await new Promise((resolve, reject) => {
            db.all(`
                SELECT cr.*, 
                       c.name as customer_name, c.phone as customer_phone,
                       c.latitude as customer_latitude, c.longitude as customer_longitude
                FROM cable_routes cr
                JOIN customers c ON cr.customer_id = c.id
                WHERE cr.odp_id = ?
                ORDER BY cr.created_at DESC
            `, [id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: cableRoutes
        });
        
    } catch (error) {
        logger.error('Error getting cable routes for ODP:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get cable routes for ODP'
        });
    }
});

// ===== ODP CONNECTIONS MANAGEMENT =====

// GET: Page ODP Connections
router.get('/odp-connections', adminAuth, getAppSettings, async (req, res) => {
    try {
        const db = getDatabase();
        
        // Ambil data ODP connections
        const connections = await new Promise((resolve, reject) => {
            db.all(`
                SELECT oc.*, 
                       from_odp.name as from_odp_name, from_odp.code as from_odp_code,
                       to_odp.name as to_odp_name, to_odp.code as to_odp_code
                FROM odp_connections oc
                JOIN odps from_odp ON oc.from_odp_id = from_odp.id
                JOIN odps to_odp ON oc.to_odp_id = to_odp.id
                ORDER BY oc.created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        // Ambil data ODP untuk dropdown
        const odps = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM odps WHERE status = "active" ORDER BY name', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.render('admin/cable-network/odp-connections', {
            title: 'ODP Backbone Connections',
            connections: connections,
            odps: odps,
            settings: req.settings
        });
        
    } catch (error) {
        logger.error('Error loading ODP connections page:', error);
        res.status(500).render('error', {
            message: 'Failed to load ODP connections page',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

// GET: API untuk ODP connections
router.get('/api/odp-connections', adminAuth, async (req, res) => {
    try {
        const db = getDatabase();
        
        const connections = await new Promise((resolve, reject) => {
            db.all(`
                SELECT oc.*, 
                       from_odp.name as from_odp_name, from_odp.code as from_odp_code,
                       to_odp.name as to_odp_name, to_odp.code as to_odp_code
                FROM odp_connections oc
                JOIN odps from_odp ON oc.from_odp_id = from_odp.id
                JOIN odps to_odp ON oc.to_odp_id = to_odp.id
                ORDER BY oc.created_at DESC
            `, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            data: connections
        });
        
    } catch (error) {
        logger.error('Error getting ODP connections:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get ODP connections data'
        });
    }
});

// POST: Add ODP connection
router.post('/api/odp-connections', adminAuth, async (req, res) => {
    try {
        const { from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, installation_date, notes, polyline_geojson } = req.body;
        
        // Validasi
        if (!from_odp_id || !to_odp_id) {
            return res.status(400).json({
                success: false,
                message: 'From ODP and To ODP must be filled'
            });
        }
        
        if (from_odp_id === to_odp_id) {
            return res.status(400).json({
                success: false,
                message: 'From ODP and To ODP cannot be the same'
            });
        }
        
        const db = getDatabase();

        // Ensure optional column exists (idempotent)
        try {
            await new Promise((resolve) => {
                db.run('ALTER TABLE odp_connections ADD COLUMN polyline_geojson TEXT', () => resolve());
            });
        } catch (_) { /* ignore */ }
        
        // Check if connection already exists
        const existingConnection = await new Promise((resolve, reject) => {
            db.get(`
                SELECT id FROM odp_connections 
                WHERE (from_odp_id = ? AND to_odp_id = ?) OR (from_odp_id = ? AND to_odp_id = ?)
            `, [from_odp_id, to_odp_id, to_odp_id, from_odp_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (existingConnection) {
            db.close();
            return res.status(400).json({
                success: false,
                message: 'Connection between these ODPs already exists'
            });
        }
        
        // Insert connection (with optional polyline)
        const result = await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO odp_connections (
                    from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, installation_date, notes, polyline_geojson
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, installation_date, notes, polyline_geojson || null], function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
        });
        
        db.close();
        
        res.json({
            success: true,
            message: 'ODP connection added successfully',
            data: { id: result.id }
        });
        
    } catch (error) {
        logger.error('Error adding ODP connection:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add ODP connection'
        });
    }
});

// PUT: Update ODP connection
router.put('/api/odp-connections/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, installation_date, notes, polyline_geojson } = req.body;
        
        const db = getDatabase();

        // Ensure optional column exists (idempotent)
        try {
            await new Promise((resolve) => {
                db.run('ALTER TABLE odp_connections ADD COLUMN polyline_geojson TEXT', () => resolve());
            });
        } catch (_) { /* ignore */ }
        
        const result = await new Promise((resolve, reject) => {
            db.run(`
                UPDATE odp_connections 
                SET from_odp_id = ?, to_odp_id = ?, connection_type = ?, cable_length = ?, 
                    cable_capacity = ?, status = ?, installation_date = ?, notes = ?, polyline_geojson = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [from_odp_id, to_odp_id, connection_type, cable_length, cable_capacity, status, installation_date, notes, polyline_geojson || null, id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
        
        db.close();
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'ODP connection not found'
            });
        }
        
        res.json({
            success: true,
            message: 'ODP connection successfully updated'
        });
        
    } catch (error) {
        logger.error('Error updating ODP connection:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update ODP connection'
        });
    }
});

// DELETE: Delete ODP connection
router.delete('/api/odp-connections/:id', adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDatabase();
        
        const result = await new Promise((resolve, reject) => {
            db.run('DELETE FROM odp_connections WHERE id = ?', [id], function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            });
        });
        
        db.close();
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'ODP connection not found'
            });
        }
        
        res.json({
            success: true,
            message: 'ODP connection deleted successfully'
        });
        
    } catch (error) {
        logger.error('Error deleting ODP connection:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete ODP connection'
        });
    }
});

module.exports = router;
