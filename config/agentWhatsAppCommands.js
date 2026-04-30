const AgentManager = require('./agentManager');
const AgentWhatsAppManager = require('./agentWhatsApp');
const billingManager = require('./billing');

class AgentWhatsAppCommands {
    constructor() {
        this.agentManager = new AgentManager();
        this.whatsappManager = new AgentWhatsAppManager();
        
        // Set WhatsApp socket when available
        if (typeof global !== 'undefined' && global.whatsappStatus && global.whatsappStatus.connected) {
            // Try to get socket from various sources
            let sock = null;
            
            // Check if there's a global whatsapp socket
            if (typeof global.getWhatsAppSocket === 'function') {
                sock = global.getWhatsAppSocket();
            } else if (global.whatsappSocket) {
                sock = global.whatsappSocket;
            } else if (global.whatsapp && typeof global.whatsapp.getSock === 'function') {
                sock = global.whatsapp.getSock();
            }
            
            if (sock) {
                this.whatsappManager.setSocket(sock);
                console.log('WhatsApp socket set for AgentWhatsAppManager in AgentWhatsAppCommands');
            } else {
                console.warn('WhatsApp socket not available for AgentWhatsAppManager in AgentWhatsAppCommands');
            }
        }
        
        this.billingManager = billingManager; // Use singleton instance
    }

    // Handle incoming message
    async handleMessage(from, message) {
        try {
            // Extract phone number from WhatsApp JID or use directly if already a phone number
            let phoneNumber = from;
            if (from.includes('@s.whatsapp.net')) {
                phoneNumber = from.replace('@s.whatsapp.net', '');
            } else if (from.includes('@lid')) {
                phoneNumber = from.replace('@lid', '');
            }
            
            // Normalize phone number
            phoneNumber = phoneNumber.replace(/\D/g, '');
            if (phoneNumber.startsWith('0')) {
                phoneNumber = '62' + phoneNumber.slice(1);
            } else if (!phoneNumber.startsWith('62')) {
                phoneNumber = '62' + phoneNumber;
            }
            
            // Authenticate agent by phone number
            const agent = await this.agentManager.getAgentByPhone(phoneNumber);
            if (!agent) {
                // DO NOT send message for unrecognized agent
                // This will prevent automatic response to every message
                console.log(`Agent not recognized: ${from}`);
                return null;
                // return this.sendMessage(from, "❌ You are not registered as an agent. Please contact admin.");
            }

            // Parse command
            const command = this.parseCommand(message);
            
            // If command is not recognized, don't send any response
            if (!command) {
                // DO NOT send message for unrecognized command
                // This will prevent automatic response to every message
                console.log(`Command not recognized: ${message}`);
                return null;
            }
            
            switch (command.type) {
                case 'help':
                    return this.handleHelp(from);
                case 'saldo':
                    return this.handleCheckBalance(from, agent);
                case 'cek_tagihan':
                    return this.handleCheckBill(from, agent, command.params);
                case 'bayar_tagihan':
                    return this.handlePayBill(from, agent, command.params);
                case 'beli_voucher':
                    return this.handleBuyVoucher(from, agent, command.params);
                case 'jual':
                    return this.handleSellVoucher(from, agent, command.params);
                case 'bayar':
                    return this.handleProcessPayment(from, agent, command.params);
                case 'list_tagihan':
                    return this.handleListBill(from, agent);
                case 'list_bayar':
                    return this.handleListPay(from, agent);
                case 'riwayat':
                    return this.handleTransactionHistory(from, agent);
                case 'request':
                    return this.handleRequestBalance(from, agent, command.params);
                default:
                    // DO NOT send message for unrecognized command
                    // This will prevent automatic response to every message
                    console.log(`Command not recognized: ${command.type}`);
                    return null;
                    // return this.sendMessage(from, "❌ Command not recognized. Type *HELP* to see command list.");
            }
        } catch (error) {
            console.error('Error handling WhatsApp message:', error);
            // DO NOT send error message to sender - only log error
            // This will prevent automatic response to every message
            // return this.sendMessage(from, "❌ An error occurred. Please try again.");
            return null;
        }
    }

