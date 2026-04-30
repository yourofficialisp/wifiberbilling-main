const express = require('express');
const router = express.Router();
const { createTroubleReport, updateTroubleReportStatus } = require('../config/troubleReport');
const logger = require('../config/logger');

// Simple test endpoint GET
router.get('/test-simple', async (req, res) => {
  try {
    logger.info('🧪 Simple test endpoint: Creating trouble report...');
    
    const testReport = {
      phone: '081234567890',
      name: 'Test User Simple',
      location: 'Test Location Simple',
      category: 'Slow Internet',
      description: 'Test description of slow internet problem for testing WhatsApp notification - simple endpoint'
    };
    
    const newReport = createTroubleReport(testReport);
    
    if (newReport) {
      logger.info(`✅ Trouble report successfully created with ID: ${newReport.id}`);
      
      // Test update status after 3 seconds
      setTimeout(async () => {
        logger.info(`🔄 Test update status for report ${newReport.id}...`);
        const updatedReport = updateTroubleReportStatus(
          newReport.id, 
          'in_progress', 
          'Test update status from simple endpoint - being handled',
          true // sendNotification = true
        );
        
        if (updatedReport) {
          logger.info(`✅ Report status successfully updated to: ${updatedReport.status}`);
        }
      }, 3000);
      
      res.json({
        success: true,
        message: 'Test trouble report successfully executed',
        report: newReport,
        note: 'Status will be automatically updated in 3 seconds'
      });
    } else {
      logger.error('❌ Failed to create trouble report');
      res.status(500).json({
        success: false,
        message: 'Failed to create trouble report'
      });
    }
  } catch (error) {
    logger.error(`❌ Error in test simple trouble report: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error in test simple trouble report',
      error: error.message
    });
  }
});

// Test endpoint to create trouble report
router.post('/create', async (req, res) => {
  try {
    logger.info('🧪 Test endpoint: Creating new trouble report...');
    
    const testReport = {
      phone: req.body.phone || '081234567890',
      name: req.body.name || 'Test User',
      location: req.body.location || 'Test Location',
      category: req.body.category || 'Slow Internet',
      description: req.body.description || 'Test description of slow internet problem for testing WhatsApp notification'
    };
    
    const newReport = createTroubleReport(testReport);
    
    if (newReport) {
      logger.info(`✅ Trouble report successfully created with ID: ${newReport.id}`);
      res.json({
        success: true,
        message: 'Trouble report successfully created',
        report: newReport
      });
    } else {
      logger.error('❌ Failed to create trouble report');
      res.status(500).json({
        success: false,
        message: 'Failed to create trouble report'
      });
    }
  } catch (error) {
    logger.error(`❌ Error in test create trouble report: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error in test create trouble report',
      error: error.message
    });
  }
});

// Test endpoint to update report status
router.post('/update/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const { status, notes, sendNotification } = req.body;
    
    logger.info(`🧪 Test endpoint: Update report status ${reportId}...`);
    
    const updatedReport = updateTroubleReportStatus(
      reportId, 
      status || 'in_progress', 
      notes || 'Test update status from test endpoint',
      sendNotification !== undefined ? sendNotification : true
    );
    
    if (updatedReport) {
      logger.info(`✅ Report status successfully updated to: ${updatedReport.status}`);
      res.json({
        success: true,
        message: 'Report status successfully updated',
        report: updatedReport
      });
    } else {
      logger.error('❌ Failed to update report status');
      res.status(500).json({
        success: false,
        message: 'Failed to update report status'
      });
    }
  } catch (error) {
    logger.error(`❌ Error in test update trouble report: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error in test update trouble report',
      error: error.message
    });
  }
});

// Test endpoint to send manual notification
router.post('/notify/:id', async (req, res) => {
  try {
    const reportId = req.params.id;
    const { sendNotificationToTechnicians, sendStatusUpdateToCustomer } = require('../config/troubleReport');
    
    logger.info(`🧪 Test endpoint: Sending manual notification for report ${reportId}...`);
    
    // Get report data
    const { getTroubleReportById } = require('../config/troubleReport');
    const report = getTroubleReportById(reportId);
    
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }
    
    const results = {};
    
    // Test notification to technician
    if (req.body.toTechnicians !== false) {
      logger.info('📤 Sending notification to technician...');
      results.technicianNotification = await sendNotificationToTechnicians(report);
    }
    
    // Test notification to customer
    if (req.body.toCustomer !== false) {
      logger.info('📤 Sending notification to customer...');
      results.customerNotification = await sendStatusUpdateToCustomer(report);
    }
    
    res.json({
      success: true,
      message: 'Test notification completed',
      results
    });
    
  } catch (error) {
    logger.error(`❌ Error in test notify trouble report: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Error in test notify trouble report',
      error: error.message
    });
  }
});

module.exports = router;
