const express = require('express');
const router = express.Router();
const { getSetting } = require('../config/settingsManager');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');
const { findDeviceByTag } = require('../config/addWAN');
const { 
  createTroubleReport, 
  getTroubleReportsByPhone, 
  updateTroubleReportStatus,
  getTroubleReportById
} = require('../config/troubleReport');

// Middleware to ensure customer is logged in
function customerAuth(req, res, next) {
  console.log('🔍 customerAuth middleware - Session:', req.session);
  console.log('🔍 customerAuth middleware - Session phone:', req.session?.phone);
  console.log('🔍 customerAuth middleware - Session customer_username:', req.session?.customer_username);
  
  const phone = req.session && (req.session.phone || req.session.customer_phone);
  const username = req.session && req.session.customer_username;
  
  if (!phone && !username) {
    console.log('❌ customerAuth: No session phone or username, redirecting to login');
    return res.redirect('/customer/login');
  }
  
  // Set phone in session if not present but username is available
  if (!req.session.phone && username) {
    // Try to get phone from billing system
    const billingManager = require('../config/billing');
    billingManager.getCustomerByUsername(username).then(customer => {
      if (customer && customer.phone) {
        req.session.phone = customer.phone;
      }
    }).catch(err => {
      console.log('Warning: Could not get customer phone from username:', err.message);
    });
  }
  
  console.log('✅ customerAuth: Session valid, phone:', phone, 'username:', username);
  next();
}

// GET: Page form laporan gangguan
router.get('/report', customerAuth, async (req, res) => {
  const phone = req.session.phone;
  
  // Get customer data from GenieACS
  const device = await findDeviceByTag(phone);
  const customerName = device?.Tags?.find(tag => tag !== phone) || '';
  const location = device?.Tags?.join(', ') || '';
  
  // Get trouble categories from settings
  const categoriesString = getSetting('trouble_report.categories', 'Slow Internet,Cannot Browse,WiFi Not Showing,Intermittent Connection,Other');
  const categories = categoriesString.split(',').map(cat => cat.trim());
  
  // Get previous trouble reports
  const previousReports = getTroubleReportsByPhone(phone);
  
  // Render trouble report form page
  res.render('trouble-report-form', {
    phone,
    customerName,
    location,
    categories,
    previousReports,
    companyHeader: getSetting('company_header', 'ISP Monitor'),
    footerInfo: getSetting('footer_info', ''),
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge()
  });
});

// Alias: /customer/trouble/simple -> redirect to /customer/trouble/report
router.get('/simple', (req, res) => {
  return res.redirect('/customer/trouble/report');
});

// POST: Submit trouble report
router.post('/report', customerAuth, async (req, res) => {
  const phone = req.session.phone;
  const { name, location, category, description } = req.body;
  
  console.log('📝 POST /trouble/report - Session phone:', phone);
  console.log('📋 Request body:', req.body);
  
  // Validate input
  if (!category || !description) {
    console.log('❌ Validation failed: missing category or description');
    return res.status(400).json({
      success: false,
      message: 'Category and problem description are required'
    });
  }
  
  // Create new trouble report
  const report = createTroubleReport({
    phone,
    name,
    location,
    category,
    description
  });
  
  if (!report) {
    console.log('❌ Failed to create trouble report');
    return res.status(500).json({
      success: false,
      message: 'Failed to create trouble report'
    });
  }
  
  console.log('✅ Trouble report created successfully:', report.id);
  
  console.log('✅ Sending JSON response:', {
    success: true,
    message: 'Trouble report created successfully',
    reportId: report.id
  });
  
  // Redirect to report detail page
  res.json({
    success: true,
    message: 'Trouble report created successfully',
    reportId: report.id
  });
});