    // Parse command from message
    parseCommand(message) {
        const text = message.toLowerCase().trim();
        
        if (text.includes('help') || text.includes('bantuan') || text.includes('help')) {
            return { type: 'help' };
        }
        
        if (text.includes('saldo') || text.includes('balance')) {
            return { type: 'saldo' };
        }
        
        if (text.includes('check bill') || text.includes('cek_tagihan') || text.includes('checkbill')) {
            const params = this.parseCheckBillParams(text);
            return { type: 'cek_tagihan', params };
        }
        
        if (text.includes('pay bill') || text.includes('bayar_tagihan') || text.includes('paybill')) {
            const params = this.parsePayBillParams(text);
            return { type: 'bayar_tagihan', params };
        }
        
        if (text.includes('buy voucher') || text.includes('beli_voucher') || text.includes('buyvoucher')) {
            const params = this.parseBuyVoucherParams(text);
            return { type: 'beli_voucher', params };
        }
        
        if (text.includes('jual') || text.includes('sell')) {
            const params = this.parseSellParams(text);
            return { type: 'jual', params };
        }
        
        if (text.includes('bayar') || text.includes('payment')) {
            const params = this.parsePaymentParams(text);
            return { type: 'bayar', params };
        }
        
        if (text.includes('request') || text.includes('minta') || text.includes('request balance') || text.includes('request')) {
            const params = this.parseRequestParams(text);
            return { type: 'request', params };
        }
        
        if (text.includes('list bill') || text.includes('list_tagihan') || text.includes('listtagihan')) {
            return { type: 'list_tagihan' };
        }

        if (text.includes('list payment') || text.includes('list_bayar') || text.includes('listpayment')) {
            return { type: 'list_bayar' };
        }

        if (text.includes('riwayat') || text.includes('history') || text.includes('transaction history') || text.includes('riwayat')) {
            return { type: 'riwayat' };
        }

        // Return null for unrecognized commands instead of undefined
        return null;
    }

    // Parse payment parameters
    parsePaymentParams(text) {
        // Format: PAY [CUSTOMER_NAME] [PHONE_NUMBER] [AMOUNT] [SEND_WHATSAPP]
        const parts = text.split(' ');
        const bayarIndex = parts.findIndex(p => p.includes('bayar'));
        
        if (bayarIndex === -1 || parts.length < bayarIndex + 4) {
            return null;
        }
        
        return {
            customerName: parts[bayarIndex + 1],
            customerPhone: parts[bayarIndex + 2],
            amount: parseFloat(parts[bayarIndex + 3]),
            sendWhatsApp: parts[bayarIndex + 4] === 'ya' || parts[bayarIndex + 4] === 'yes' || parts[bayarIndex + 4] === 'y'
        };
    }

    // Parse request balance parameters
    parseRequestParams(text) {
        // Format: REQUEST [AMOUNT] [NOTE]
        const parts = text.split(' ');
        const requestIndex = parts.findIndex(p => p.includes('request') || p.includes('minta') || p.includes('REQUEST'));
        
        if (requestIndex === -1 || parts.length < requestIndex + 2) {
            return null;
        }
        
        return {
            amount: parseFloat(parts[requestIndex + 1]),
            notes: parts.slice(requestIndex + 2).join(' ')
        };
    }

    // Parse buy voucher parameters
    parseBuyVoucherParams(text) {
        // Format: BUY VOUCHER [PACKAGE] [PHONE_NUMBER]
        const parts = text.split(' ');
        const beliIndex = parts.findIndex(p => p.includes('beli'));
        
        if (beliIndex === -1 || parts.length < beliIndex + 3) {
            return null;
        }
        
        return {
            package: parts[beliIndex + 2], // PACKAGE
            customerPhone: parts[beliIndex + 3] || null // PHONE_NUMBER (optional)
        };
    }

