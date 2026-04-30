const express = require('express');
const router = express.Router();
const { getSetting } = require('../config/settingsManager');
const { validateConfiguration, getValidationSummary, checkForDefaultSettings } = require('../config/configValidator');

// function getAdminCredentials removed, using getSetting directly in login route
// Cache removed to fix issue where password changes are not reflected immediately
// settingsManager already handles file I/O caching efficiently

// Middleware cek login admin
function adminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    // Check if this is an API request
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
    } else {
      res.redirect('/admin/login');
    }
  }
}

// GET: Page login admin
router.get('/login', (req, res) => {
  res.render('adminLogin', { error: null });
});

// Test route untuk debugging
router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes working!', timestamp: new Date().toISOString() });
});

// Route mobile login has been moved to app.js to avoid conflicts

// Route mobile login has been moved to app.js to avoid conflicts

// POST: Proses login admin - Optimized
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Get fresh credentials every time
    const credentials = {
      username: getSetting('admin_username', 'admin'),
      password: getSetting('admin_password', 'admin')
    };

    // Fast validation
    if (!username || !password) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(400).json({ success: false, message: 'Username and password must be filled!' });
      } else {
        return res.render('adminLogin', { error: 'Username and password must be filled!' });
      }
    }

    // Autentikasi dengan cache
    if (username === credentials.username && password === credentials.password) {
      req.session.isAdmin = true;
      req.session.adminUser = username;

      // Validate system configuration after successful login (non-blocking)
      // Jalankan validasi secara asinkron tanpa menghambat login
      setImmediate(() => {
        console.log('🔍 [ADMIN_LOGIN] Validating system configuration asynchronously...');

        validateConfiguration().then(validationResults => {
          console.log('🔍 [ADMIN_LOGIN] Validation complete, saving results to session...');

          // Save hasil validasi ke session untuk ditampilkan di dashboard
          // Always save the result, whether valid or invalid
          req.session.configValidation = {
            hasValidationRun: true,
            results: validationResults,
            summary: getValidationSummary(),
            defaultSettingsWarnings: checkForDefaultSettings(),
            lastValidationTime: Date.now()
          };

          if (!validationResults.overall.isValid) {
            console.log('⚠️ [ADMIN_LOGIN] System configuration has issues - warning will be displayed on dashboard');
          } else {
            console.log('✅ [ADMIN_LOGIN] Konfigurasi sistem valid');
          }
        }).catch(error => {
          console.error('❌ [ADMIN_LOGIN] Error saat validasi konfigurasi:', error);
          // Save error state tapi tetap biarkan admin login
          req.session.configValidation = {
            hasValidationRun: true,
            results: null,
            summary: { status: 'error', message: 'Failed to validate system configuration' },
            defaultSettingsWarnings: [],
            lastValidationTime: Date.now()
          };
        });
      });

      // Fast response untuk AJAX
      if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        res.json({ success: true, message: 'Login successful!' });
      } else {
        res.redirect('/admin/dashboard');
      }
    } else {
      // Fast error response
      if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        res.status(401).json({ success: false, message: 'Username atau password salah!' });
      } else {
        res.render('adminLogin', { error: 'Username atau password salah.' });
      }
    }
  } catch (error) {
    console.error('Login error:', error);

    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      res.status(500).json({ success: false, message: 'Error occurred during login!' });
    } else {
      res.render('adminLogin', { error: 'Error occurred during login.' });
    }
  }
});

// GET: Redirect /admin to dashboard
router.get('/', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login');
  }
});

// GET: Logout admin
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

module.exports = { router, adminAuth };