// GET: Test route for debugging (without session)
router.get('/test', async (req, res) => {
  console.log('🧪 GET /trouble/test - Query params:', req.query);
  
  const { name, phone, location, category, description } = req.query;
  
  // Validate input
  if (!category || !description) {
    return res.status(400).json({
      success: false,
      message: 'Category and problem description are required'
    });
  }
  
  // Create new trouble report
  const report = createTroubleReport({
    phone: phone || '081321960111',
    name: name || 'Test Customer',
    location: location || 'Test Location',
    category,
    description
  });
  
  if (!report) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create trouble report'
    });
  }
  
  console.log('✅ Test trouble report created successfully:', report.id);
  
  res.json({
    success: true,
    message: 'Trouble report created successfully (test)',
    reportId: report.id
  });
});

// POST: Test route for debugging (without session)
router.post('/test', async (req, res) => {
  console.log('🧪 POST /trouble/test - Body:', req.body);
  
  const { name, phone, location, category, description } = req.body;
  
  // Validate input
  if (!category || !description) {
    return res.status(400).json({
      success: false,
      message: 'Category and problem description are required'
    });
  }
  
  // Create new trouble report
  const report = createTroubleReport({
    phone: phone || '081321960111',
    name: name || 'Test Customer',
    location: location || 'Test Location',
    category,
    description
  });
  
  if (!report) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create trouble report'
    });
  }
  
  console.log('✅ Test trouble report created successfully:', report.id);
  
  res.json({
    success: true,
    message: 'Trouble report created successfully (test POST)',
    reportId: report.id
  });
});

// GET: Customer trouble report list page
router.get('/list', customerAuth, (req, res) => {
  const phone = req.session.phone;
  
  // Get all customer trouble reports
  const reports = getTroubleReportsByPhone(phone);
  
  // Render report list page
  res.render('trouble-report-list', {
    phone,
    reports,
    companyHeader: getSetting('company_header', 'ISP Monitor'),
    footerInfo: getSetting('footer_info', ''),
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge()
  });
});

// GET: Trouble report detail page
router.get('/detail/:id', customerAuth, (req, res) => {
  const phone = req.session.phone;
  const reportId = req.params.id;
  
  // Get report details
  const report = getTroubleReportById(reportId);
  
  // Validate report exists and belongs to logged-in customer
  if (!report || report.phone !== phone) {
    return res.redirect('/customer/trouble/list');
  }
  
  // Render report detail page
  res.render('trouble-report-detail', {
    phone,
    report,
    companyHeader: getSetting('company_header', 'ISP Monitor'),
    footerInfo: getSetting('footer_info', ''),
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge()
  });
});

// POST: Add comment to report
router.post('/comment/:id', customerAuth, (req, res) => {
  const phone = req.session.phone;
  const reportId = req.params.id;
  const { comment } = req.body;
  
  // Get report details
  const report = getTroubleReportById(reportId);
  
  // Validate report exists and belongs to logged-in customer
  if (!report || report.phone !== phone) {
    return res.status(403).json({
      success: false,
      message: 'Report not found or you do not have access'
    });
  }
  
  // Update report with new comment
  const updatedReport = updateTroubleReportStatus(reportId, report.status, `[Customer]: ${comment}`);
  
  if (!updatedReport) {
    return res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
  
  res.json({
    success: true,
    message: 'Comment added successfully'
  });
});

// POST: Close report (only if status is resolved)
router.post('/close/:id', customerAuth, (req, res) => {
  const phone = req.session.phone;
  const reportId = req.params.id;
  
  // Get report details
  const report = getTroubleReportById(reportId);
  
  // Validate report exists and belongs to logged-in customer
  if (!report || report.phone !== phone) {
    return res.status(403).json({
      success: false,
      message: 'Report not found or you do not have access'
    });
  }
  
  // Can only close report if status is resolved
  if (report.status !== 'resolved') {
    return res.status(400).json({
      success: false,
      message: 'Only reports with "Resolved" status can be closed'
    });
  }

  // Update report status to closed
  const updatedReport = updateTroubleReportStatus(reportId, 'closed', 'Report closed by customer');

  if (!updatedReport) {
    return res.status(500).json({
      success: false,
      message: 'Failed to close report'
    });
  }
  
  res.json({
    success: true,
    message: 'Report closed successfully'
  });
});

module.exports = router;