    // Parse sell voucher parameters
    parseSellParams(text) {
        // Format: SELL [PACKAGE] [PHONE_NUMBER]
        const parts = text.split(' ');
        const jualIndex = parts.findIndex(p => p.includes('jual') || p.includes('sell') || p.includes('SELL'));
        
        if (jualIndex === -1 || parts.length < jualIndex + 2) {
            return null;
        }
        
        return {
            package: parts[jualIndex + 1], // PACKAGE
            customerPhone: parts[jualIndex + 2] || null // PHONE_NUMBER (optional)
        };
    }

    // Parse check bill parameters
    parseCheckBillParams(text) {
        // Format: CHECK BILL [CUSTOMER_NAME]
        const parts = text.split(' ');
        const cekIndex = parts.findIndex(p => p.includes('cek') || p.includes('check') || p.includes('CHECK'));
        
        if (cekIndex === -1 || parts.length < cekIndex + 3) {
            return null;
        }
        
        return {
            customerName: parts.slice(cekIndex + 2).join(' ') // CUSTOMER_NAME
        };
    }

    // Parse pay bill parameters
    parsePayBillParams(text) {
        // Format: PAY BILL [CUSTOMER_NAME]
        const parts = text.split(' ');
        const bayarIndex = parts.findIndex(p => p.includes('bayar')
        
        if (bayarIndex === -1 || parts.length < bayarIndex + 3) {
            return null;
        }
        
        return {
            customerName: parts.slice(bayarIndex + 2).join(' ') // CUSTOMER_NAME
        };
    }

    // Handle help command
    async handleHelp(from) {
        const helpText = `🤖 *AGENT WHATSAPP COMMANDS*

📋 *Command List:*

📋 *CHECK BILL [CUSTOMER_NAME]* - Check customer bill
💰 *PAY BILL [CUSTOMER_NAME]* - Pay customer bill
📋 *LIST BILLS* - View all customers who haven't paid
💰 *LIST PAYMENTS* - View all customers who have paid
🛒 *BUY VOUCHER [PACKAGE]* - Buy voucher (for agent only)
🛒 *BUY VOUCHER [PACKAGE] [PHONE]* - Buy voucher and send to customer
📱 *SELL [PACKAGE]* - Sell voucher (without sending to consumer)
📱 *SELL [PACKAGE] [PHONE]* - Sell voucher + send to consumer
💰 *PAY [NAME] [PHONE] [AMOUNT] [YES/NO]* - Receive payment
📤 *REQUEST [AMOUNT] [NOTE]* - Request balance from admin
📊 *HISTORY* - View transaction history

• BALANCE
• CHECK BILL John Doe
• PAY BILL John Doe
• LIST BILLS
• LIST PAYMENTS
• BUY VOUCHER 3K
• BUY VOUCHER 10K 081234567890
• SELL 3K
• SELL 10K 081234567890
• PAY Jane 03036783333 50000 YES
• REQUEST 100000 Top up balance
• HISTORY

❓ Type *HELP* to see this menu again.`;

        return this.sendMessage(from, helpText);
    }

    // Handle check balance
    async handleCheckBalance(from, agent) {
        try {
            const balance = await this.agentManager.getAgentBalance(agent.id);
            const message = `💰 *AGENT BALANCE*

👤 Agent: ${agent.name}
📱 Phone: ${agent.phone}
💰 Balance: Rs ${balance.toLocaleString('en-PK')}

📅 Last update: ${new Date().toLocaleString('en-PK')}`;

            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, "❌ Failed to get balance data.");
        }
    }

    // Handle sell voucher
    async handleSellVoucher(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Wrong format. Use: *SELL [PACKAGE]* or *SELL [PACKAGE] [PHONE]*");
        }

        try {
            // Get available packages
            const packages = await this.agentManager.getAvailablePackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(params.package.toLowerCase()));
            
