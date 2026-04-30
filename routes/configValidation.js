const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { validateConfiguration, getValidationSummary, checkForDefaultSettings } = require('../config/configValidator');

/**
 * API for system configuration validation
 * Can be called manually by admin
 */

// GET: Manual validation trigger
router.get('/validate', adminAuth, async (req, res) => {
    try {
        console.log('🔍 [MANUAL_VALIDATION] Admin triggered manual configuration validation...');
        
        // Run validation
        const validationResults = await validateConfiguration();
        const summary = getValidationSummary();
        const defaultSettingsWarnings = checkForDefaultSettings();
        
        // Save results to session
        req.session.configValidation = {
            hasValidationRun: true,
            results: validationResults,
            summary: summary,
            defaultSettingsWarnings: defaultSettingsWarnings,
            lastValidationTime: Date.now()
        };
        
        console.log('✅ [MANUAL_VALIDATION] Manual validation completed');
        
        res.json({
            success: true,
            message: 'Configuration validation completed',
            data: {
                results: validationResults,
                summary: summary,
                defaultSettingsWarnings: defaultSettingsWarnings
            }
        });
        
    } catch (error) {
        console.error('❌ [MANUAL_VALIDATION] Error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed menjalankan validasi konfigurasi',
            error: error.message
        });
    }
});

// GET: Get current validation status
router.get('/status', adminAuth, (req, res) => {
    try {
        const configValidation = req.session.configValidation;
        
        if (!configValidation || !configValidation.hasValidationRun) {
            return res.json({
                success: true,
                message: 'Validasi belum dijalankan',
                data: {
                    hasRun: false,
                    results: null,
                    summary: null,
                    defaultSettingsWarnings: []
                }
            });
        }
        
        res.json({
            success: true,
            message: 'Status validasi konfigurasi',
            data: {
                hasRun: true,
                results: configValidation.results,
                summary: configValidation.summary,
                defaultSettingsWarnings: configValidation.defaultSettingsWarnings
            }
        });
        
    } catch (error) {
        console.error('❌ [VALIDATION_STATUS] Error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to get validation status',
            error: error.message
        });
    }
});

// POST: Clear validation results from session
router.post('/clear', adminAuth, (req, res) => {
    try {
        delete req.session.configValidation;
        
        console.log('✅ [VALIDATION_CLEAR] Hasil validasi dihapus dari session');
        
        res.json({
            success: true,
            message: 'Hasil validasi deleted successfully'
        });
        
    } catch (error) {
        console.error('❌ [VALIDATION_CLEAR] Error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to delete validation result',
            error: error.message
        });
    }
});

module.exports = router;
