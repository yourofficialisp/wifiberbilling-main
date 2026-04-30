const express = require('express');
const router = express.Router();
const { getHotspotProfileeeeeeeeees } = require('../config/mikrotik');
const { getSettingsWithCache } = require('../config/settingsManager');
const billingManager = require('../config/billing');
const logger = require('../config/logger');

// Helper function to format voucher WhatsApp message
function formatVoucherMessage(vouchers, purchase) {
    let message = `🛒 *VOUCHER HOTSPOT SUCCESSFULLY PURCHASED*\n\n`;
    message += `👤 Name: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rs ${purchase.amount.toLocaleString('en-PK')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profileeeeeeeeee: ${voucher.profile}\n\n`;
    });

    message += `🌐 *HOW TO USE:*\n`;
    message += `1. Connect to WiFi hotspot\n`;
    message += `2. Open browser to http://192.168.88.1\n`;
    message += `3. Login with Username & Password above\n`;
    message += `4. Click Login\n\n`;

    message += `⏰ *ACTIVE PERIOD:* According to selected package\n\n`;
    message += `📞 *HELP:* Contact admin if there are issues\n\n`;
    message += `Thank you for using our services! 🚀`;

    return message;
}

// Helper function to format voucher message with success page link
function formatVoucherMessageWithSuccessPage(vouchers, purchase, successUrl) {
    let message = `🛒 *VOUCHER HOTSPOT SUCCESSFULLY PURCHASED*\n\n`;
    message += `👤 Name: ${purchase.customer_name}\n`;
    message += `📱 No HP: ${purchase.customer_phone}\n`;
    message += `💰 Total: Rs ${purchase.amount.toLocaleString('en-PK')}\n\n`;

    message += `🎫 *DETAIL VOUCHER:*\n\n`;

    vouchers.forEach((voucher, index) => {
        message += `${index + 1}. *${voucher.username}*\n`;
        message += `   Password: ${voucher.password}\n`;
        message += `   Profileeeeeeeeee: ${voucher.profile}\n\n`;
    });

    message += `🌐 *VIEW FULL DETAILS:*\n`;
    message += `${successUrl}\n\n`;

    message += `🌐 *HOW TO USE:*\n`;
    message += `1. Connect to WiFi hotspot\n`;
    message += `2. Open browser to http://192.168.88.1\n`;
    message += `3. Login with Username & Password above\n`;
    message += `4. Click Login\n\n`;

    message += `⏰ *ACTIVE PERIOD:* According to selected package\n\n`;

    message += `📞 *HELP:* Contact admin if there are issues\n\n`;
    message += `Thank you for using our services! 🚀`;

    return message;
}