            if (!selectedPackage) {
                return this.sendMessage(from, `❌ Package not found. Available packages: ${packages.map(p => p.name).join(', ')}`);
            }

            // Generate voucher code using package settings
            const voucherCode = this.agentManager.generateVoucherCode(selectedPackage);
            
            // Sell voucher
            const result = await this.agentManager.sellVoucher(
                agent.id,
                voucherCode,
                selectedPackage.id,
                params.customerName || 'Customer',
                params.customerPhone || ''
            );

            if (result.success) {
                let message = `🎉 *VOUCHER SUCCESSFULLY SOLD*

🎫 Voucher Code: *${result.voucherCode}*
📦 Package: ${result.packageName}
💰 Sell Price: Rs ${result.customerPrice.toLocaleString('en-PK')}
💳 Agent Price: Rs ${result.agentPrice.toLocaleString('en-PK')}
💵 Commission: Rs ${result.commissionAmount.toLocaleString('en-PK')}

💰 Remaining Balance: Rs ${result.newBalance.toLocaleString('en-PK')}`;

                // Send to customer if phone number provided
                if (params.customerPhone) {
                    // Prepare agent info for customer message
                    const agentInfo = {
                        name: agent.name,
                        phone: agent.phone
                    };
                    
                    await this.whatsappManager.sendVoucherToCustomer(
                        params.customerPhone,
                        params.customerName || 'Customer',
                        result.voucherCode,
                        result.packageName,
                        result.customerPrice,
                        agentInfo
                    );
                    message += `\n\n📱 Notification has been sent to customer (${params.customerPhone}).`;
                } else {
                    message += `\n\nℹ️ Voucher is ready to be given to customer directly.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Failed to sell voucher: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ An error occurred while selling voucher.");
        }
    }

    // Handle process payment
    async handleProcessPayment(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Wrong format. Use: *PAY [NAME] [PHONE] [AMOUNT] [YES/NO]*");
        }

        try {
            // Process payment
            const result = await this.agentManager.processPayment(
                agent.id,
                params.customerName,
                params.customerPhone,
                params.amount
            );

            if (result.success) {
                let message = `✅ *PAYMENT SUCCESSFULLY PROCESSED*

👤 Customer: ${params.customerName}
📱 Phone: ${params.customerPhone}
💰 Quantity: Rs ${params.amount.toLocaleString('en-PK')}
👤 Agent: ${agent.name}
📅 Date: ${new Date().toLocaleString('en-PK')}

💰 Agent Balance: Rs ${result.newBalance.toLocaleString('en-PK')}`;

                // Send to customer if requested
                if (params.sendWhatsApp) {
                    // Create customer object for sendPaymentNotification
                    const customer = {
                        name: params.customerName,
                        phone: params.customerPhone
                    };
                    
                    const paymentData = {
                        amount: params.amount,
                        method: 'WhatsApp',
                        commission: 0 // Commission info not available in this context
                    };
                    
                    await this.whatsappManager.sendPaymentNotification(agent, customer, paymentData);
                    message += `\n\n📱 Confirmation has been sent to customer.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Failed to process payment: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ Error processing payment.");
        }
    }

