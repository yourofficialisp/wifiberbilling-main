const express = require('express');
const router = express.Router();
const { adminAuth } = require('./adminAuth');
const { 
  getAllTroubleReports, 
  getTroubleReportById, 
  updateTroubleReportStatus 
} = require('../config/troubleReport');
const { getVersionInfo, getVersionBadge } = require('../config/version-utils');

// Middleware admin auth untuk semua route
router.use(adminAuth);

// GET: Page list of all trouble reports
router.get('/', (req, res) => {
  // Get all trouble reports
  const reports = getAllTroubleReports();
  
  // Hitung jumlah laporan berdasarkan status
  const stats = {
    total: reports.length,
    open: reports.filter(r => r.status === 'open').length,
    inProgress: reports.filter(r => r.status === 'in_progress').length,
    resolved: reports.filter(r => r.status === 'resolved').length,
    closed: reports.filter(r => r.status === 'closed').length
  };
  
  // Render halaman admin laporan gangguan
  res.render('admin/trouble-reports', {
    reports,
    stats,
    title: 'Management Trouble Report',
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge()
  });
});

// GET: Page detail laporan gangguan
router.get('/detail/:id', (req, res) => {
  const reportId = req.params.id;
  
  // Get report details
  const report = getTroubleReportById(reportId);
  
  // Validasi laporan ditemukan
  if (!report) {
    req.flash('error', 'Laporan gangguan not found');
    return res.redirect('/admin/trouble');
  }
  
  // Render halaman detail laporan
  res.render('admin/trouble-report-detail', {
    report,
    title: `Detail Laporan #${reportId}`,
    versionInfo: getVersionInfo(),
    versionBadge: getVersionBadge()
  });
});

// POST: Update status laporan gangguan
router.post('/update-status/:id', (req, res) => {
  const reportId = req.params.id;
  const { status, notes, sendNotification } = req.body;
  
  // Validasi status
  const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Status invalid'
    });
  }
  
  // Update status laporan dengan parameter sendNotification
  const updatedReport = updateTroubleReportStatus(reportId, status, notes, sendNotification);
  
  if (!updatedReport) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update report status'
    });
  }
  
  res.json({
    success: true,
    message: 'Report status successfully updated',
    report: updatedReport
  });
});

// POST: Add note to report without changing status
router.post('/add-note/:id', (req, res) => {
  const reportId = req.params.id;
  const { notes } = req.body;
  
  // Get report details to get current status
  const report = getTroubleReportById(reportId);
  
  if (!report) {
    return res.status(404).json({
      success: false,
      message: 'Laporan not found'
    });
  }
  
  // Update report with new note without changing status
  const updatedReport = updateTroubleReportStatus(reportId, report.status, notes);
  
  if (!updatedReport) {
    return res.status(500).json({
      success: false,
      message: 'Failed to add note'
    });
  }
  
  res.json({
    success: true,
    message: 'Notes added successfully',
    report: updatedReport
  });
});

module.exports = router;
