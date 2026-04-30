// Module for adding customer number to GenieACS tag
const axios = require('axios');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');

let sock = null;

// Function to set sock instance
function setSock(sockInstance) {
    sock = sockInstance;
}

// Function to add customer tag to GenieACS device
async function addCustomerTag(remoteJid, params) {
    try {
        // Ekstrak parameter
        if (params.length < 2) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Format Salah*\n\nFormat yang benar:\naddtag [device_id] [nomor_customer]\n\nExample:\naddtag 202BC1-BM632w-000000 081234567890`
            });
            return;
        }

        const [deviceId, customerNumber] = params;
        
        // Validate customer number
        if (!customerNumber || !/^\d{8,}$/.test(customerNumber)) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Nomor Customer Tidak Valid*\n\nNomor customer harus berupa angka at least 8 digit.`
            });
            return;
        }
        
        // Get GenieACS URL
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Konfigurasi tidak lengkap*\n\nURL GenieACS tidak dikonfigurasi`
            });
            return;
        }
        
        // Send message that process is ongoing
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Tag addition process*\n\nAdding number ${customerNumber} to device ${deviceId}...`
        });
        
        // Prepare URL to add tag
        const tagUrl = `${genieacsUrl}/devices/${deviceId}/tags/${customerNumber}`;
        
        // Send request to GenieACS to add tag
        try {
            const response = await axios.post(
                tagUrl,
                {},
                {
                    auth: {
                        username: getSetting('genieacs_username', 'admin'),
                        password: getSetting('genieacs_password', 'admin')
                    }
                }
            );
            
            logger.info(`Tag response: ${response.status}`);
            
            // Send success message
            let successMessage = `✅ *Tag added successfully*\n\n`;
            successMessage += `📱 *Nomor Customer:* ${customerNumber}\n`;
            successMessage += `🖥️ *Device ID:* ${deviceId}\n\n`;
            successMessage += `Customer can now use WhatsApp and Web Portal with that number.`;
            
            await sock.sendMessage(remoteJid, { text: successMessage });
            
        } catch (error) {
            logger.error('Error adding tag to GenieACS:', error);
            
            let errorMessage = `❌ *Failed to add tag*\n\n`;
            if (error.response) {
                errorMessage += `Status: ${error.response.status}\n`;
                errorMessage += `Message: ${JSON.stringify(error.response.data)}\n`;
            } else {
                errorMessage += `Error: ${error.message}\n`;
            }
            
            await sock.sendMessage(remoteJid, { text: errorMessage });
        }
        
    } catch (error) {
        logger.error('Error in addCustomerTag:', error);
        
        await sock.sendMessage(remoteJid, {
            text: `❌ *Error*\n\nError occurred while adding tag: ${error.message}`
        });
    }
}

