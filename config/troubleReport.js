const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');
const { sendMessage, setSock } = require('./sendMessage');

// Helper function untuk format tanggal yang benar
function formatDateTime(date = new Date()) {
  try {
    // Handle potential system time issues
    let targetDate = new Date(date);
    
    // If system time is way off (like 2025), try to fix it
    const currentYear = targetDate.getFullYear();
    if (currentYear > 2024) {
      // Assume it should be 2024 and adjust
      const yearDiff = currentYear - 2024;
      targetDate = new Date(targetDate.getTime() - (yearDiff * 365 * 24 * 60 * 60 * 1000));
    }
    
    // Convert to Indonenisin timezone (UTC77)
    const options = {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    
    const formatter = new Intl.DateTimeFormat('en-PK', options);
    const parts = formatter.formatToParts(targetDate);
    
    const day = parts.find(part => part.type === 'day').value;
    const month = parts.find(part => part.type === 'month').value;
    const year = parts.find(part => part.type === 'year').value;
    const hour = parts.find(part => part.type === 'hour').value;
    const minute = parts.find(part => part.type === 'minute').value;
    const second = parts.find(part => part.type === 'second').value;
    
    return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
  } catch (error) {
    // Fallback to simple format if anything fails
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = 2024; // Force 2024 as fallback
    const hour = d.getHours().toString().padStart(2, '0');
    const minute = d.getMinutes().toString().padStart(2, '0');
    const second = d.getSeconds().toString().padStart(2, '0');
    
    return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
  }
}

// Path to save trouble report data
const troubleReportPath = path.join(__dirname, '../logs/trouble_reports.json');

// Memastikan file laporan gangguan ada
function ensureTroubleReportFile() {
  try {
    if (!fs.existsSync(path.dirname(troubleReportPath))) {
      fs.mkdirSync(path.dirname(troubleReportPath), { recursive: true });
    }
    
    if (!fs.existsSync(troubleReportPath)) {
      fs.writeFileSync(troubleReportPath, JSON.stringify([], null, 2), 'utf8');
      logger.info(`File laporan gangguan dibuat: ${troubleReportPath}`);
    }
  } catch (error) {
    logger.error(`Failed to create trouble report file: ${error.message}`);
  }
}

// Mendapatkan semua laporan gangguan
function getAllTroubleReports() {
  ensureTroubleReportFile();
  try {
    const data = fs.readFileSync(troubleReportPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error(`Failed membaca laporan gangguan: ${error.message}`);
    return [];
  }
}

// Mendapatkan laporan gangguan berdasarkan ID
function getTroubleReportById(id) {
  const reports = getAllTroubleReports();
  return reports.find(report => report.id === id);
}

// Mendapatkan laporan gangguan berdasarkan nomor customer
function getTroubleReportsByPhone(phone) {
  const reports = getAllTroubleReports();
  return reports.filter(report => report.phone === phone);
}

// Create new trouble report
function createTroubleReport(reportData) {
  try {
    const reports = getAllTroubleReports();
    
    // Generate ID unik berdasarkan timestamp dan random string
    const id = `TR${Date.now().toString().slice(-6)}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
    
    const newReport = {
      id,
      status: 'open', // Status awal: open, in_progress, resolved, closed
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...reportData
    };
    
    reports.push(newReport);
    fs.writeFileSync(troubleReportPath, JSON.stringify(reports, null, 2), 'utf8');
    
    // Kirim notifikasi ke grup teknisi jika auto_ticket diaktifkan
    try {
      if (getSetting('trouble_report.auto_ticket', 'true') === 'true') {
        sendNotificationToTechnicians(newReport);
      }
    } catch (notificationError) {
      logger.warn('Failed to send technician notification:', notificationError.message);
    }
    
    return newReport;
  } catch (error) {
    logger.error(`Failed to create trouble report: ${error.message}`);
    return null;
  }
}

// Update status laporan gangguan
function updateTroubleReportStatus(id, status, notes, sendNotification = true) {
  try {
    const reports = getAllTroubleReports();
    const reportIndex = reports.findIndex(report => report.id === id);
    
    if (reportIndex === -1) {
      return null;
    }
    
    reports[reportIndex].status = status;
    reports[reportIndex].updatedAt = new Date().toISOString();
    
    if (notes) {
      if (!reports[reportIndex].notes) {
        reports[reportIndex].notes = [];
      }
      
      const noteEntry = {
        timestamp: new Date().toISOString(),
        content: notes,
        status
      };
      
      // Addkan flag notifikasi terkirim jika notifikasi akan dikirim
      if (sendNotification) {
        noteEntry.notificationSent = true;
      }
      
      reports[reportIndex].notes.push(noteEntry);
    }
    
    fs.writeFileSync(troubleReportPath, JSON.stringify(reports, null, 2), 'utf8');
    
    // Kirim notifikasi ke customer tentang update status jika sendNotification true
    if (sendNotification) {
      sendStatusUpdateToCustomer(reports[reportIndex]);
      logger.info(`Notifikasi status laporan ${id} terkirim ke customer`);
    } else {
      logger.info(`Update status laporan ${id} tanpa notifikasi ke customer`);
    }
    
    return reports[reportIndex];
  } catch (error) {
    logger.error(`Failed mengupdate status laporan gangguan: ${error.message}`);
    return null;
  }
}

// Kirim notifikasi ke teknisi dan admin
async function sendNotificationToTechnicians(report) {
  try {
    logger.info(`🔔 Attempting to send trouble report notification ${report.id} to technicians and admin`);
    
    const technicianGroupId = getSetting('technician_group_id', '');
    const companyHeader = getSetting('company_header', '📱 NBB Wifiber');
    
    // Format pesan untuk teknisi dan admin
    const message = `🚨 *LAPORAN GANGGUAN BARU*

*${companyHeader}*

📝 *ID Tiket*: ${report.id}
👤 *Customer*: ${report.name || 'N/A'}
📱 *No. HP*: ${report.phone || 'N/A'}
📍 *Lokasi*: ${report.location || 'N/A'}
🔧 *Kategori*: ${report.category || 'N/A'}
🕒 *Waktu Laporan*: ${formatIndonesianDateTime(new Date(report.createdAt))}

💬 *Description Masalah*:
${report.description || 'Tidak ada deskripsi'}

📌 *Status*: ${report.status.toUpperCase()}

⚠️ *HIGH PRIORITY* - Please follow up immediately!`;

    logger.info(`📝 Pesan yang akan dikirim: ${message.substring(0, 100)}...`);
    
    let sentSuccessfully = false;
    
    // Kirim ke grup teknisi jika ada
    if (technicianGroupId && technicianGroupId !== '') {
      try {
        const result = await sendMessage(technicianGroupId, message);
        if (result) {
          logger.info(`✅ Notifikasi laporan gangguan ${report.id} successful terkirim ke grup teknisi`);
          sentSuccessfully = true;
        } else {
          logger.error(`❌ Failed to send trouble report notification ${report.id} to technician group`);
        }
      } catch (error) {
        logger.error(`❌ Error sending to technician group: ${error.message}`);
      }
    } else {
      logger.warn(`⚠️ Technician group ID kosong, skip pengiriman ke grup`);
    }
    
    // Kirim ke nomor teknisi individual sebagai backup (selalu jalankan)
    const { sendTechnicianMessage } = require('./sendMessage');
    try {
      logger.info(`📤 Attempting to send to individual technician numbers as backup`);
      const techResult = await sendTechnicianMessage(message, 'high');
      if (techResult) {
        logger.info(`✅ Notifikasi laporan gangguan ${report.id} successful terkirim ke nomor teknisi`);
        sentSuccessfully = true;
      } else {
        logger.error(`❌ Failed to send trouble report notification ${report.id} to technician numbers`);
      }
    } catch (error) {
      logger.error(`❌ Error sending to technician numbers: ${error.message}`);
    }
    
    // Fallback to admin if both methods above fail
    if (!sentSuccessfully) {
      try {
        logger.info(`📤 Fallback: Attempting to send to admin`);
        const adminNumber = getSetting('admins.0', '');
        if (adminNumber && adminNumber !== '') {
          const adminMessage = `🚨 *FALLBACK NOTIFICATION*\n\n⚠️ Technician notification failed!\n\n${message}`;
          const adminResult = await sendMessage(adminNumber, adminMessage);
          if (adminResult) {
            logger.info(`✅ Notifikasi laporan gangguan ${report.id} successful terkirim ke admin sebagai fallback`);
            sentSuccessfully = true;
          }
        } else {
          logger.warn(`⚠️ Admin number unavailable untuk fallback`);
        }
      } catch (adminError) {
        logger.error(`❌ Error sending to admin fallback: ${adminError.message}`);
      }
    }
    
    // Emergency fallback to all admins if still failed
    if (!sentSuccessfully) {
      try {
        logger.info(`📤 Emergency fallback: Attempting to send to all admins`);
        let i = 0;
        while (i < 5) { // Max 5 admin numbers
          const adminNumber = getSetting(`admins.${i}`, '');
          if (!adminNumber) break;
          
          try {
            const emergencyMessage = `🆘 *EMERGENCY NOTIFICATION*\n\n❌ All technicians failed to receive notification!\n\n${message}`;
            const result = await sendMessage(adminNumber, emergencyMessage);
            if (result) {
              logger.info(`✅ Emergency notification sent successfully ke admin ${i}`);
              sentSuccessfully = true;
              break; // Hanya perlu 1 admin yang successful
            }
          } catch (e) {
            logger.error(`❌ Failed to send emergency to admin ${i}: ${e.message}`);
          }
          i++;
        }
      } catch (emergencyError) {
        logger.error(`❌ Error emergency fallback: ${emergencyError.message}`);
      }
    }
    
    // ALWAYS send to admin (parallel notification, tidak tergantung teknisi)
    try {
      logger.info(`📤 Sending notifikasi trouble report ke admin (parallel)`);
      
      // Get admin numbers
      let i = 0;
      let adminNotified = false;
      
      while (i < 3) { // Try max 3 admin numbers
        const adminNumber = getSetting(`admins.${i}`, '');
        if (!adminNumber) break;
        
        try {
          const adminMessage = `📋 *LAPORAN GANGGUAN - ADMIN NOTIFICATION*\n\n${message}\n\n💼 *Info Admin*:\nNotifikasi ini dikirim ke admin untuk monitoring dan koordinasi dengan teknisi.`;
          const adminResult = await sendMessage(adminNumber, adminMessage);
          
          if (adminResult) {
            logger.info(`✅ Notifikasi trouble report sent successfully ke admin ${i}`);
            adminNotified = true;
            sentSuccessfully = true;
            break; // Cukup 1 admin yang successful
          } else {
            logger.warn(`⚠️ Failed to send to admin ${i}, trying next admin`);
          }
        } catch (adminError) {
          logger.error(`❌ Error sending to admin ${i}: ${adminError.message}`);
        }
        i++;
      }
      
      if (!adminNotified) {
        logger.warn(`⚠️ No admin successfully received trouble report notification`);
      }
      
    } catch (adminError) {
      logger.error(`❌ Error pada admin notification: ${adminError.message}`);
    }
    
    // Log hasil akhir
    if (sentSuccessfully) {
      logger.info(`✅ Notifikasi laporan gangguan ${report.id} sent successfully ke teknisi dan/atau admin`);
    } else {
      logger.error(`❌ CRITICAL: Failed to send trouble report notification ${report.id} to ALL targets!`);
    }
    
    return sentSuccessfully;
  } catch (error) {
    logger.error(`❌ Error sending notification to technicians: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    return false;
  }
}

// Kirim notifikasi update status ke customer
async function sendStatusUpdateToCustomer(report) {
  try {
    logger.info(`Attempting to send status update for report ${report.id} to customer`);
    
    if (!report.phone) {
      logger.warn(`Cannot send status update: customer phone number not available`);
      return false;
    }
    
    const waJid = report.phone.replace(/^0/, '62') + '@s.whatsapp.net';
    logger.info(`WhatsApp JID customer: ${waJid}`);
    
    const companyHeader = getSetting('company_header', 'ISP Monitor');
    
    // Status dalam bahasa Inggris
    const statusMap = {
      'open': 'Open',
      'in_progress': 'In Progress',
      'resolved': 'Resolved',
      'closed': 'Closed'
    };
    
    // Ambil catatan terbaru jika ada
    const latestNote = report.notes && report.notes.length > 0 
      ? report.notes[report.notes.length - 1].content 
      : '';
    
    // Format pesan untuk customer
    let message = `📣 *UPDATE LAPORAN GANGGUAN*
    
*${companyHeader}*

📝 *ID Tiket*: ${report.id}
🕒 *Update Pada*: ${formatIndonesianDateTime(new Date(report.updatedAt))}
📌 *Status Baru*: ${statusMap[report.status] || report.status.toUpperCase()}

${latestNote ? `💬 *Notes Technician*:
${latestNote}

` : ''}`;
    
    // Addkan instruksi berdasarkan status
    if (report.status === 'open') {
      message += `Laporan You telah diterima dan akan segera ditindaklanjuti oleh tim teknisi kami.`;
    } else if (report.status === 'in_progress') {
      message += `Our technical team is handling your report. Please be patient.`;
    } else if (report.status === 'resolved') {
      message += `✅ Your report has been resolved. If the issue has been completely resolved, please close this report through the customer portal.

If the issue persists, please add a comment to this report.`;
    } else if (report.status === 'closed') {
      message += `🙏 Thank you for using our service. This report has been closed.`;
    }
    
    message += `

If you have any questions, please contact us.`;

    logger.info(`Pesan update status yang akan dikirim: ${message.substring(0, 100)}...`);
    
    // Kirim ke customer
    const result = await sendMessage(waJid, message);
    
    if (result) {
      logger.info(`✅ Update status laporan ${report.id} successful terkirim ke customer ${report.phone}`);
      return true;
    } else {
      logger.error(`❌ Failed to send status update for report ${report.id} to customer ${report.phone}`);
      return false;
    }
  } catch (error) {
    logger.error(`❌ Error sending status update to customer: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    return false;
  }
}

// Inisialisasi saat modul dimuat
ensureTroubleReportFile();

// Fungsi untuk set sock instance
function setSockInstance(sockInstance) {
  setSock(sockInstance);
}

module.exports = {
  getAllTroubleReports,
  getTroubleReportById,
  getTroubleReportsByPhone,
  createTroubleReport,
  updateTroubleReportStatus,
  sendNotificationToTechnicians,
  sendStatusUpdateToCustomer,
  setSockInstance
};