    // Handle request balance
    async handleRequestBalance(from, agent, params) {
        if (!params) {
            return this.sendMessage(from, "❌ Wrong format. Use: *REQUEST [AMOUNT] [NOTE]*");
        }

        try {
            const result = await this.agentManager.requestBalance(
                agent.id,
                params.amount,
                params.notes
            );

            if (result.success) {
                // Create notification in database with valid type
                await this.agentManager.createNotification(
                    agent.id,
                    'balance_updated',
                    'Balance Request Sent',
                    `Balance request of Rs ${params.amount.toLocaleString()} has been sent to admin`
                );
                
                // Send WhatsApp notification to admin
                try {
                    const settings = require('./settingsManager').getSettingsWithCache();
                    const adminPhone = settings.admin_phone || settings.contact_phone;
                    
                    if (adminPhone && this.whatsappManager.sock) {
                        const adminMessage = `🔔 **AGENT BALANCE REQUEST**

👤 **Agent:** ${agent.name}
📱 **Phone:** ${agent.phone}
💰 **Quantity:** Rs ${params.amount.toLocaleString()}
📅 **Date:** ${new Date().toLocaleString('en-PK')}

Please login to admin panel to process this request.`;
                        
                        const formattedAdminPhone = this.whatsappManager.formatPhoneNumber(adminPhone) + '@s.whatsapp.net';
                        await this.whatsappManager.sock.sendMessage(formattedAdminPhone, { text: adminMessage });
                    }
                } catch (whatsappError) {
                    console.error('WhatsApp admin notification error:', whatsappError);
                    // Don't fail the transaction if WhatsApp fails
                }

                const message = `📤 *BALANCE REQUEST SUBMITTED*

💰 Quantity: Rs ${params.amount.toLocaleString('en-PK')}
📝 Notes: ${params.notes}
📅 Date: ${new Date().toLocaleString('en-PK')}

⏳ Waiting for admin approval...`;

                // Notify admin
                message += `\n\n📢 Balance request has been submitted and will be processed by admin.`;

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Failed to submit request: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ An error occurred while submitting request.");
        }
    }

    // Handle list bills (unpaid customers)
    async handleListBill(from, agent) {
        try {
            // Get all unpaid invoices
            const unpaidInvoices = await this.billingManager.getUnpaidInvoices();

            if (unpaidInvoices.length === 0) {
                return this.sendMessage(from, "✅ *BILL LIST*\n\n📝 No customers have unpaid bills.");
            }

            let message = `📋 *LIST OF UNPAID BILLS*\n\n`;
            message += `📊 Total customer: ${unpaidInvoices.length}\n\n`;

            // Group by customer and show details
            const customerGroups = {};
            unpaidInvoices.forEach(invoice => {
                if (!customerGroups[invoice.customer_id]) {
                    customerGroups[invoice.customer_id] = {
                        customer: invoice.customer_name,
                        phone: invoice.customer_phone,
                        invoices: []
                    };
                }
                customerGroups[invoice.customer_id].invoices.push(invoice);
            });

            let customerIndex = 1;
            for (const customerId in customerGroups) {
                const group = customerGroups[customerId];
                message += `${customerIndex}. 👤 ${group.customer}\n`;
                if (group.phone) {
                    message += `   📱 ${group.phone}\n`;
                }

                group.invoices.forEach((invoice, idx) => {
                    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-PK') : 'N/A';
                    const daysOverdue = invoice.due_date ?
                        Math.floor((new Date() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24)) : 0;

                    message += `   ${idx + 1}. 💰 Rs ${invoice.amount.toLocaleString('en-PK')}\n`;
                    message += `      📅 Due: ${dueDate}`;
                    if (daysOverdue > 0) {
                        message += ` (${daysOverdue} days overdue)`;
                    }
                    message += `\n`;
                    message += `      🆔 ${invoice.invoice_number}\n`;
                });
                message += `\n`;
                customerIndex++;
            }

            // Split message if too long (WhatsApp limit)
            if (message.length > 4000) {
                const parts = this.splitMessage(message, 4000);
                for (const part of parts) {
                    await this.sendMessage(from, part);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between parts
                }
            } else {
                return this.sendMessage(from, message);
            }

        } catch (error) {
            console.error('Error in handleListBill:', error);
            return this.sendMessage(from, "❌ Failed to retrieve invoice data. Please try again.");
        }
    }

    // Handle list payments (paid customers)
    async handleListPay(from, agent) {
        try {
            // Get all paid invoices
            const paidInvoices = await this.billingManager.getPaidInvoices();

            if (paidInvoices.length === 0) {
                return this.sendMessage(from, "✅ *PAYMENT LIST*\n\n📝 No customers have made payments.");
            }

            let message = `💰 *LIST OF CUSTOMERS WHO HAVE PAID*\n\n`;
            message += `📊 Total customer: ${paidInvoices.length}\n\n`;

            // Group by customer and show details
            const customerGroups = {};
            paidInvoices.forEach(invoice => {
                if (!customerGroups[invoice.customer_id]) {
                    customerGroups[invoice.customer_id] = {
                        customer: invoice.customer_name,
                        phone: invoice.customer_phone,
                        invoices: []
                    };
                }
                customerGroups[invoice.customer_id].invoices.push(invoice);
            });

            let customerIndex = 1;
            for (const customerId in customerGroups) {
                const group = customerGroups[customerId];
                message += `${customerIndex}. 👤 ${group.customer}\n`;
                if (group.phone) {
                    message += `   📱 ${group.phone}\n`;
                }

                group.invoices.forEach((invoice, idx) => {
                    const paymentDate = invoice.payment_date ?
                        new Date(invoice.payment_date).toLocaleDateString('en-PK') : 'N/A';

                    message += `   ${idx + 1}. 💰 Rs ${invoice.amount.toLocaleString('en-PK')}\n`;
                    message += `      💳 Paid: ${paymentDate}\n`;
                    message += `      🆔 ${invoice.invoice_number}\n`;
                    if (invoice.payment_method) {
                        message += `      💳 Via: ${invoice.payment_method}\n`;
                    }
                });
                message += `\n`;
                customerIndex++;
            }

            // Split message if too long (WhatsApp limit)
            if (message.length > 4000) {
                const parts = this.splitMessage(message, 4000);
                for (const part of parts) {
                    await this.sendMessage(from, part);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between parts
                }
            } else {
                return this.sendMessage(from, message);
            }

        } catch (error) {
            console.error('Error in handleListPay:', error);
            return this.sendMessage(from, "❌ Failed to retrieve payment data. Please try again.");
        }
    }

    // Utility function to split long messages
    splitMessage(message, maxLength) {
        const parts = [];
        let currentPart = '';

        const lines = message.split('\n');

        for (const line of lines) {
            if ((currentPart + line + '\n').length <= maxLength) {
                currentPart += line + '\n';
            } else {
                if (currentPart) {
                    parts.push(currentPart.trim());
                    currentPart = line + '\n';
                }
            }
        }

        if (currentPart) {
            parts.push(currentPart.trim());
        }

        return parts;
    }

    // Handle transaction history
    async handleTransactionHistory(from, agent) {
        try {
            const transactions = await this.agentManager.getAgentTransactions(agent.id, 10);
            
            let message = `📊 *LATEST TRANSACTION HISTORY*

👤 Agent: ${agent.name}
📅 Period: 10 latest transactions

`;

            if (transactions.length === 0) {
                message += "📝 No transactions.";
            } else {
                transactions.forEach((tx, index) => {
                    const date = new Date(tx.created_at).toLocaleDateString('en-PK');
                    const time = new Date(tx.created_at).toLocaleTimeString('en-PK');
                    const amount = tx.amount.toLocaleString('en-PK');
                    
                    message += `${index + 1}. ${tx.transaction_type.toUpperCase()}\n`;
                    message += `   💰 Rs ${amount}\n`;
                    message += `   📅 ${date} ${time}\n`;
                    if (tx.description) {
                        message += `   📝 ${tx.description}\n`;
                    }
                    message += `\n`;
                });
            }

            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, "❌ Failed to get transaction history.");
        }
    }

