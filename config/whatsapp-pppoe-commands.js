const { getSetting } = require('./settingsManager');
const logger = require('./logger');

class WhatsAppPPPoECommands {
    constructor(whatsappCore) {
        this.core = whatsappCore;
        this.sock = null;
    }

    // Set socket instance
    setSock(sock) {
        this.sock = sock;
    }

    // Get socket instance
    getSock() {
        return this.sock || this.core.getSock();
    }

    // Helper function to send message
    async sendMessage(remoteJid, text) {
        const sock = this.getSock();
        if (!sock) {
            console.error('Sock instance not set');
            return false;
        }

        try {
            await sock.sendMessage(remoteJid, { text });
            return true;
        } catch (error) {
            console.error('Error sending message:', error);
            return false;
        }
    }

    // Command: Add new PPPoE user
    async handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo) {
        try {
            if (!username || !password || !profile) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\naddpppoe [username] [password] [profile] [ip_optional] [customer_info]\n\nExample:\naddpppoe john123 password123 Premium 192.168.1.100 "John Doe - Jl. Example No. 123"`
                );
                return;
            }

            // Validate password must be at least 8 characters
            if (password.length < 8) {
                await this.sendMessage(remoteJid, 
                    `❌ *PASSWORD TOO SHORT*\n\nPassword must be at least 8 characters.\n\nExample:\naddpppoe john123 password123 Premium`
                );
                return;
            }

            // Validate available profiles
            const validProfileeeeeeeeees = ['Basic', 'Standard', 'Premium', 'VIP', 'Enterprise'];
            if (!validProfileeeeeeeeees.includes(profile)) {
                await this.sendMessage(remoteJid, 
                    `❌ *INVALID PROFILE*\n\nAvailable profiles:\n• Basic\n• Standard\n• Premium\n• VIP\n• Enterprise\n\nExample:\naddpppoe john123 password123 Premium`
                );
                return;
            }

            // Simulate PPPoE user addition (will be integrated with MikroTik)
            const success = await this.createPPPoEUser(username, password, profile, ipAddress, customerInfo);
            
            if (success) {
                let message = `✅ *PPPoE USER SUCCESSFULLY ADDED*\n\n`;
                message += `👤 *Username*: ${username}\n`;
                message += `🔑 *Password*: ${password}\n`;
                message += `📊 *Profileeeeeeeeee*: ${profile}\n`;
                
                if (ipAddress) {
                    message += `🌐 *IP Address*: ${ipAddress}\n`;
                }
                
                if (customerInfo) {
                    message += `📱 *Customer Info*: ${customerInfo}\n`;
                }
                
                message += `🕒 *Created At*: ${new Date().toLocaleString('en-PK')}\n\n`;
                message += `💡 *Next Steps:*\n`;
                message += `1. Set username & password on customer ONU\n`;
                message += `2. Test PPPoE connection\n`;
                message += `3. Verify speed according to profile\n`;
                message += `4. Update status in trouble report if any`;

                await this.sendMessage(remoteJid, message);
                
                // Log activity
                logger.info(`PPPoE user ${username} added successfully by technician`);
                
            } else {
                await this.sendMessage(remoteJid, 
                    `❌ *FAILED TO ADD PPPoE USER*\n\nError occurred while adding user.\nPlease try again or contact admin.`
                );
            }
            
        } catch (error) {
            console.error('Error in handleAddPPPoE:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nError occurred while adding PPPoE user:\n${error.message}`
            );
        }
    }

    // Command: Edit PPPoE user
    async handleEditPPPoE(remoteJid, username, field, newValue) {
        try {
            if (!username || !field || !newValue) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\neditpppoe [username] [field] [new_value]\n\nEditable fields:\n• password - Change password\n• profile - Change profile\n• ip - Change IP address\n• status - Enable/disable\n\nExample:\neditpppoe john123 password password456\neditpppoe john123 profile VIP`
                );
                return;
            }

            // Validate editable fields
            const validFields = ['password', 'profile', 'ip', 'status'];
            if (!validFields.includes(field)) {
                await this.sendMessage(remoteJid, 
                    `❌ *INVALID FIELD*\n\nAvailable fields:\n• password - Change password\n• profile - Change profile\n• ip - Change IP address\n• status - Enable/disable\n\nExample:\neditpppoe john123 password password456`
                );
                return;
            }

            // Special validation for password
            if (field === 'password' && newValue.length < 8) {
                await this.sendMessage(remoteJid, 
                    `❌ *PASSWORD TOO SHORT*\n\nPassword must be at least 8 characters.`
                );
                return;
            }

            // Special validation for profile
            if (field === 'profile') {
                const validProfileeeeeeeeees = ['Basic', 'Standard', 'Premium', 'VIP', 'Enterprise'];
                if (!validProfileeeeeeeeees.includes(newValue)) {
                    await this.sendMessage(remoteJid, 
                        `❌ *INVALID PROFILE*\n\nAvailable profiles:\n• Basic\n• Standard\n• Premium\n• VIP\n• Enterprise`
                    );
                    return;
                }
            }

            // Simulate PPPoE user edit
            const success = await this.updatePPPoEUser(username, field, newValue);
            
            if (success) {
                let message = `✅ *PPPoE USER SUCCESSFULLY UPDATED*\n\n`;
                message += `👤 *Username*: ${username}\n`;
                message += `📝 *Field*: ${field}\n`;
                message += `🆕 *New Value*: ${newValue}\n`;
                message += `🕒 *Updated At*: ${new Date().toLocaleString('en-PK')}\n\n`;
                
                if (field === 'password') {
                    message += `💡 *Next Steps:*\n`;
                    message += `1. Update password on customer ONU\n`;
                    message += `2. Test connection with new password\n`;
                    message += `3. Ensure customer receives new password info`;
                } else if (field === 'profile') {
                    message += `💡 *Next Steps:*\n`;
                    message += `1. Restart PPPoE connection on ONU\n`;
                    message += `2. Test speed according to new profile\n`;
                    message += `3. Verify bandwidth according to package`;
                } else if (field === 'ip') {
                    message += `💡 *Next Steps:*\n`;
                    message += `1. Restart PPPoE connection on ONU\n`;
                    message += `2. Verify new IP address\n`;
                    message += `3. Test internet connection`;
                } else if (field === 'status') {
                    message += `💡 *Next Steps:*\n`;
                    message += `1. ${newValue === 'enable' ? 'Enable' : 'Disable'} connection on ONU\n`;
                    message += `2. Test internet connection\n`;
                    message += `3. Update status in trouble report`;
                }

                await this.sendMessage(remoteJid, message);
                
                // Log activity
                logger.info(`PPPoE user ${username} successfully updated field ${field} by technician`);
                
            } else {
                await this.sendMessage(remoteJid, 
                    `❌ *PPPoE USER UPDATE FAILED*\n\nAn error occurred while updating user.\nPlease try again or contact admin.`
                );
            }
            
        } catch (error) {
            console.error('Error in handleEditPPPoE:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while updating PPPoE user:\n${error.message}`
            );
        }
    }

    // Command: Delete PPPoE user
    async handleDeletePPPoE(remoteJid, username, reason) {
        try {
            if (!username) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\ndelpppoe [username] [reason_optional]\n\nExample:\ndelpppoe john123\nor\ndelpppoe john123 Customer moved location`
                );
                return;
            }

            // Deletion confirmation
            if (!reason) {
                await this.sendMessage(remoteJid, 
                    `⚠️ *CONFIRMATION*\n\nAre you sure you want to delete PPPoE user "${username}"?\n\nResend with reason for confirmation:\ndelpppoe ${username} [deletion_reason]\n\nExample:\ndelpppoe ${username} Customer moved location`
                );
                return;
            }

            // Simulasi penghapusan user PPPoE
            const success = await this.removePPPoEUser(username, reason);
            
            if (success) {
                let message = `✅ *PPPoE USER SUCCESSFULLY DELETED*\n\n`;
                message += `👤 *Username*: ${username}\n`;
                message += `🗑️ *Reason*: ${reason}\n`;
                message += `🕒 *Deleted At*: ${new Date().toLocaleString('en-PK')}\n\n`;
                message += `💡 *Next Steps:*\n`;
                message += `1. Delete PPPoE configuration on ONU\n`;
                message += `2. Ensure no active connections\n`;
                message += `3. Update status in trouble report if any\n`;
                message += `4. Record deletion reason for audit`;

                await this.sendMessage(remoteJid, message);
                
                // Log activity
                logger.info(`PPPoE user ${username} deleted successfully by technician with reason: ${reason}`);
                
            } else {
                await this.sendMessage(remoteJid, 
                    `❌ *FAILED TO DELETE PPPoE USER*\n\nError occurred while deleting user.\nPlease try again or contact admin.`
                );
            }
            
        } catch (error) {
            console.error('Error in handleDeletePPPoE:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nError occurred while deleting PPPoE user:\n${error.message}`
            );
        }
    }

    // Command: View PPPoE user list
    async handleListPPPoE(remoteJid, filter) {
        try {
            // Simulation to get PPPoE user list
            const users = await this.getPPPoEUsers(filter);
            
            if (!users || users.length === 0) {
                await this.sendMessage(remoteJid, 
                    `📋 *PPPoE USER LIST*\n\nNo PPPoE users found${filter ? ` with filter: ${filter}` : ''}.`
                );
                return;
            }

            let message = `📋 *PPPoE USER LIST*\n\n`;
            
            users.forEach((user, index) => {
                const statusEmoji = user.status === 'active' ? '🟢' : '🔴';
                const statusText = user.status === 'active' ? 'Active' : 'Inactive';
                
                message += `${index + 1}. *${user.username}*\n`;
                message += `   ${statusEmoji} Status: ${statusText}\n`;
                message += `   📊 Profileeeeeeeeee: ${user.profile}\n`;
                message += `   🌐 IP: ${user.ip || 'DHCP'}\n`;
                message += `   📱 Customer: ${user.customer || 'N/A'}\n`;
                message += `   🕒 Created: ${new Date(user.createdAt).toLocaleDateString('en-PK')}\n\n`;
            });

            message += `💡 *Available commands:*\n`;
            message += `• *addpppoe [user] [pass] [profile] [ip] [info]* - Add new user\n`;
            message += `• *editpppoe [user] [field] [value]* - Edit user\n`;
            message += `• *delpppoe [user] [reason]* - Delete user\n`;
            message += `• *pppoe [filter]* - View user list\n`;
            message += `• *help pppoe* - PPPoE Help`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleListPPPoE:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while retrieving PPPoE user list:\n${error.message}`
            );
        }
    }

    // Command: Check PPPoE user status
    async handleCheckPPPoEStatus(remoteJid, username) {
        try {
            if (!username) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\ncheckpppoe [username]\n\nExample:\ncheckpppoe john123`
                );
                return;
            }

            // Simulasi cek status user PPPoE
            const userStatus = await this.getPPPoEUserStatus(username);
            
            if (!userStatus) {
                await this.sendMessage(remoteJid, 
                    `❌ *USER NOT FOUND*\n\nPPPoE user "${username}" not found in system.`
                );
                return;
            }

            const statusEmoji = userStatus.status === 'active' ? '🟢' : '🔴';
            const statusText = userStatus.status === 'active' ? 'Active' : 'Inactive';
            const connectionEmoji = userStatus.connected ? '🟢' : '🔴';
            const connectionText = userStatus.connected ? 'Connected' : 'Not Connected';

            let message = `📊 *PPPoE USER STATUS*\n\n`;
            message += `👤 *Username*: ${userStatus.username}\n`;
            message += `📊 *Profileeeeeeeeee*: ${userStatus.profile}\n`;
            message += `${statusEmoji} *Status*: ${statusText}\n`;
            message += `${connectionEmoji} *Connection*: ${connectionText}\n`;
            
            if (userStatus.ip) {
                message += `🌐 *IP Address*: ${userStatus.ip}\n`;
            }
            
            if (userStatus.lastSeen) {
                message += `🕒 *Last Seen*: ${new Date(userStatus.lastSeen).toLocaleString('en-PK')}\n`;
            }
            
            if (userStatus.bandwidth) {
                message += `📈 *Bandwidth*: ${userStatus.bandwidth.download}↓ / ${userStatus.bandwidth.upload}↑\n`;
            }
            
            if (userStatus.customer) {
                message += `📱 *Customer*: ${userStatus.customer}\n`;
            }

            message += `\n💡 *Available commands:*\n`;
            message += `• *editpppoe ${username} [field] [value]* - Edit user\n`;
            message += `• *delpppoe ${username} [alasan]* - Delete user\n`;
            message += `• *restartpppoe ${username}* - Restart connection`;

            await this.sendMessage(remoteJid, message);
            
        } catch (error) {
            console.error('Error in handleCheckPPPoEStatus:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while checking PPPoE user status:\n${error.message}`
            );
        }
    }

    // Command: Restart PPPoE connection
    async handleRestartPPPoE(remoteJid, username) {
        try {
            if (!username) {
                await this.sendMessage(remoteJid, 
                    `❌ *WRONG FORMAT*\n\nCorrect format:\nrestartpppoe [username]\n\nExample:\nrestartpppoe john123`
                );
                return;
            }

            // Simulate PPPoE connection restart
            const success = await this.restartPPPoEConnection(username);
            
            if (success) {
                let message = `🔄 *PPPoE CONNECTION SUCCESSFULLY RESTARTED*\n\n`;
                message += `👤 *Username*: ${username}\n`;
                message += `🕒 *Restarted At*: ${new Date().toLocaleString('en-PK')}\n\n`;
                message += `💡 *Next Steps:*\n`;
                message += `1. Wait 30-60 seconds for connection to stabilize\n`;
                message += `2. Test internet connection\n`;
                message += `3. Verify speed according to profile\n`;
                message += `4. Update status in trouble report if any`;

                await this.sendMessage(remoteJid, message);
                
                // Log activity
                logger.info(`PPPoE connection ${username} successfully restarted by technician`);
                
            } else {
                await this.sendMessage(remoteJid, 
                    `❌ *PPPoE CONNECTION RESTART FAILED*\n\nAn error occurred while restarting connection.\nPlease try again or contact admin.`
                );
            }
            
        } catch (error) {
            console.error('Error in handleRestartPPPoE:', error);
            await this.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nAn error occurred while restarting PPPoE connection:\n${error.message}`
            );
        }
    }

    // Command: Help for PPPoE
    async handlePPPoEHelp(remoteJid) {
        const message = `🌐 *PPPoE COMMAND HELP*\n\n` +
            `📋 *Available commands:*\n\n` +
            `• *addpppoe [user] [pass] [profile] [ip] [info]* - Add new PPPoE user\n` +
            `• *editpppoe [user] [field] [value]* - Edit PPPoE user\n` +
            `• *delpppoe [user] [reason]* - Delete PPPoE user\n` +
            `• *pppoe [filter]* - View PPPoE user list\n` +
            `• *checkpppoe [user]* - Check PPPoE user status\n` +
            `• *restartpppoe [user]* - Restart PPPoE connection\n` +
            `• *help pppoe* - Show this help\n\n` +
            
            `📊 *Available profiles:*\n` +
            `• Basic - Basic package\n` +
            `• Standard - Standard package\n` +
            `• Premium - Premium package\n` +
            `• VIP - VIP package\n` +
            `• Enterprise - Enterprise package\n\n` +
            
            `🔧 *Editable fields:*\n` +
            `• password - Change password\n` +
            `• profile - Change profile\n` +
            `• ip - Change IP address\n` +
            `• status - Enable/disable user\n\n` +
            
            `💡 *Usage Examples:*\n` +
            `• addpppoe john123 password123 Premium 192.168.1.100 "John Doe - Jl. Example"\n` +
            `• editpppoe john123 password password456\n` +
            `• editpppoe john123 profile VIP\n` +
            `• delpppoe john123 Customer moved location\n` +
            `• checkpppoe john123\n` +
            `• restartpppoe john123\n\n` +
            
            `⚠️ *IMPORTANT:*\n` +
            `• Password must be at least 8 characters\n` +
            `• Always update trouble report after setup\n` +
            `• Test connection before finishing\n` +
            `• Record all changes for audit`;

        await this.sendMessage(remoteJid, message);
    }

    // Helper functions (will be integrated with MikroTik)
    async createPPPoEUser(username, password, profile, ipAddress, customerInfo) {
        try {
            // Simulate PPPoE user addition
            // This will be integrated with MikroTik API
            logger.info(`Creating PPPoE user: ${username}, profile: ${profile}`);
            
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return true;
        } catch (error) {
            logger.error(`Error creating PPPoE user: ${error.message}`);
            return false;
        }
    }

    async updatePPPoEUser(username, field, newValue) {
        try {
            // Simulate PPPoE user update
            logger.info(`Updating PPPoE user: ${username}, field: ${field}, value: ${newValue}`);
            
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return true;
        } catch (error) {
            logger.error(`Error updating PPPoE user: ${error.message}`);
            return false;
        }
    }

    async removePPPoEUser(username, reason) {
        try {
            // Simulasi penghapusan user PPPoE
            logger.info(`Removing PPPoE user: ${username}, reason: ${reason}`);
            
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return true;
        } catch (error) {
            logger.error(`Error removing PPPoE user: ${error.message}`);
            return false;
        }
    }

    async getPPPoEUsers(filter) {
        try {
            // Simulate getting PPPoE user list
            // This will be integrated with MikroTik API
            const mockUsers = [
                {
                    username: 'john123',
                    status: 'active',
                    profile: 'Premium',
                    ip: '192.168.1.100',
                    customer: 'John Doe',
                    createdAt: new Date('2024-12-01')
                },
                {
                    username: 'jane456',
                    status: 'active',
                    profile: 'Standard',
                    ip: '192.168.1.101',
                    customer: 'Jane Smith',
                    createdAt: new Date('2024-12-05')
                }
            ];

            if (filter) {
                return mockUsers.filter(user => 
                    user.username.includes(filter) || 
                    user.customer.includes(filter) ||
                    user.profile.includes(filter)
                );
            }

            return mockUsers;
        } catch (error) {
            logger.error(`Error getting PPPoE users: ${error.message}`);
            return [];
        }
    }

    async getPPPoEUserStatus(username) {
        try {
            // Simulasi cek status user PPPoE
            // Will be integrated with MikroTik API here
            const mockStatus = {
                username: username,
                status: 'active',
                profile: 'Premium',
                ip: '192.168.1.100',
                connected: true,
                lastSeen: new Date(),
                bandwidth: {
                    download: '50 Mbps',
                    upload: '25 Mbps'
                },
                customer: 'John Doe'
            };

            return mockStatus;
        } catch (error) {
            logger.error(`Error getting PPPoE user status: ${error.message}`);
            return null;
        }
    }

    async restartPPPoEConnection(username) {
        try {
            // Simulate PPPoE connection restart
            // This will be integrated with MikroTik API
            logger.info(`Restarting PPPoE connection: ${username}`);
            
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return true;
        } catch (error) {
            logger.error(`Error restarting PPPoE connection: ${error.message}`);
            return false;
        }
    }
}

module.exports = WhatsAppPPPoECommands;