// Function to handle voucher webhook (can be called from universal webhook)
async function handleVoucherWebhook(body, headers) {
    try {
        console.log('Received voucher payment webhook:', body);

        // Use PaymentGatewayManager for consistency
        const PaymentGatewayManager = require('../config/paymentGateway');
        const paymentGateway = new PaymentGatewayManager();
        
        // Determine gateway based on payload
        let gateway = 'tripay'; // Default to tripay
        if (body.transaction_status) {
            gateway = 'midtrans';
        } else if (body.status === 'PAID' || body.status === 'EXPIRED' || body.status === 'FAILED') {
            gateway = 'tripay';
        } else if (body.status === 'settled' || body.status === 'expired' || body.status === 'failed') {
            gateway = 'xendit';
        }

        console.log(`Processing webhook with gateway: ${gateway}`);

        // Process webhook using PaymentGatewayManager
        const webhookResult = await paymentGateway.handleWebhook({ body, headers }, gateway);
        console.log('Webhook result:', webhookResult);

        const { order_id, status, amount, payment_type } = webhookResult;

        if (!order_id) {
            console.log('No order_id found in webhook payload');
            return {
                success: false,
                message: 'Order ID not found in webhook payload'
            };
        }

        // Search purchase by order_id
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./data/billing.db');

        let purchase;
        try {
            // Try to search by invoice_id first
            const invoiceId = order_id.replace('INV-', '');
            purchase = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [invoiceId], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        } catch (error) {
            console.error('Error finding purchase by invoice_id:', error);
            // Fallback: search by order_id directly
            purchase = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM voucher_purchases WHERE invoice_id = ?', [order_id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
        }

        if (!purchase) {
            console.log(`Purchase with order_id ${order_id} not found in database`);
            return {
                success: false,
                message: 'Voucher not found',
                details: `Purchase with order_id ${order_id} not found. May have expired or order_id is invalid.`,
                suggestions: [
                    'Please check the correct payment link',
                    'Ensure payment is made within the specified time',
                    'Contact admin if you encounter difficulties'
                ]
            };
        }

        // Check payment status using already normalized status
        if (status === 'success' || status === 'settlement' || status === 'capture') {
            console.log('Payment successful for purchase ID:', purchase.id);

            // Generate voucher AFTER payment success to avoid wasted vouchers
            let generatedVouchers = [];
            try {
                console.log('Generating vouchers after payment success...');
                generatedVouchers = await generateHotspotVouchersWithRetry({
                    profile: purchase.voucher_profile,
                    count: purchase.voucher_quantity,
                    packageId: purchase.voucher_package,
                    customerName: purchase.customer_name,
                    customerPhone: purchase.customer_phone
                });

                if (generatedVouchers && generatedVouchers.length > 0) {
                    console.log('Vouchers generated successfully:', generatedVouchers.length);
                } else {
                    console.log('No vouchers generated');
                }
            } catch (voucherError) {
                console.error('Error generating vouchers:', voucherError);
                // Log error but don't fail webhook
            }

            // Update purchase status to completed
            await new Promise((resolve, reject) => {
                const updateSql = `UPDATE voucher_purchases 
                                 SET status = 'completed', 
                                     voucher_data = ?, 
                                     updated_at = datetime('now')
                                 WHERE id = ?`;
                db.run(updateSql, [JSON.stringify(generatedVouchers), purchase.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Send voucher via WhatsApp if phone number is available
            if (purchase.customer_phone) {
                try {
                    const { sendMessage } = require('../config/sendMessage');
                    const successUrl = `${process.env.APP_BASE_URL || 'https://nbbwifiber.com'}/voucher/success/${purchase.id}`;
                    const voucherText = formatVoucherMessage(generatedVouchers, purchase);
                    const deliveryResult = await sendVoucherWithRetry(purchase.customer_phone, voucherText);
                    
                    // Log delivery result
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, deliveryResult.success, deliveryResult.message);
                    
                    if (deliveryResult.success) {
                        console.log('Voucher sent successfully via WhatsApp');
                    } else {
                        console.log('Failed to send voucher via WhatsApp:', deliveryResult.message);
                    }
                } catch (whatsappError) {
                    console.error('Error sending voucher via WhatsApp:', whatsappError);
                    await logVoucherDelivery(purchase.id, purchase.customer_phone, false, whatsappError.message);
                }
            }

            db.close();
            return {
                success: true,
                message: 'Voucher successfully created and sent',
                purchase_id: purchase.id,
                vouchers_generated: generatedVouchers.length,
                whatsapp_sent: purchase.customer_phone ? true : false
            };

        } else if (status === 'failed' || status === 'expired' || status === 'cancelled') {
            console.log('Payment failed/expired for purchase ID:', purchase.id);
            
            // Update status to failed
            await new Promise((resolve, reject) => {
                db.run('UPDATE voucher_purchases SET status = ?, updated_at = datetime(\'now\') WHERE id = ?', 
                       [status, purchase.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            db.close();
            return {
                success: false,
                message: `Payment ${status}`,
                purchase_id: purchase.id
            };

        } else {
            console.log('Payment status unknown:', status);
            db.close();
            return {
                success: false,
                message: 'Payment status not recognized',
                status: status,
                purchase_id: purchase.id
            };
        }

    } catch (error) {
        console.error('Voucher webhook error:', error);
        return {
            success: false,
            message: 'Error processing voucher webhook: ' + error.message
        };
    }
}

// Webhook handler for voucher payment success
router.post('/payment-webhook', async (req, res) => {
    try {
        const result = await handleVoucherWebhook(req.body, req.headers);
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        console.error('Voucher webhook route error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error: ' + error.message
        });
    }
});

// Export functions for testing
module.exports = {
    router,
    handleVoucherWebhook,
    generateHotspotVouchersWithRetry,
    generateHotspotVouchers,
    sendVoucherWithRetry,
    logVoucherDelivery,
    saveVoucherPurchase,
    cleanupFailedVoucher
};