    // Send message via WhatsApp
    async sendMessage(to, message) {
        try {
            // Try to get socket from whatsapp module
            let sock = null;
            try {
                const whatsapp = require('./whatsapp');
                sock = whatsapp.getSock ? whatsapp.getSock() : null;
            } catch (e) {
                console.log('Could not get socket from whatsapp module');
            }
            
            if (sock && sock.sendMessage) {
                await sock.sendMessage(to, { text: message });
                console.log(`📤 [AGENT] Sent message to ${to}: ${message}`);
            } else {
                console.log(`📤 [AGENT] [MOCK] Would send to ${to}: ${message}`);
            }
            return null; // Don't return true, let agentWhatsAppIntegration handle the response
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            return null;
        }
    }
    
    // Handle check bill
    async handleCheckBill(from, agent, params) {
        if (!params || !params.customerName) {
            return this.sendMessage(from, " Incorrect format. Use: *CHECK BILL [CUSTOMER_NAME]*");
        }
        
        try {
            // Find customer by name or phone
            const customer = await this.billingManager.getCustomerByNameOrPhone(params.customerName);
            if (!customer) {
                return this.sendMessage(from, ` Customer with name "${params.customerName}" not found.`);
            }
            
            // Get customer bills and filter unpaid ones
            const allBills = await this.billingManager.getInvoicesByCustomer(customer.id);
            const bills = allBills.filter(bill => bill.status === 'unpaid');
            if (bills.length === 0) {
                return this.sendMessage(from, ` Customer "${params.customerName}" has no unpaid bills.`);
            }
            
            let message = `📋 *CUSTOMER BILL: ${params.customerName}*

`;
            bills.forEach((bill, index) => {
                const status = bill.status === 'unpaid' ? 'Not yet paid' : 'Already paid';
                message += `${index + 1}. Quantity: Rs ${bill.amount.toLocaleString('en-PK')} - Status: ${status}\n`;
                if (bill.due_date) {
                    message += `   Due Date: ${new Date(bill.due_date).toLocaleDateString('en-PK')}\n`;
                }
                message += '\n';
            });
            
            return this.sendMessage(from, message);
        } catch (error) {
            return this.sendMessage(from, " Failed to fetch bill data.");
        }
    }
    
