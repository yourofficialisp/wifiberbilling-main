const logger = require('./logger');
const { getAdminHelpMessage, getTechnicianHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage, getVersionMessage, getSystemInfoMessage } = require('./help-messages');
const WhatsAppTroubleCommands = require('./whatsapp-trouble-commands');
const WhatsAppPPPoECommands = require('./whatsapp-pppoe-commands');
const AgentAdminCommands = require('./agentAdminCommands');
const BillingManager = require('./billing');
const { getCompanyHeader, getFooterInfo } = require('./message-templates');

class WhatsAppMessageHandlers {
    constructor(whatsappCore, whatsappCommands) {
        this.core = whatsappCore;
        this.commands = whatsappCommands;
        this.troubleCommands = new WhatsAppTroubleCommands(whatsappCore);
        this.pppoeCommands = new WhatsAppPPPoECommands(whatsappCore);
        this.agentAdminCommands = new AgentAdminCommands();

        // Parameter paths for different device parameters (from genieacs-commands.js)
        this.parameterPaths = {
            rxPower: [
                'VirtualParameters.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ALU-COM_RxPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.RxPower',
                'Device.Optical.Interface.1.RxPower'
            ],
            pppoeIP: [
                'VirtualParameters.pppoeIP',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
                'Device.PPP.Interface.1.IPCPExtensions.RemoteIPAddress'
            ],
            pppUsername: [
                'VirtualParameters.pppoeUsername',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
                'Device.PPP.Interface.1.Username'
            ],
            uptime: [
                'VirtualParameters.getdeviceuptime',
                'InternetGatewayDevice.DeviceInfo.UpTime',
                'Device.DeviceInfo.UpTime'
            ],
            firmware: [
                'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
                'Device.DeviceInfo.SoftwareVersion'
            ],
            userConnected: [
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
                'VirtualParameters.activedevices',
                'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries'
            ],
            temperature: [
                'VirtualParameters.gettemp',
                'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureValue',
                'Device.DeviceInfo.TemperatureStatus.TemperatureValue'
            ],
            serialNumber: [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber'
            ],
            ponMode: [
                'VirtualParameters.getponmode'
            ],
            pppUptime: [
                'VirtualParameters.getpppuptime'
            ]
        };
    }

    // Phone helpers: normalize and variants (08..., 62..., +62...)
    normalizePhone(input) {
        if (!input) return '';
        let s = String(input).replace(/[^0-9+]/g, '');
        if (s.startsWith('+')) s = s.slice(1);
        if (s.startsWith('0')) return '62' + s.slice(1);
        if (s.startsWith('62')) return s;
        // Fallback: if it looks like local without leading 0, prepend 62
        if (/^8[0-9]{7,13}$/.test(s)) return '62' + s;
        return s;
    }

    generatePhoneVariants(input) {
        const raw = String(input || '');
        const norm = this.normalizePhone(raw);
        const local = norm.startsWith('62') ? '0' + norm.slice(2) : raw;
        const plus = norm.startsWith('62') ? '+62' + norm.slice(2) : raw;
        const shortLocal = local.startsWith('0') ? local.slice(1) : local;
        return Array.from(new Set([raw, norm, local, plus, shortLocal].filter(Boolean)));
    }

    // Main message handler
    async handleIncomingMessage(sock, message) {
        try {
            // Validate input
            if (!message || !message.key) {
                logger.warn('Invalid Message received', { message: typeof message });
                return;
            }

            // Extract message information
            const remoteJid = message.key.remoteJid;
            if (!remoteJid) {
                logger.warn('Message without remoteJid received', { messageKey: message.key });
                return;
            }

            // Skip if message is from group and not from admin
            if (remoteJid.includes('@g.us')) {
                logger.debug('Message from group received', { groupJid: remoteJid });
                const participant = message.key.participant;
                if (!participant || !this.core.isAdminNumber(participant.split('@')[0])) {
                    logger.debug('Group message not from admin, ignoring', { participant });
                    return;
                }
                logger.info('Group message from admin, processing', { participant });
            }

            // Check message type and extract text
            let messageText = '';
            if (!message.message) {
                logger.debug('Message without content received', { messageType: 'unknown' });
                return;
            }

            if (message.message.conversation) {
                messageText = message.message.conversation;
                logger.debug('Conversation Message received');
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
                logger.debug('Extended text Message received');
            } else {
                logger.debug('Unsupported message type received', {
                    messageTypes: Object.keys(message.message)
                });
                return;
            }

            // Extract sender number and LID
            let senderNumber;
            let senderLid = null;
            let realSenderNumber = null; // Original number from database if using LID

            try {
                // Check if sender is using LID
                if (remoteJid.endsWith('@lid')) {
                    senderLid = remoteJid;
                    logger.debug(`Message from LID detected: ${senderLid}`);

                    // Try to find phone number based on LID in database
                    try {
                        const billing = new BillingManager();
                        const customer = await billing.getCustomerByWhatsAppLid(senderLid);

                        if (customer) {
                            realSenderNumber = customer.phone;
                            senderNumber = realSenderNumber; // Use real phone number for subsequent logic

                            // Normalize phone number
                            if (senderNumber.startsWith('0')) senderNumber = '62' + senderNumber.slice(1);

                            logger.info(`✅ Resolved LID ${senderLid} to customer phone: ${senderNumber}`);
                        } else {
                            // If not found, use front part of LID but this might not be a valid phone number
                            senderNumber = remoteJid.split('@')[0];
                            logger.info(`⚠️ LID ${senderLid} not found in database. Using raw ID: ${senderNumber}`);
                        }
                    } catch (err) {
                        logger.error('Error resolving LID:', err);
                        senderNumber = remoteJid.split('@')[0];
                    }
                } else {
                    // Normal message (non-LID)
                    senderNumber = remoteJid.split('@')[0];
                }
            } catch (error) {
                logger.error('Error extracting sender number', { remoteJid, error: error.message });
                return;
            }

            logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
            logger.debug(`Message content`, { sender: senderNumber, message: messageText });

            // Check if sender is admin
            const isAdmin = this.core.isAdminNumber(senderNumber);
            logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });

            // If message is empty, ignore
            if (!messageText.trim()) {
                logger.debug('Empty message, ignoring');
                return;
            }

