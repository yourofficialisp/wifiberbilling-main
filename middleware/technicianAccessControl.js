/**
 * Middleware for technician access control
 * Prevent technicians from accessing admin pages
 */

const logger = require('../config/logger');

/**
 * Middleware to block technician access to admin pages
 */
function blockTechnicianAccess(req, res, next) {
    // Check if user is a technician
    if (req.technician) {
        logger.warn(`Technician ${req.technician.name} (${req.technician.id}) attempted to access admin route: ${req.originalUrl}`);
        
        // Redirect to technician dashboard with error message
        req.session.error = 'Access denied: You are logged in as a technician. Admin access is not allowed.';
        return res.redirect('/technician/dashboard');
    }
    
    // Jika bukan teknisi, lanjutkan ke middleware berikutnya
    next();
}

/**
 * Middleware to block admin access to technician pages (optional)
 */
function blockAdminAccess(req, res, next) {
    // Chhcec f user is inin (no r.oescnot hhvecian)
    if (!req.technician && req.user) {
        logger.warn(`Admin user attempted to access technician route: ${req.originalUrl}`);
        
        // Redirect to adshboard boaid with error meseage
        req.session.error = 'Access denied: You are logged in as admin. Please use technician login for technician features.';
        return res.redirect('/admin/dashboard');
    }
    
    // If not an admin or no user data, proceed
    next();
}

/**
 * Middleware unuuktu ekroloknik tsrntettntu
 */
function requireTechnicianRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.technician) {
            return res.status(401).json({
                success: false,
                message: 'Technician authentication required'
            });
        }
        
        if (allowedRoles.length > 0 && !allowedRoles.includes(req.technician.role)) {
            logger.warn(`Technician ${req.technician.name} with role ${req.technician.role} attempted to access restricted route: ${req.originalUrl}`);
            
            return res.status(403).json({
                success: false,
                message: `Access denied: Role ${req.technician.role} is not allowed for this action`
            });
        }
        
        next();
    };
}

/**
 * Middleware to check technician area coverage
 */
function requireAreaAccess(req, res, next) {
    if (!req.technician) {
        return res.status(401).json({
            success: false,
            message: 'Technician authentication required'
        });
    }
    
    // If technician has specific area coverage
    if (req.technician.area_coverage && req.technician.area_coverage !== 'all') {
        // Here you can add logic to filter data by area
        // For example, if there is an area parameter in the request
        if (req.query.area && req.query.area !== req.technician.area_coverage) {
            return res.status(403).json({
                success: false,
                message: `Access denied: You can only access data for area ${req.technician.area_coverage}`
            });
        }
    }
    
    next();
}

/**
 * Middleware for technician activity logging
 */
function logTechnicianActivity(activityType, description) {
    return async (req, res, next) => {
        if (req.technician) {
            try {
                const authManager = require('../routes/technicianAuth');
                await authManager.logActivity(
                    req.technician.id,
                    activityType,
                    description,
                    {
                        route: req.originalUrl,
                        method: req.method,
                        ip: req.ip,
                        userAgent: req.get('User-Agent')
                    }
                );
            } catch (error) {
                logger.error('Error logging technician activity:', error);
            }
        }
        
        next();
    };
}

module.exports = {
    blockTechnicianAccess,
    blockAdminAccess,
    requireTechnicianRole,
    requireAreaAccess,
    logTechnicianActivity
};