    // Handle pay bill
    async handlePayBill(from, agent, params) {
        if (!params || !params.customerName) {
            return this.sendMessage(from, " Incorrect format. Use: *PAY BILL [CUSTOMER_NAME]*");
        }
        
        try {
            // Find customer by name or phone
            const customer = await this.billingManager.getCustomerByNameOrPhone(params.customerName);
            if (!customer) {
                return this.sendMessage(from, ` Customer with name "${params.customerName}" not found.`);
            }
            
            // Get all invoices and filter unpaid ones
            const allInvoices = await this.billingManager.getInvoicesByCustomer(customer.id);
            const unpaidInvoices = allInvoices.filter(invoice => invoice.status === 'unpaid');
            if (unpaidInvoices.length === 0) {
                return this.sendMessage(from, ` Customer "${params.customerName}" has no unpaid bills.`);
            }
            
            // Process payment for the first unpaid invoice
            const invoice = unpaidInvoices[0];
            console.log('[AGENT][DEBUG] invoice:', invoice);
            const result = await this.billingManager.recordPayment({
                invoice_id: invoice.id,
                amount: invoice.base_amount, // deduct agent balance according to agent price
                payment_method: 'agent_payment',
                reference_number: agent.id,
                notes: ''
            });
            
            if (result.success) {
                // Update invoice status to paid
                await this.billingManager.updateInvoiceStatus(invoice.id, 'paid', 'agent_payment');
                // Deduct agent balance and record transaction
                await this.agentManager.updateAgentBalance(
                    agent.id,
                    -invoice.base_amount, // deduct agent balance
                    'monthly_payment',
                    `Customer bill payment ${params.customerName}`,
                    invoice.id
                );
                // Get final agent balance
                const finalBalance = await this.agentManager.getAgentBalance(agent.id);
                const commission = invoice.amount - invoice.base_amount;
                let message = `✅ *BILL PAYMENT SUCCESSFULLY PROCESSED*

👤 Customer: ${params.customerName}
💰 Amount paid by customer: Rs ${invoice.amount.toLocaleString('en-PK')}
💵 Agent balance deducted: Rs ${invoice.base_amount.toLocaleString('en-PK')}
🎁 Commission: Rs ${commission.toLocaleString('en-PK')}
📅 Date: ${new Date().toLocaleString('en-PK')}
`;
                // Send confirmation to customer if phone is available
                if (customer.phone) {
                    await this.sendMessage(customer.phone, `✅ Payment for bill for ${customer.name} amounting to Rs ${invoice.amount.toLocaleString('en-PK')} has been successful!`);
                    message += `📱 Confirmation has been sent to customer.`;
                }
                // Add final balance to message
                message += `\n💰 Final Balance: Rs ${finalBalance.toLocaleString('en-PK')}`;
                
                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, ` Failed to process payment: ${result.message}`);
            }
        } catch (error) {
            console.error('[AGENT][ERROR] handlePayBill:', error);
            return this.sendMessage(from, " Error processing payment.");
        }
    }
    
    // Handle buy voucher
    async handleBuyVoucher(from, agent, params) {
        if (!params || !params.package) {
            return this.sendMessage(from, " Wrong format. Use: *BUY VOUCHER [PACKAGE]* or *BUY VOUCHER [PACKAGE] [CUSTOMER_PHONE]*");
        }
        
        try {
            // Get agent balance and available packages
            const balance = await this.agentManager.getAgentBalance(agent.id);
            const packages = await this.agentManager.getAvailablePackages();
            const selectedPackage = packages.find(p => p.name.toLowerCase().includes(params.package.toLowerCase()));
            
            if (!selectedPackage) {
                return this.sendMessage(from, ` Package "${params.package}" not found. Available packages: ${packages.map(p => p.name).join(', ')}`);
            }
            
            const price = selectedPackage.price; // Use dynamic price from database
            if (balance < price) {
                return this.sendMessage(from, ` Balance insufficient. Balance: Rs ${balance.toLocaleString('en-PK')}, Required: Rs ${price.toLocaleString('en-PK')}`);
            }
            
            // Generate voucher code using package settings
            const voucherCode = this.agentManager.generateVoucherCode(selectedPackage);
            
            // Sell voucher using the same method as web agent
            const result = await this.agentManager.sellVoucher(
                agent.id,
                voucherCode,
                selectedPackage.id,
                params.customerPhone || 'Customer',
                params.customerPhone || ''
            );

            if (result.success) {
                let message = `🎉 *VOUCHER SUCCESSFULLY PURCHASED*

🎫 Voucher Code: *${result.voucherCode}*
📦 Package: ${result.packageName}
💰 Sell Price: Rs ${result.customerPrice.toLocaleString('en-PK')}
💳 Agent Price: Rs ${result.agentPrice.toLocaleString('en-PK')}
💵 Commission: Rs ${result.commissionAmount.toLocaleString('en-PK')}

💰 Remaining Balance: Rs ${result.newBalance.toLocaleString('en-PK')}`;

                // Send to customer if phone number provided
                if (params.customerPhone) {
                    // Prepare agent info for customer message
                    const agentInfo = {
                        name: agent.name,
                        phone: agent.phone
                    };
                    
                    await this.whatsappManager.sendVoucherToCustomer(
                        params.customerPhone,
                        params.customerName || 'Customer',
                        result.voucherCode,
                        result.packageName,
                        result.customerPrice,
                        agentInfo
                    );
                    message += `\n\n📱 Notification has been sent to customer (${params.customerPhone}).`;
                } else {
                    message += `\n\nℹ️ Voucher is ready to be given to customer directly.`;
                }

                return this.sendMessage(from, message);
            } else {
                return this.sendMessage(from, `❌ Failed to sell voucher: ${result.message}`);
            }
        } catch (error) {
            return this.sendMessage(from, "❌ An error occurred while purchasing voucher. Please try again.");
        }
    }
}

module.exports = AgentWhatsAppCommands;