// Function to search device by ID
async function findDeviceById(deviceId) {
    try {
        // Get GenieACS URL
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            logger.error('GenieACS URL not configured');
            return null;
        }
        
        // Create query to search device by ID
        const queryObj = { "_id": deviceId };
        const queryJson = JSON.stringify(queryObj);
        const encodedQuery = encodeURIComponent(queryJson);
        
        // Get device from GenieACS
        const response = await axios.get(`${genieacsUrl}/devices/?query=${encodedQuery}`, {
            auth: {
                username: getSetting('genieacs_username', 'admin'),
                password: getSetting('genieacs_password', 'admin')
            },
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (response.data && response.data.length > 0) {
            return response.data[0];
        }
        
        return null;
    } catch (error) {
        logger.error(`Error finding device by ID: ${error.message}`);
        return null;
    }
}

// Function to add tag based on PPPoE Username
async function addTagByPPPoE(remoteJid, params, sock) {
    try {
        // Ekstrak parameter
        if (params.length < 2) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Format Salah*\n\nFormat yang benar:\naddpppoe_tag [pppoe_username] [nomor_customer]\n\nExample:\naddpppoe_tag user123 081234567890`
            });
            return;
        }

        const [pppoeUsername, customerNumber] = params;
        
        // Validate customer number
        if (!customerNumber || !/^\d{8,}$/.test(customerNumber)) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Nomor Customer Tidak Valid*\n\nNomor customer harus berupa angka at least 8 digit.`
            });
            return;
        }
        
        // Get GenieACS URL
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Konfigurasi tidak lengkap*\n\nURL GenieACS tidak dikonfigurasi`
            });
            return;
        }
        
        // Send message that process is ongoing
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Proses pencarian perangkat*\n\nMedium mencari perangkat dengan PPPoE Username ${pppoeUsername}...`
        });
        
        // Search device based on PPPoE Username
        const device = await findDeviceByPPPoE(pppoeUsername);
        
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Device Tidak Ditemukan*\n\nTidak dapat menemukan perangkat dengan PPPoE Username ${pppoeUsername}`
            });
            return;
        }
        
        // Get device ID
        const deviceId = device._id;
        
        // Send message that process is ongoing
        await sock.sendMessage(remoteJid, {
            text: `⏳ *Tag addition process*\n\nAdding number ${customerNumber} to device ${deviceId}...`
        });
        
        // Prepare URL to add tag
        const tagUrl = `${genieacsUrl}/devices/${deviceId}/tags/${customerNumber}`;
        
        // Send request to GenieACS to add tag
        try {
            const response = await axios.post(
                tagUrl,
                {},
                {
                    auth: {
                        username: getSetting('genieacs_username', 'admin'),
                        password: getSetting('genieacs_password', 'admin')
                    }
                }
            );
            
            logger.info(`Tag response: ${response.status}`);
            
            // Send success message
            let successMessage = `✅ *Tag added successfully*\n\n`;
            successMessage += `📱 *Nomor Customer:* ${customerNumber}\n`;
            successMessage += `👤 *PPPoE Username:* ${pppoeUsername}\n`;
            successMessage += `🖥️ *Device ID:* ${deviceId}\n\n`;
            successMessage += `Customer can now use WhatsApp and Web Portal with that number.`;
            
            await sock.sendMessage(remoteJid, { text: successMessage });
            
        } catch (error) {
            logger.error('Error adding tag to GenieACS:', error);
            
            let errorMessage = `❌ *Failed to add tag*\n\n`;
            if (error.response) {
                errorMessage += `Status: ${error.response.status}\n`;
                errorMessage += `Message: ${JSON.stringify(error.response.data)}\n`;
            } else {
                errorMessage += `Error: ${error.message}\n`;
            }
            
            await sock.sendMessage(remoteJid, { text: errorMessage });
        }
        
    } catch (error) {
        logger.error('Error in addTagByPPPoE:', error);
        
        await sock.sendMessage(remoteJid, {
            text: `❌ *Error*\n\nError occurred while adding tag: ${error.message}`
        });
    }
}

// Function to search device based on PPPoE Username
async function findDeviceByPPPoE(pppoeUsername) {
    try {
        // Get GenieACS URL
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            logger.error('GenieACS URL not configured');
            return null;
        }
        
        // Parameter paths for PPPoE Username
        const pppUsernamePaths = [
            'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
            'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username._value',
            'VirtualParameters.pppoeUsername',
            'VirtualParameters.pppUsername'
        ];
        
        // Create query to search device based on PPPoE Username
        // We need to create query that searches in all possible paths
        const queryObj = { $or: [] };
        
        // Add all possible paths to query
        for (const path of pppUsernamePaths) {
            const pathQuery = {};
            pathQuery[path] = pppoeUsername;
            queryObj.$or.push(pathQuery);
        }
        
        const queryJson = JSON.stringify(queryObj);
        const encodedQuery = encodeURIComponent(queryJson);
        
        // Get device from GenieACS
        const response = await axios.get(`${genieacsUrl}/devices/?query=${encodedQuery}`, {
            auth: {
                username: getSetting('genieacs_username', 'admin'),
                password: getSetting('genieacs_password', 'admin')
            },
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (response.data && response.data.length > 0) {
            return response.data[0];
        }
        
        return null;
    } catch (error) {
        logger.error(`Error finding device by PPPoE Username: ${error.message}`);
        return null;
    }
}

module.exports = {
    setSock,
    addCustomerTag,
    findDeviceById,
    addTagByPPPoE
};
