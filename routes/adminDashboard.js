const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const fs = require('fs');
const path = require('path');

const { getDevices } = require('../config/genieacs');
const { getActivePPPoEConnections, getInactivePPPoEUsers } = require('../config/mikrotik');
const { getSettingsWithCache } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// GET: Dashboard admin
router.get('/dashboard', adminAuth, async (req, res) => {
  let genieacsTotal = 0, genieacsOnline = 0, genieacsOffline = 0;
  let mikrotikTotal = 0, mikrotikAktif = 0, mikrotikOffline = 0;
  let settings = {};
  
  try {
    // Read settings.json
    settings = getSettingsWithCache();
    
    // GenieACS with timeout and fallback
    try {
      const devices = await Promise.race([
        getDevices(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('GenieACS timeout')), 5000)
        )
      ]);
      genieacsTotal = devices.length;
      // Consider device online if there is _lastInform within the last 1 hour
      const now = Date.now();
      genieacsOnline = devices.filter(dev => dev._lastInform && (now - new Date(dev._lastInform).getTime()) < 3600*1000).length;
      genieacsOffline = genieacsTotal - genieacsOnline;
      console.log('✅ [DASHBOARD] GenieACS data loaded successfully');
    } catch (genieacsError) {
      console.warn('⚠️ [DASHBOARD] GenieACS cannot be accessed - using default data:', genieacsError.message);
      // Set default values if GenieACS cannot be accessed
      genieacsTotal = 0;
      genieacsOnline = 0;
      genieacsOffline = 0;
      // Dashboard can still be loaded even if GenieACS has issues
    }
    
    // Mikrotik with timeout and fallback
    try {
      const aktifResult = await Promise.race([
        getActivePPPoEConnections(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Mikrotik timeout')), 5000)
        )
      ]);
      mikrotikAktif = aktifResult.success ? aktifResult.data.length : 0;
      
      const offlineResult = await Promise.race([
        getInactivePPPoEUsers(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Mikrotik timeout')), 5000)
        )
      ]);
      mikrotikOffline = offlineResult.success ? offlineResult.totalInactive : 0;
      mikrotikTotal = (offlineResult.success ? offlineResult.totalSecrets : 0);
      console.log('✅ [DASHBOARD] Mikrotik data loaded successfully');
    } catch (mikrotikError) {
      console.warn('⚠️ [DASHBOARD] Mikrotik cannot be accessed - using default data:', mikrotikError.message);
      // Set default values if Mikrotik cannot be accessed
      mikrotikTotal = 0;
      mikrotikAktif = 0;
      mikrotikOffline = 0;
      // Dashboard can still be loaded even if Mikrotik has issues
    }
  } catch (e) {
    console.error('❌ [DASHBOARD] Error in dashboard route:', e);
    // If error, leave default value 0
  }
  
  // Check if configuration validation needs to be re-run
  const shouldRevalidate = !req.session.configValidation || 
                          !req.session.configValidation.hasValidationRun ||
                          req.session.configValidation.lastValidationTime < (Date.now() - 30000); // 30 second cache

  if (shouldRevalidate) {
    console.log('🔍 [DASHBOARD] Re-running configuration validation...');
    
    // Run configuration validation asynchronously
    setImmediate(async () => {
      try {
        const { validateConfiguration, getValidationSummary, checkForDefaultSettings } = require('../config/configValidator');
        
        const validationResults = await validateConfiguration();
        const summary = getValidationSummary();
        const defaultSettingsWarnings = checkForDefaultSettings();
        
        // Update session with latest validation results
        req.session.configValidation = {
          hasValidationRun: true,
          results: validationResults,
          summary: summary,
          defaultSettingsWarnings: defaultSettingsWarnings,
          lastValidationTime: Date.now()
        };
        
        console.log('✅ [DASHBOARD] Configuration validation re-run completed');
      } catch (error) {
        console.error('❌ [DASHBOARD] Error during configuration validation re-run:', error);
      }
    });
  }

  res.render('adminDashboard', {
    title: 'Dashboard Admin',
    page: 'dashboard',
    genieacsTotal,
    genieacsOnline,
    genieacsOffline,
    mikrotikTotal,
    mikrotikAktif,
    mikrotikOffline,
    settings, // Include settings here
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge(),
    configValidation: req.session.configValidation || null // Include configuration validation results
  });
});

module.exports = router;