            // Process message
            await this.processMessage(remoteJid, senderNumber, messageText, isAdmin, senderLid);

        } catch (error) {
            logger.error('Error in handleIncomingMessage', { error: error.message, stack: error.stack });
        }
    }

    // Process message and route to appropriate handler
    async processMessage(remoteJid, senderNumber, messageText, isAdmin, senderLid = null) {
        const command = messageText.trim().toLowerCase();
        const originalCommand = messageText.trim();

        try {
            // Check if sender can access technician features
            const canAccessTechnician = this.core.canAccessTechnicianFeatures(senderNumber);

            // Debug logging
            logger.info(`🔍 [ROUTING] Processing command: "${originalCommand}" (lowercase: "${command}")`);
            logger.info(`🔍 [ROUTING] Sender: ${senderNumber}, isAdmin: ${isAdmin}, canAccessTechnician: ${canAccessTechnician}`);
            console.log(`🔍 [ROUTING DEBUG] isAdmin=${isAdmin}, typeof isAdmin=${typeof isAdmin}`);


            // LID REGISTRATION (Priority High - before admin/technician check)
            // SETLID for WhatsApp LID Admin registration
            if (command.startsWith('setlid ') || command.startsWith('!setlid ') || command.startsWith('/setlid ')) {
                await this.handleSetLidCommand(remoteJid, senderNumber, messageText, senderLid);
                return;
            }

            // REG command for WhatsApp LID customer registration
            if (command.startsWith('reg ') || command.startsWith('!reg ') || command.startsWith('/reg ')) {
                await this.handleRegCommand(remoteJid, senderNumber, messageText, senderLid);
                return;
            }

            // Admin commands (including Technician commands)
            if (isAdmin) {
                logger.info(`🔍 [ROUTING] Routing to handleAdminCommands`);
                console.log(`🔍 [ROUTING] Calling handleAdminCommands for command: "${command}"`);
                await this.handleAdminCommands(remoteJid, senderNumber, command, messageText);
                return;
            }

            console.log(`🔍 [ROUTING] NOT routing to admin handler, isAdmin=${isAdmin}`);

            // Technician commands (for technicians who are not admins)
            if (canAccessTechnician && !isAdmin) {
                logger.info(`🔍 [ROUTING] Routing to handleTechnicianCommands`);
                await this.handleTechnicianCommands(remoteJid, senderNumber, command, messageText);
                return;
            }

            // Customer commands
            logger.info(`🔍 [ROUTING] Routing to handleCustomerCommands`);
            await this.handleCustomerCommands(remoteJid, senderNumber, command, messageText);

        } catch (error) {
            logger.error('Error processing message', {
                command,
                sender: senderNumber,
                error: error.message
            });

            // Send error message to user
            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nError occurred while processing command:\n${error.message}`
            );
        }
    }

    // Handle REG command for LID REGISTRATION
    async handleRegCommand(remoteJid, senderNumber, messageText, senderLid) {
        try {
            const billing = new BillingManager();

            // Extract search term (name or number)
            const searchTerm = messageText.split(' ').slice(1).join(' ').trim();

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!searchTerm) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *WRONG FORMAT*\n\n` +
                    `Use format:\n` +
                    `• REG [customer name]\n` +
                    `• REG [phone number]\n\n` +
                    `Example:\n` +
                    `• REG Budi Santoso\n` +
                    `• REG 081234567890`
                ));
                return;
            }

            // Check if LID is available
            if (!senderLid) {
                // If not detected as LID, maybe user is using regular WA but wants to register? 
                // But this feature is specific for LID mapping. 
                // If user uses regular WA, remoteJid is ALREADY the phone number (ideally).
                // But we'll just give a warning.
                if (!remoteJid.endsWith('@lid')) {
                    // If not LID, check if this number is already registered?
                    // If already registered, just inform "This number is already automatically registered".
                    const customer = await billing.getCustomerByPhone(senderNumber);
                    if (customer) {
                        await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                            `✅ *ALREADY REGISTERED*\n\n` +
                            `This WhatsApp number is already registered as:\n` +
                            `👤 *Name:* ${customer.name}\n` +
                            `📞 *Number:* ${customer.phone}\n\n` +
                            `You do not need to re-register.`
                        ));
                        return;
                    }
                }

                if (!senderLid && !remoteJid.endsWith('@lid')) {
                    // Fallback create dummy LID from remoteJid if needed? No, just warn.
                    // Actually, let's allow "REG" to work for normal numbers too to confirm identity
                }
            }

            // Determine if search term is phone number (only digits) or name
            const isPhoneNumber = /^\d+$/.test(searchTerm.replace(/[\s\-\+]/g, ''));

            let customers = [];

            if (isPhoneNumber) {
                // Search by phone number
                const customer = await billing.getCustomerByPhone(searchTerm);
                if (customer) {
                    customers = [customer];
                }
            } else {
                // Search by name
                customers = await billing.getCustomerByNameOrPhone(searchTerm);
                // getCustomerByNameOrPhone returns single object, not array. Need to check billing.js again.
                // It returns SINGLE row. So wrap in array if found.
                if (customers) {
                    customers = [customers];
                }
            }

            // Note: billing.findCustomersByNameOrPhone might be what we want for multiple results?
            // checking billing.js... getCustomerByNameOrPhone returns 1 row via db.get.
            // If we want likely matches, we might need a search function that returns multiple rows.
            // But for now let's stick to strict matching to avoid confusion.

            if (!customers || customers.length === 0) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *Customer not found*\n\n` +
                    `No customer with ${isPhoneNumber ? 'number' : 'name'}: ${searchTerm}\n\n` +
                    `Please try again with:\n` +
                    `• Full customer name, or\n` +
                    `• Registered phone number`
                ));
                return;
            }

            // Single customer found
            const customer = customers[0];

            // Check if customer already has a WhatsApp LID
            if (customer.whatsapp_lid) {
                // If senderLid exists and matches
                if (senderLid && customer.whatsapp_lid === senderLid) {
                    await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                        `✅ *ALREADY REGISTERED*\n\n` +
                        `This WhatsApp is already connected to account:\n\n` +
                        `👤 *Name:* ${customer.name}\n` +
                        `📞 *Number:* ${customer.phone}\n` +
                        `📦 *Package:* ${customer.package_name || 'No package'}`
                    ));
                    return;
                } else if (senderLid && customer.whatsapp_lid !== senderLid) {
                    // If already have LID but different, change confirmation?
                    // Currently auto-replace or reject?
                    // Safer to reject and ask to contact admin.
                    await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                        `⚠️ *CONFIRMATION REQUIRED*\n\n` +
                        `Customer "${customer.name}" already has another WhatsApp ID connected.\n\n` +
                        `If you changed your phone/WA, please contact admin to reset data.`
                    ));
                    return;
                }
            }

            // Register the WhatsApp LID
            try {
                // Use LID if available, otherwise use remoteJid (for regular WA)
                const targetLid = senderLid || remoteJid;

                await billing.updateCustomerWhatsAppLid(customer.id, targetLid);

                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `✅ *Registration successful*\n\n` +
                    `Your WhatsApp has been successfully registered!\n\n` +
                    `📋 *Customer Data:*\n` +
                    `👤 *Name:* ${customer.name}\n` +
                    `📞 *Number:* ${customer.phone}\n` +
                    `📦 *Package:* ${customer.package_name || 'No package'}\n` +
                    `💰 *Price:* ${customer.package_price ? 'Rs ' + customer.package_price.toLocaleString('en-PK') : '-'}\n\n` +
                    `You can now use bot commands with this WhatsApp.\n\n` +
                    `Type *MENU* to see the command list.`
                ));

                logger.info(`✅ WhatsApp LID registered: ${targetLid} for customer ${customer.name} (${customer.phone})`);
            } catch (error) {
                logger.error('Error registering WhatsApp LID:', error);
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *REGISTRATION FAILED*\n\n` +
                    `An error occurred: ${error.message}\n\n` +
                    `Please contact admin for assistance.`
                ));
            }

        } catch (error) {
            logger.error('Error in REG command:', error);
            await this.commands.sendMessage(remoteJid, `❌ *AN ERROR OCCURRED*\n\nError: ${error.message}`);
        }
    }

    // Handle SETLID command for Admin LID REGISTRATION
    async handleSetLidCommand(remoteJid, senderNumber, messageText, senderLid) {
        try {
            const billing = new BillingManager();

            // Extract password
            const password = messageText.split(' ').slice(1).join(' ').trim();
            const adminPassword = this.core.getSetting('admin_password');

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!password) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *WRONG FORMAT*\n\n` +
                    `Use format:\n` +
                    `• SETLID [admin_password]\n\n` +
                    `To register this WhatsApp as Admin.`
                ));
                return;
            }

            // Verify admin password
            if (password !== adminPassword) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *WRONG PASSWORD*\n\n` +
                    `The admin password you entered is wrong.`
                ));
                return;
            }

            // Check if LID is available
            if (!senderLid) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `⚠️ *NOT LID*\n\n` +
                    `Your WhatsApp account is not detected using LID.\n` +
                    `You can still use this number as admin (via settings).`
                ));
                // Can continue if want to support regular numbers, but this is LID-specific feature
                // Let's allow mapping regular numbers to dummy 'admin' account if needed
            }

            // But wait, SETLID purpose is so admin can be recognized as admin even using LID.
            // Admin usually doesn't have customer account in billing (unless created as dummy).
            // So we need to save this mapping somewhere.
            // Option 1: Save in settings.json (admins array) -> But this needs file write & restart
            // Option 2: Save in customers table (make admin as customer) -> This is what REG uses

            // Because user requested "SETLID", assume they want to map to an account.
            // But admin numbers are in settings.json.
            // If LID changes frequently, it's hard to hardcode in settings.json.

            // Solution: We search for customer with phone number in settings 'admins'.
            // If not exists, admin must create customer account first with their admin phone.

            // Search customer whose phone matches one of admin numbers?
            // Or just search customer with senderNumber phone (which may or may not be resolved)?
            // If not yet resolved, senderNumber is LID prefix (random number).
            // So we cannot search by phone.

            // User must input their real phone number too?
            // "SETLID [password] [real_phone_number]" ?
            // Or just "SETLID [password]" then we search for customer named "Admin" or similar?

            // BETTER: "SETLID [password] [admin_phone_number]"
            // This command will link sender LID to customer with admin_phone_number.

            const parts = messageText.split(' ');
            if (parts.length < 3) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *INCOMPLETE FORMAT*\n\n` +
                    `Use format:\n` +
                    `• SETLID [admin_password] [admin_phone_number]\n\n` +
                    `Example:\n` +
                    `• SETLID secret123 081234567890`
                ));
                return;
            }

            const targetPhone = parts[2];

            // Search customer with that phone number
            const customer = await billing.getCustomerByPhone(targetPhone);

            if (!customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *Customer not found*\n\n` +
                    `No customer data found with phone number: ${targetPhone}\n\n` +
                    `Please create a dummy customer account for Admin with that number first.`
                ));
                return;
            }

            // Update LID
            const targetLid = senderLid || remoteJid;
            await billing.updateCustomerWhatsAppLid(customer.id, targetLid);

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                `✅ *ADMIN LID SUCCESSFULLY SET*\n\n` +
                `Your WhatsApp LID has been successfully linked to account:\n` +
                `👤 *Name:* ${customer.name}\n` +
                `📞 *Number:* ${customer.phone}\n\n` +
                `System now recognizes you as: ${customer.phone}\n` +
                `Please try sending *ADMIN* or *MENU* command.`
            ));

        } catch (error) {
            logger.error('Error in SETLID command:', error);
            await this.commands.sendMessage(remoteJid, `❌ *ERROR*: ${error.message}`);
        }
    }

    // Handle Technician commands (for technicians who are not admin)
    async handleTechnicianCommands(remoteJid, senderNumber, command, messageText) {
        // Commands that technicians can access (cannot access all admin features)

        logger.info(`🔍 [TECHNICIAN] Processing command: "${command}" from ${senderNumber}`);

        // Help Commands
        if (command === 'teknisi' || command === 'technician') {
            logger.info(`🔍 [TECHNICIAN] Handling technician command`);
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        if (command === 'help') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        // Trouble Report Commands (HIGH PRIORITY)
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }

        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }

        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }

        if (command.startsWith('selesai ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        // Search Commands (for technicians)
        if (command.startsWith('cari ')) {
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        if (command.startsWith('catatan ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }

        // PPPoE Commands (NEW INSTALLATION)
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }

        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }

        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }

        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }

        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }

        // Basic device commands (terbatas)
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        // Search Commands
        if (command.startsWith('cari ')) {
            logger.info(`🔍 [TECHNICIAN] Handling cari command`);
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        // Debug GenieACS Commands (case insensitive)
        if (command.toLowerCase().startsWith('debuggenieacs ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debuggenieacs command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // Simple debug command
        if (command.toLowerCase().startsWith('debug ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debug command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // List all devices command
        if (command === 'listdevices') {
            logger.info(`🔍 [TECHNICIAN] Handling listdevices command`);
            await this.handleListDevices(remoteJid);
            return;
        }

        // Unknown command for technician
        console.log(`Unknown command from technician: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *UNKNOWN COMMAND*\n\nCommand "${command}" is not recognized.\n\nType *technician* to see technician menu.`
        // );
    }

    // Handle Admin commands
    async handleAdminCommands(remoteJid, senderNumber, command, messageText) {
        // Catch ALL commands containing the word 'agent' first
        if (command.includes('agent') || command === 'agent' || command.includes('daftaragent')) {
            logger.info(`DEBUG Routing to agent admin handler: "${command}"`);
            this.agentAdminCommands._sendMessage = async (jid, message) => {
                await this.commands.sendMessage(jid, message);
            };
            await this.agentAdminCommands.handleAgentAdminCommands(remoteJid, senderNumber, command, messageText);
            return;
        }

        // Other admin WhatsApp handlers (cek, refresh, menu, status, etc)
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }

        if (command === 'cekall') {
            await this.commands.handleCekAll(remoteJid);
            return;
        }

        if (command.startsWith('refresh ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleRefresh(remoteJid, deviceId);
            return;
        }

        if (command.startsWith('gantissid ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newSSID = params.slice(1).join(' ');
                await this.commands.handleGantiSSID(remoteJid, customerNumber, newSSID);
            }
            return;
        }

        if (command.startsWith('gantipass ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newPassword = params.slice(1).join(' ');
                await this.commands.handleGantiPassword(remoteJid, customerNumber, newPassword);
            }
            return;
        }

        if (command.startsWith('reboot ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleReboot(remoteJid, customerNumber);
            return;
        }

        // Search Commands
        if (command.startsWith('cari ')) {
            logger.info(`🔍 [TECHNICIAN] Handling cari command`);
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleSearchCustomer(remoteJid, searchTerm);
            return;
        }

        // Debug GenieACS Commands (case insensitive)
        if (command.toLowerCase().startsWith('debuggenieacs ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debuggenieacs command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // Simple debug command
        if (command.toLowerCase().startsWith('debug ')) {
            logger.info(`🔍 [TECHNICIAN] Handling debug command`);
            const phoneNumber = messageText.split(' ')[1];
            await this.handleDebugGenieACS(remoteJid, phoneNumber);
            return;
        }

        // List all devices command
        if (command === 'listdevices') {
            logger.info(`🔍 [TECHNICIAN] Handling listdevices command`);
            await this.handleListDevices(remoteJid);
            return;
        }

        if (command.startsWith('tag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleAddTag(remoteJid, deviceId, tag);
            }
            return;
        }

        if (command.startsWith('untag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleRemoveTag(remoteJid, deviceId, tag);
            }
            return;
        }

        if (command.startsWith('tags ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleListTags(remoteJid, deviceId);
            return;
        }

        if (command.startsWith('addtag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const customerNumber = params[1];
                await this.commands.handleAddTag(remoteJid, deviceId, customerNumber);
            }
            return;
        }

        // System Commands
        if (command === 'status') {
            await this.commands.handleStatus(remoteJid);
            return;
        }

        if (command === 'restart') {
            await this.commands.handleRestart(remoteJid);
            return;
        }

        if (command === 'ya' || command === 'iya' || command === 'yes') {
            await this.commands.handleConfirmRestart(remoteJid);
            return;
        }

        if (command === 'tidak' || command === 'no' || command === 'batal' || command === 'cancel') {
            if (global.pendingRestart && global.restartRequestedBy === remoteJid) {
                global.pendingRestart = false;
                global.restartRequestedBy = null;
                await this.commands.sendMessage(remoteJid,
                    `✅ *RESTART CANCELLED*\n\nApplication restart has been cancelled.`
                );
            }
            return;
        }

        if (command === 'debug resource') {
            await this.commands.handleDebugResource(remoteJid);
            return;
        }

        if (command === 'checkgroup') {
            await this.commands.handleCheckGroup(remoteJid);
            return;
        }

        if (command.startsWith('setheader ')) {
            const newHeader = messageText.split(' ').slice(1).join(' ');
            await this.commands.handleSetHeader(remoteJid, newHeader);
            return;
        }

        // Trouble Report Commands
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }

        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }

        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }

        if (command.startsWith('selesai ') || command.startsWith('resolve ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command.startsWith('catatan ') || command.startsWith('note ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }

        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }

        // PPPoE Commands
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }

        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }

        if (command.startsWith('delpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const username = params[0];
                const reason = params.slice(1).join(' ') || null;
                await this.pppoeCommands.handleDeletePPPoE(remoteJid, username, reason);
            }
            return;
        }

        if (command.startsWith('pppoe ')) {
            const filter = messageText.split(' ').slice(1).join(' ');
            await this.pppoeCommands.handleListPPPoE(remoteJid, filter);
            return;
        }

        if (command === 'pppoe') {
            await this.pppoeCommands.handleListPPPoE(remoteJid);
            return;
        }

        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }

        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }

        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }

        // Help Commands
        if (command === 'admin') {
            await this.sendAdminHelp(remoteJid);
            return;
        }

        if (command === 'teknisi') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }

        if (command === 'menu' || command === 'help') {
            await this.sendAdminHelp(remoteJid);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }

        // Unknown command
        // DO NOT send messages for unrecognized commands
        // This will prevent automatic response to every message
        console.log(`Unknown command from admin: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *UNKNOWN COMMAND*
        //
        // Command "${command}" is not recognized.
        //
        // Type *admin* to see complete menu.`
        // );
    }

    // Handle Customer commands
    async handleCustomerCommands(remoteJid, senderNumber, command, messageText) {
        // Customer-specific commands
        if (command === 'status') {
            await this.handleCustomerStatus(remoteJid, senderNumber);
            return;
        }

        if (command === 'menu' || command === 'help') {
            await this.sendCustomerHelp(remoteJid);
            return;
        }

        if (command === 'info') {
            await this.handleCustomerInfo(remoteJid, senderNumber);
            return;
        }

        // Search Commands (for customer - limited access)
        if (command.startsWith('cari ')) {
            const searchTerm = messageText.split(' ').slice(1).join(' ');
            await this.handleCustomerSearch(remoteJid, searchTerm);
            return;
        }

        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }

        // Unknown command for customer
        // DO NOT send messages for unrecognized commands
        // This will prevent automatic response to every message
        console.log(`Unknown command from customer: ${command}`);
        // await this.commands.sendMessage(remoteJid, 
        //     `❓ *UNKNOWN COMMAND*\n\nCommand "${command}" is not recognized.\n\nType *menu* to see customer menu.`
        // );
    }

    // Send admin help message
    async sendAdminHelp(remoteJid) {
        const helpMessage = getAdminHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Send technician help message
    async sendTechnicianHelp(remoteJid) {
        const helpMessage = getTechnicianHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Send customer help message
    async sendCustomerHelp(remoteJid) {
        const helpMessage = getCustomerHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Handle customer status request
    async handleCustomerStatus(remoteJid, senderNumber) {
        try {
            await this.commands.sendMessage(remoteJid,
                `📱 *CUSTOMER STATUS*\n\nChecking your device status...\nPlease wait a moment.`
            );

            // Use getCustomerComprehensiveData to get complete status
            // senderNumber should already be a phone number (resolved from LID if available)
            const customerData = await this.getCustomerComprehensiveData(senderNumber);

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📱 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!customerData.deviceFound && !customerData.billingData.customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *DATA NOT FOUND*\n\n` +
                    `WhatsApp Number You (${senderNumber}) is not registered as customer.\n\n` +
                    `If you are a new customer, please contact admin for registration.`
                ));
                return;
            }

            let message = ``;

            // Info Customer
            if (customerData.billingData && customerData.billingData.customer) {
                const c = customerData.billingData.customer;
                message += `👤 *CUSTOMER INFO*\n`;
                message += `• Name: ${c.name}\n`;
                message += `• Package: ${c.package_name || '-'}\n`;
                message += `• Bill: ${c.payment_status === 'paid' ? '✅ Paid' : '⚠️ Unpaid'}\n\n`;
            }

            // Info Device
            if (customerData.deviceFound) {
                message += `🔧 *DEVICE STATUS*\n`;
                message += `• Status: ${customerData.status === 'Online' ? '🟢 ONLINE' : '🔴 OFFLINE'}\n`;
                message += `• Signal (RX): ${customerData.rxPower}\n`;

                if (customerData.status === 'Online') {
                    message += `• Active User: ${customerData.connectedUsers}\n`;
                    message += `• Uptime: ${customerData.uptime}\n`;
                }

                message += `• Last Update: ${customerData.lastInform}\n`;
            } else {
                message += `🔧 *DEVICE STATUS*\n`;
                message += `⚠️ Device data not found / offline for a long time.\n`;
            }

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(message));

        } catch (error) {
            logger.error('Error handling customer status', {
                sender: senderNumber,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nAn error occurred while checking status:\n${error.message}`
            );
        }
    }

    // Handle customer info request
    async handleCustomerInfo(remoteJid, senderNumber) {
        try {
            const billingManager = require('./billing');

            await this.commands.sendMessage(remoteJid,
                `📋 *SERVICE INFO*\n\nRetrieving your service information...\nPlease wait a moment.`
            );

            const customer = await billingManager.getCustomerByPhone(senderNumber);

            const formatWithHeaderFooter = (content) => {
                const header = getCompanyHeader();
                const footer = getFooterInfo();
                return `📋 *${header}*\n\n${content}\n\n_${footer}_`;
            };

            if (!customer) {
                await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(
                    `❌ *DATA NOT FOUND*\n\n` +
                    `WhatsApp Number You (${senderNumber}) is not registered.\n` +
                    `Please contact admin for assistance.`
                ));
                return;
            }

            // Get invoices
            const invoices = await billingManager.getInvoicesByCustomer(customer.id);
            const unpaidInvoice = invoices.find(inv => inv.status === 'unpaid');

            let message = `👤 *CUSTOMER PROFILE*\n\n`;
            message += `� *BILL STATUS*\n`;
            if (unpaidInvoice) {
                message += `⚠️ *UNPAID*\n`;
                message += `• Period: ${unpaidInvoice.period || '-'}\n`;
                message += `• Amount: Rs ${unpaidInvoice.amount.toLocaleString('en-PK')}\n`;
                message += `• Due Date: ${new Date(unpaidInvoice.due_date).toLocaleDateString('en-PK')}\n`;
                message += `\nPlease make payment to avoid service disruption.`;
            } else {
                message += `✅ *PAID*\n`;
                message += `Thank you for making payment on time.`;
            }

            await this.commands.sendMessage(remoteJid, formatWithHeaderFooter(message));

        } catch (error) {
            logger.error('Error handling customer info', {
                sender: senderNumber,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR*\n\nAn error occurred while retrieving info:\n${error.message}`
            );
        }
    }

    // Handle customer search command (limited access)
    async handleCustomerSearch(remoteJid, searchTerm) {
        try {
            if (!searchTerm || searchTerm.trim() === '') {
                await this.commands.sendMessage(remoteJid,
                    `❌ *WRONG FORMAT!*\n\n` +
                    `Format: search [customer_name]\n` +
                    `Example:\n` +
                    `• cari andi\n` +
                    `• cari santo`
                );
                return;
            }

            // Import billing manager
            const billingManager = require('./billing');

            // Send processing message
            await this.commands.sendMessage(remoteJid,
                `🔍 *SEARCHING CUSTOMER*\n\nSearching for customer data with keyword: "${searchTerm}"\nPlease wait a moment...`
            );

            // Search customers
            const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);

            if (customers.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *Customer not found!*\n\n` +
                    `No customer found with keyword: "${searchTerm}"\n\n` +
                    `💡 *Search tips:*\n` +
                    `• Use full or partial name\n` +
                    `• Make sure spelling is correct`
                );
                return;
            }

            // Format search results (limited info for customers)
            let message = `🔍 *CUSTOMER SEARCH RESULTS*\n\n`;
            message += `Keyword: "${searchTerm}"\n`;
            message += `Found: ${customers.length} customer\n\n`;

            for (let i = 0; i < customers.length; i++) {
                const customer = customers[i];
                const status = customer.status === 'active' ? '🟢 Active' : '🔴 Inactive';

                message += `📋 *${i + 1}. ${customer.name}*\n`;
                message += `📱 Phone: ${customer.phone}\n`;
                message += `📦 Package: ${customer.package_name || 'N/A'} (${customer.package_speed || 'N/A'})\n`;
                message += `💰 Price: Rs ${customer.package_price ? customer.package_price.toLocaleString('en-PK') : 'N/A'}\n`;
                message += `📊 Status: ${status}\n`;

                if (customer.address) {
                    message += `📍 Address: ${customer.address}\n`;
                }

                message += `\n`;
            }

            // Add usage instructions
            message += `💡 *For more detailed information, contact admin.*`;

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error handling customer search', {
                searchTerm,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *SYSTEM ERROR!*\n\n` +
                `An error occurred while searching customer:\n${error.message}\n\n` +
                `Please try again or contact admin.`
            );
        }
    }

    // Handle search customer command
    async handleSearchCustomer(remoteJid, searchTerm) {
        try {
            if (!searchTerm || searchTerm.trim() === '') {
                await this.commands.sendMessage(remoteJid,
                    `❌ *WRONG FORMAT!*\n\n` +
                    `Format: search [customer_name/pppoe_username]\n` +
                    `Example:\n` +
                    `• cari andi\n` +
                    `• cari santo\n` +
                    `• cari leha\n` +
                    `• cari 081234567890`
                );
                return;
            }

            // Import billing manager and genieacs
            const billingManager = require('./billing');
            const genieacsApi = require('./genieacs');

            // Send processing message
            await this.commands.sendMessage(remoteJid,
                `🔍 *SEARCHING CUSTOMER*\n\nSearching for customer data with keyword: "${searchTerm}"\nPlease wait a moment...`
            );

            // Search customers
            const customers = await billingManager.findCustomersByNameOrPhone(searchTerm);

            if (customers.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *Customer not found!*\n\n` +
                    `No customer found with keyword: "${searchTerm}"\n\n` +
                    `💡 *Search tips:*\n` +
                    `• Use full or partial name\n` +
                    `• Use PPPoE username\n` +
                    `• Use phone number\n` +
                    `• Make sure spelling is correct`
                );
                return;
            }

            // Format search results
            let message = `🔍 *CUSTOMER SEARCH RESULTS*\n\n`;
            message += `Keyword: "${searchTerm}"\n`;
            message += `Found: ${customers.length} customer\n\n`;

            for (let i = 0; i < customers.length; i++) {
                const customer = customers[i];
                const status = customer.status === 'active' ? '🟢 Active' : '🔴 Inactive';
                const paymentStatus = customer.payment_status === 'overdue' ? '🔴 Overdue' :
                    customer.payment_status === 'unpaid' ? '🟡 Unpaid' :
                        customer.payment_status === 'paid' ? '🟢 Paid' : '⚪ No Invoice';

                message += `📋 *${i + 1}. ${customer.name}*\n`;
                message += `📱 Phone: ${customer.phone}\n`;
                message += `👤 Username: ${customer.username || 'N/A'}\n`;
                message += `🌐 PPPoE: ${customer.pppoe_username || 'N/A'}\n`;
                message += `📦 Package: ${customer.package_name || 'N/A'} (${customer.package_speed || 'N/A'})\n`;
                message += `💰 Price: Rs ${customer.package_price ? customer.package_price.toLocaleString('en-PK') : 'N/A'}\n`;
                message += `📊 Status: ${status}\n`;
                message += `💳 Payment: ${paymentStatus}\n`;

                if (customer.address) {
                    message += `📍 Address: ${customer.address}\n`;
                }

                // Get comprehensive data using customer dashboard logic
                try {
                    const customerData = await this.getCustomerComprehensiveData(customer.phone);

                    if (customerData.deviceFound) {
                        message += `\n🔧 *GENIEACS DEVICE DATA:*\n`;
                        message += `• Status: ${customerData.status}\n`;
                        message += `• Last Inform: ${customerData.lastInform}\n`;
                        message += `• Device ID: ${customerData.deviceId}\n`;
                        message += `• Serial: ${customerData.serialNumber}\n`;
                        message += `• Manufacturer: ${customerData.manufacturer}\n`;
                        message += `• Model: ${customerData.model}\n`;
                        message += `• Hardware: ${customerData.hardwareVersion}\n`;
                        message += `• Firmware: ${customerData.firmware}\n`;
                        message += `• Device Uptime: ${customerData.uptime}\n`;
                        message += `• PPP Uptime: ${customerData.pppUptime}\n`;
                        message += `• PPPoE IP: ${customerData.pppoeIP}\n`;
                        message += `• PPPoE Username: ${customerData.pppoeUsername}\n`;
                        message += `• RX Power: ${customerData.rxPower} dBm\n`;
                        message += `• Temperature: ${customerData.temperature}°C\n`;
                        message += `• SSID 2.4G: ${customerData.ssid}\n`;
                        message += `• SSID 5G: ${customerData.ssid5G}\n`;
                        message += `• Connected Users: ${customerData.connectedUsers}\n`;
                        message += `• PON Mode: ${customerData.ponMode}\n`;

                        if (customerData.tags && customerData.tags.length > 0) {
                            message += `• Tags: ${customerData.tags.join(', ')}\n`;
                        }
                    } else {
                        message += `\n🔧 *DEVICE DATA:* ${customerData.message}\n`;
                        message += `Error retrieving device data\n`;
                        message += `• Error: ${customerData.message}\n`;
                    }
                } catch (deviceError) {
                    logger.error(`❌ [SEARCH] Error getting device data for ${customer.phone}:`, deviceError.message);
                    message += `Error retrieving device data\n`;
                    message += `• Error: ${deviceError.message}\n`;
                }

                message += `\n`;
            }

            // Add usage instructions
            message += `💡 *How to use the data above:*\n`;
            message += `• Use phone number for check status command\n`;
            message += `• Example: cek ${customers[0].phone}\n`;
            message += `• Or: cekstatus ${customers[0].phone}`;

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error handling search customer', {
                searchTerm,
                error: error.message
            });

            await this.commands.sendMessage(remoteJid,
                `❌ *SYSTEM ERROR!*\n\n` +
                `An error occurred while searching customer:\n${error.message}\n\n` +
                `Please try again or contact admin.`
            );
        }
    }

    // Get comprehensive customer data using customer dashboard logic
    async getCustomerComprehensiveData(phone) {
        try {
            // 1. Get customer data from billing first (try all phone variants)
            let customer = null;
            const phoneVariants = this.generatePhoneVariants(phone);

            logger.info(`🔍 [COMPREHENSIVE] Searching customer with phone variants:`, phoneVariants);

            for (const variant of phoneVariants) {
                try {
                    const billingManager = require('./billing');
                    customer = await billingManager.getCustomerByPhone(variant);
                    if (customer) {
                        logger.info(`✅ [COMPREHENSIVE] Customer found in billing with variant: ${variant}`);
                        break;
                    }
                } catch (error) {
                    logger.warn(`⚠️ [COMPREHENSIVE] Error searching with variant ${variant}:`, error.message);
                }
            }

            let device = null;
            let billingData = null;

            if (customer) {
                logger.info(`✅ [COMPREHENSIVE] Customer found in billing: ${customer.name} (${customer.phone}) - searched with: ${phone}`);

                // 2. CUSTOMER BILLING: Search device by PPPoE username (FAST PATH)
                if (customer.pppoe_username || customer.username) {
                    try {
                        const { genieacsApi } = require('./genieacs');
                        const pppoeToSearch = customer.pppoe_username || customer.username;
                        logger.info(`🔍 [COMPREHENSIVE] Searching device by PPPoE username: ${pppoeToSearch}`);

                        device = await genieacsApi.findDeviceByPPPoE(pppoeToSearch);
                        if (device) {
                            logger.info(`✅ [COMPREHENSIVE] Device found by PPPoE username: ${pppoeToSearch}`);
                        } else {
                            logger.warn(`⚠️ [COMPREHENSIVE] No device found by PPPoE username: ${pppoeToSearch}`);
                        }
                    } catch (error) {
                        logger.error('❌ [COMPREHENSIVE] Error finding device by PPPoE username:', error.message);
                    }
                }

                // 3. If not found with PPPoE, try with tag as fallback
                if (!device) {
                    logger.info(`🔍 [COMPREHENSIVE] Trying tag search as fallback...`);
                    const { genieacsApi } = require('./genieacs');
                    const tagVariants = this.generatePhoneVariants(phone);

                    for (const v of tagVariants) {
                        try {
                            device = await genieacsApi.findDeviceByPhoneNumber(v);
                            if (device) {
                                logger.info(`✅ [COMPREHENSIVE] Device found by tag fallback: ${v}`);
                                break;
                            }
                        } catch (error) {
                            logger.warn(`⚠️ [COMPREHENSIVE] Error searching by tag ${v}:`, error.message);
                        }
                    }
                }

                // 4. Siapkan data billing
                try {
                    const billingManager = require('./billing');
                    const invoices = await billingManager.getInvoicesByCustomer(customer.id);
                    billingData = {
                        customer: customer,
                        invoices: invoices || []
                    };
                } catch (error) {
                    logger.error('❌ [COMPREHENSIVE] Error getting billing data:', error);
                    billingData = {
                        customer: customer,
                        invoices: []
                    };
                }

            } else {
                // 5. CUSTOMER NON-BILLING: Search device by tag only (FAST PATH)
                logger.info(`⚠️ [COMPREHENSIVE] Customer not found in billing, searching GenieACS by tag only`);

                const { genieacsApi } = require('./genieacs');
                const tagVariants = this.generatePhoneVariants(phone);
                for (const v of tagVariants) {
                    try {
                        device = await genieacsApi.findDeviceByPhoneNumber(v);
                        if (device) {
                            logger.info(`✅ [COMPREHENSIVE] Device found by tag: ${v}`);
                            break;
                        }
                    } catch (error) {
                        logger.warn(`⚠️ [COMPREHENSIVE] Error searching by tag ${v}:`, error.message);
                    }
                }
            }

            // 6. If no device in GenieACS, create informative default data
            if (!device) {
                logger.info(`⚠️ [COMPREHENSIVE] No device found in GenieACS for: ${phone}`);

                return {
                    phone: phone,
                    ssid: customer ? `WiFi-${customer.username}` : 'WiFi-Default',
                    status: 'Unknown',
                    lastInform: '-',
                    firmware: '-',
                    rxPower: '-',
                    pppoeIP: '-',
                    pppoeUsername: customer ? (customer.pppoe_username || customer.username) : '-',
                    connectedUsers: '0',
                    billingData: billingData,
                    deviceFound: false,
                    searchMethod: customer ? 'pppoe_username_fallback_tag' : 'tag_only',
                    message: customer ?
                        'Device ONU not found in GenieACS. Please contact technician for device setup.' :
                        'Customer not registered in billing system. Please contact admin.'
                };
            }

            // 7. If device exists in GenieACS, get complete data
            logger.info(`✅ [COMPREHENSIVE] Processing device data for: ${device._id}`);

            const ssid = device?.InternetGatewayDevice?.LANDevice?.['1']?.WLANConfiguration?.['1']?.SSID?._value ||
                device?.VirtualParameters?.SSID ||
                (customer ? `WiFi-${customer.username}` : 'WiFi-Default');

            const lastInform = device?._lastInform
                ? new Date(device._lastInform).toLocaleString('en-PK')
                : device?.Events?.Inform
                    ? new Date(device.Events.Inform).toLocaleString('en-PK')
                    : device?.InternetGatewayDevice?.DeviceInfo?.['1']?.LastInform?._value
                        ? new Date(device.InternetGatewayDevice.DeviceInfo['1'].LastInform._value).toLocaleString('en-PK')
                        : '-';

            const status = lastInform !== '-' ? 'Online' : 'Unknown';

            // Extract device parameters
            const rxPower = this.getParameterWithPaths(device, this.parameterPaths.rxPower) || '-';
            const pppoeIP = this.getParameterWithPaths(device, this.parameterPaths.pppoeIP) || '-';
            const pppoeUsername = customer ? (customer.pppoe_username || customer.username) :
                this.getParameterWithPaths(device, this.parameterPaths.pppUsername) || '-';
            const connectedUsers = this.getParameterWithPaths(device, this.parameterPaths.userConnected) || '0';
            const temperature = this.getParameterWithPaths(device, this.parameterPaths.temperature) || '-';
            const ponMode = this.getParameterWithPaths(device, this.parameterPaths.ponMode) || '-';
            const pppUptime = this.getParameterWithPaths(device, this.parameterPaths.pppUptime) || '-';
            const firmware = device?.InternetGatewayDevice?.DeviceInfo?.SoftwareVersion?._value ||
                device?.VirtualParameters?.softwareVersion || '-';
            const uptime = device?.InternetGatewayDevice?.DeviceInfo?.UpTime?._value || '-';
            const serialNumber = device.DeviceID?.SerialNumber ||
                device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value ||
                device._id;
            const manufacturer = device.InternetGatewayDevice?.DeviceInfo?.Manufacturer?._value || '-';
            const model = device.DeviceID?.ProductClass ||
                device.InternetGatewayDevice?.DeviceInfo?.ModelName?._value || '-';
            const hardwareVersion = device.InternetGatewayDevice?.DeviceInfo?.HardwareVersion?._value || '-';

            // SSID 5G
            const ssid5G = this.getSSIDValue(device, '5') || 'N/A';

            // Tags
            const tags = device._tags || [];

            return {
                phone: phone,
                ssid: ssid,
                status: status,
                lastInform: lastInform,
                deviceId: device._id,
                serialNumber: serialNumber,
                manufacturer: manufacturer,
                model: model,
                hardwareVersion: hardwareVersion,
                firmware: firmware,
                uptime: uptime,
                pppUptime: pppUptime,
                pppoeIP: pppoeIP,
                pppoeUsername: pppoeUsername,
                rxPower: rxPower,
                temperature: temperature,
                ssid5G: ssid5G,
                connectedUsers: connectedUsers,
                ponMode: ponMode,
                tags: tags,
                billingData: billingData,
                deviceFound: true,
                searchMethod: customer ? 'pppoe_username_fallback_tag' : 'tag_only'
            };

        } catch (error) {
            logger.error('❌ [COMPREHENSIVE] Error in getCustomerComprehensiveData:', error);
            return {
                phone: phone,
                deviceFound: false,
                message: `Error: ${error.message}`,
                searchMethod: 'error'
            };
        }
    }

    // Helper method to check device status
    getDeviceStatus(lastInform) {
        if (!lastInform) return false;
        const now = Date.now();
        const lastInformTime = new Date(lastInform).getTime();
        const timeDiff = now - lastInformTime;
        // Consider device online if last inform was within 5 minutes
        return timeDiff < 5 * 60 * 1000;
    }

    // Helper method to format uptime (from genieacs-commands.js)
    formatUptime(uptimeValue) {
        if (!uptimeValue || uptimeValue === 'N/A') return 'N/A';

        // If already formatted (like "5d 04:50:18"), return as is
        if (typeof uptimeValue === 'string' && uptimeValue.includes('d ')) {
            return uptimeValue;
        }

        // If it's seconds, convert to formatted string
        if (!isNaN(uptimeValue)) {
            const seconds = parseInt(uptimeValue);
            const days = Math.floor(seconds / (24 * 3600));
            const hours = Math.floor((seconds % (24 * 3600)) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            let result = '';
            if (days > 0) result += `${days}d `;
            if (hours > 0) result += `${hours}h `;
            if (minutes > 0) result += `${minutes}m `;
            if (secs > 0) result += `${secs}s`;

            return result.trim() || '0s';
        }

        return uptimeValue;
    }

    // Helper method to get device parameters from GenieACS device object
    getDeviceParameters(device) {
        const getParameterWithPaths = (device, paths) => {
            if (!device || !paths || !Array.isArray(paths)) return 'N/A';

            for (const path of paths) {
                try {
                    const value = this.getParameterValue(device, path);
                    if (value && value !== 'N/A') {
                        return value;
                    }
                } catch (error) {
                    // Continue to next path
                }
            }
            return 'N/A';
        };

        const getParameterValue = (device, path) => {
            if (!device || !path) return 'N/A';

            try {
                const pathParts = path.split('.');
                let current = device;

                for (const part of pathParts) {
                    if (current && typeof current === 'object') {
                        current = current[part];
                    } else {
                        return 'N/A';
                    }
                }

                // Handle GenieACS parameter format
                if (current && typeof current === 'object' && current._value !== undefined) {
                    return current._value;
                }

                // Handle direct value
                if (current !== null && current !== undefined && current !== '') {
                    return current;
                }

                return 'N/A';
            } catch (error) {
                return 'N/A';
            }
        };

        const getSSIDValue = (device, configIndex) => {
            try {
                // Try method 1: Using bracket notation for WLANConfiguration
                if (device.InternetGatewayDevice &&
                    device.InternetGatewayDevice.LANDevice &&
                    device.InternetGatewayDevice.LANDevice['1'] &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex] &&
                    device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID) {

                    const ssidObj = device.InternetGatewayDevice.LANDevice['1'].WLANConfiguration[configIndex].SSID;
                    if (ssidObj._value !== undefined) {
                        return ssidObj._value;
                    }
                }

                // Try method 2: Using getParameterWithPaths
                const ssidPath = `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${configIndex}.SSID`;
                const ssidValue = getParameterWithPaths(device, [ssidPath]);
                if (ssidValue && ssidValue !== 'N/A') {
                    return ssidValue;
                }

                return 'N/A';
            } catch (error) {
                return 'N/A';
            }
        };

        const formatUptime = (uptimeValue) => {
            if (!uptimeValue || uptimeValue === 'N/A') return 'N/A';

            // If already formatted (like "5d 04:50:18"), return as is
            if (typeof uptimeValue === 'string' && uptimeValue.includes('d ')) {
                return uptimeValue;
            }

            // If it's seconds, convert to formatted string
            if (!isNaN(uptimeValue)) {
                const seconds = parseInt(uptimeValue);
                const days = Math.floor(seconds / (24 * 3600));
                const hours = Math.floor((seconds % (24 * 3600)) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;

                let result = '';
                if (days > 0) result += `${days}d `;
                if (hours > 0) result += `${hours}h `;
                if (minutes > 0) result += `${minutes}m `;
                if (secs > 0) result += `${secs}s`;

                return result.trim() || '0s';
            }

            return uptimeValue;
        };

        // Parameter paths for different device parameters
        const parameterPaths = {
            rxPower: [
                'VirtualParameters.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANPONInterfaceConfig.RXPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_ALU-COM_RxPower',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.RxPower',
                'Device.Optical.Interface.1.RxPower'
            ],
            pppoeIP: [
                'VirtualParameters.pppoeIP',
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
                'Device.PPP.Interface.1.IPCPExtensions.RemoteIPAddress'
            ],
            uptime: [
                'VirtualParameters.getdeviceuptime',
                'InternetGatewayDevice.DeviceInfo.UpTime',
                'Device.DeviceInfo.UpTime'
            ],
            firmware: [
                'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
                'Device.DeviceInfo.SoftwareVersion'
            ],
            userConnected: [
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
                'VirtualParameters.activedevices',
                'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries'
            ],
            temperature: [
                'VirtualParameters.gettemp',
                'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureValue',
                'Device.DeviceInfo.TemperatureStatus.TemperatureValue'
            ],
            serialNumber: [
                'VirtualParameters.getSerialNumber',
                'InternetGatewayDevice.DeviceInfo.SerialNumber'
            ],
            ponMode: [
                'VirtualParameters.getponmode'
            ]
        };

        return {
            serialNumber: getParameterWithPaths(device, parameterPaths.serialNumber),
            firmware: getParameterWithPaths(device, parameterPaths.firmware),
            rxPower: getParameterWithPaths(device, parameterPaths.rxPower),
            pppoeIP: getParameterWithPaths(device, parameterPaths.pppoeIP),
            uptime: formatUptime(getParameterWithPaths(device, parameterPaths.uptime)),
            temperature: getParameterWithPaths(device, parameterPaths.temperature),
            connectedUsers: getParameterWithPaths(device, parameterPaths.userConnected),
            ponMode: getParameterWithPaths(device, parameterPaths.ponMode),
            ssid: getSSIDValue(device, '1'),
            ssid5G: getSSIDValue(device, '5')
        };
    }

    // Handle list all devices command
    async handleListDevices(remoteJid) {
        try {
            const genieacsApi = require('./genieacs');

            await this.commands.sendMessage(remoteJid,
                `🔍 *LIST ALL DEVICES*\n\nRetrieving all devices from GenieACS...\nPlease wait...`
            );

            const allDevices = await genieacsApi.getDevices();

            if (!allDevices || allDevices.length === 0) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *NO DEVICES FOUND!*\n\nNo devices found in GenieACS.`
                );
                return;
            }

            let message = `📱 *LIST ALL DEVICES*\n\n`;
            message += `Total devices: ${allDevices.length}\n\n`;

            // Show first 10 devices with details
            const devicesToShow = allDevices.slice(0, 10);

            for (let i = 0; i < devicesToShow.length; i++) {
                const device = devicesToShow[i];
                message += `${i + 1}. *Device ID:* ${device._id}\n`;
                message += `   *Tags:* ${device._tags ? device._tags.join(', ') : 'None'}\n`;
                message += `   *Last Inform:* ${device._lastInform ? new Date(device._lastInform).toLocaleString() : 'N/A'}\n`;

                // Check PPPoE username
                const pppoeUsername = this.getParameterWithPaths(device, this.parameterPaths.pppUsername);
                if (pppoeUsername !== 'N/A') {
                    message += `   *PPPoE Username:* ${pppoeUsername}\n`;
                }

                // Check serial number
                const serialNumber = device.InternetGatewayDevice?.DeviceInfo?.SerialNumber?._value || 'N/A';
                if (serialNumber !== 'N/A') {
                    message += `   *Serial:* ${serialNumber}\n`;
                }

                message += `\n`;
            }

            if (allDevices.length > 10) {
                message += `... and ${allDevices.length - 10} other devices\n\n`;
            }

            // Show all existing tags
            const allTags = new Set();
            allDevices.forEach(device => {
                if (device._tags) {
                    device._tags.forEach(tag => allTags.add(tag));
                }
            });

            if (allTags.size > 0) {
                message += `🏷️ *ALL EXISTING TAGS:*\n`;
                const tagsArray = Array.from(allTags).sort();
                message += tagsArray.join(', ');
            }

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error in handleListDevices:', error);
            await this.commands.sendMessage(remoteJid,
                `❌ *SYSTEM ERROR!*\n\nAn error occurred while retrieving device list:\n${error.message}`
            );
        }
    }

    // Handle debug GenieACS command
    async handleDebugGenieACS(remoteJid, phoneNumber) {
        try {
            if (!phoneNumber) {
                await this.commands.sendMessage(remoteJid,
                    `❌ *WRONG FORMAT!*\n\n` +
                    `Format: debuggenieacs [phone_number]\n` +
                    `Example: debuggenieacs 087786722675`
                );
                return;
            }

            await this.commands.sendMessage(remoteJid,
                `🔍 *DEBUG GENIEACS*\n\nChecking GenieACS data for number: ${phoneNumber}\nPlease wait...`
            );

            // Get comprehensive data using customer dashboard logic
            const customerData = await this.getCustomerComprehensiveData(phoneNumber);

            let message = `🔍 *DEBUG GENIEACS*\n\n`;
            message += `📱 *Nomor:* ${phoneNumber}\n`;
            message += `🔍 *Search Method:* ${customerData.searchMethod}\n`;
            message += `📊 *Device Found:* ${customerData.deviceFound ? '✅ Ya' : '❌ Tidak'}\n\n`;

            if (customerData.billingData && customerData.billingData.customer) {
                const customer = customerData.billingData.customer;
                message += `👤 *DATA BILLING:*\n`;
                message += `• Name: ${customer.name}\n`;
                message += `• Username: ${customer.username || 'N/A'}\n`;
                message += `• PPPoE Username: ${customer.pppoe_username || 'N/A'}\n`;
                message += `• Status: ${customer.status || 'N/A'}\n`;
                message += `• Package: ${customer.package_id || 'N/A'}\n\n`;
            } else {
                message += `❌ *BILLING:* Customer not found di database billing\n\n`;
            }

            if (customerData.deviceFound) {
                message += `🔧 *DATA PERANGKAT GENIEACS:*\n`;
                message += `• Status: ${customerData.status}\n`;
                message += `• Last Inform: ${customerData.lastInform}\n`;
                message += `• Device ID: ${customerData.deviceId}\n`;
                message += `• Serial: ${customerData.serialNumber}\n`;
                message += `• Manufacturer: ${customerData.manufacturer}\n`;
                message += `• Model: ${customerData.model}\n`;
                message += `• Hardware: ${customerData.hardwareVersion}\n`;
                message += `• Firmware: ${customerData.firmware}\n`;
                message += `• Device Uptime: ${customerData.uptime}\n`;
                message += `• PPP Uptime: ${customerData.pppUptime}\n`;
                message += `• PPPoE IP: ${customerData.pppoeIP}\n`;
                message += `• PPPoE Username: ${customerData.pppoeUsername}\n`;
                message += `• RX Power: ${customerData.rxPower} dBm\n`;
                message += `• Temperature: ${customerData.temperature}°C\n`;
                message += `• SSID 2.4G: ${customerData.ssid}\n`;
                message += `• SSID 5G: ${customerData.ssid5G}\n`;
                message += `• User Terkoneksi: ${customerData.connectedUsers}\n`;
                message += `• PON Mode: ${customerData.ponMode}\n`;

                if (customerData.tags && customerData.tags.length > 0) {
                    message += `• Tags: ${customerData.tags.join(', ')}\n`;
                }
            } else {
                message += `❌ *PERANGKAT:* ${customerData.message}\n`;
            }

            await this.commands.sendMessage(remoteJid, message);

        } catch (error) {
            logger.error('Error in handleDebugGenieACS:', error);
            await this.commands.sendMessage(remoteJid,
                `❌ *ERROR SISTEM!*\n\nTerjadi kesalahan saat debug GenieACS:\n${error.message}`
            );
        }
    }

    // Handle welcome message for super admin
    async handleSuperAdminWelcome(sock) {
        if (!global.superAdminWelcomeSent && this.core.getSuperAdmin() && this.core.getSetting('superadmin_welcome_enabled', true)) {
            try {
                const superAdminJid = this.core.createJID(this.core.getSuperAdmin());
                if (superAdminJid) {
                    await sock.sendMessage(superAdminJid, {
                        text: `${this.core.getSetting('company_header', '📱 NBB Wifiber')}
👋 *Selamat datang*

Aplikasi WhatsApp Bot successful dijalankan.

Rekening Donasi Untuk Pengembangan aplikasi
# 4206 01 003953 53 1 BRI an WARJAYA

E-Wallet : 03036783333

${this.core.getSetting('footer_info', 'Powered by CyberNet')}`
                    });
                    global.superAdminWelcomeSent = true;
                    logger.info('Pesan selamat datang terkirim ke super admin');
                }
            } catch (err) {
                logger.error('Failed to send welcome message to super admin:', err);
            }
        }
    }
}

module.exports = WhatsAppMessageHandlers;
