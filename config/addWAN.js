// Function to add WAN configuration on ONU devices
const axios = require('axios');
const logger = require('./logger');
const { getSetting } = require('./settingsManager');

// Function to add WAN configuration on ONU devices
async function handleAddWAN(remoteJid, params, sock) {
    try {
        // Extract parameters
        const [customerNumber, wanType, connMode] = params;
        
        // Validate WAN type and connection mode
        if (!['ppp', 'ip'].includes(wanType.toLowerCase())) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Invalid WAN type*\n\nWAN type must be 'ppp' or 'ip'`
            });
            return;
        }
        
        if (!['bridge', 'route'].includes(connMode.toLowerCase())) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Invalid connection mode*\n\nConnection mode must be 'bridge' or 'route'`
            });
            return;
        }
        
        // Get GenieACS URL
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Incomplete configuration*\n\nGenieACS URL not configured`
            });
            return;
        }
        
        // Find device by customer number tag
        const device = await findDeviceByTag(customerNumber);
        
        if (!device) {
            await sock.sendMessage(remoteJid, {
                text: `❌ *Device not found*\n\nCannot find device for number ${customerNumber}`
            });
            return;
        }
        
        // Send message that process is ongoing
        await sock.sendMessage(remoteJid, {
            text: `⏳ *WAN Configuration Process*\n\nConfiguring WAN for device ${device._id}...`
        });
        
        // Create task based on WAN type and connection mode
        const task = createWANTask(wanType.toLowerCase(), connMode.toLowerCase());
        
        // Send task to GenieACS
        try {
            const response = await axios.post(
                `${genieacsUrl}/devices/${device._id}/tasks?connection_request`,
                task,
                {
                    auth: { username: getSetting('genieacs_username', 'admin'), password: getSetting('genieacs_password', 'admin') }
                }
            );
            
            logger.info(`Task response: ${response.status}`);
            
            // Kirim pesan sukses
            let successMessage = `✅ *Konfigurasi WAN successful*\n\n`;
            successMessage += `📱 *Nomor Customer:* ${customerNumber}\n`;
            successMessage += `🔄 *Tipe WAN:* ${wanType.toUpperCase()}\n`;
            successMessage += `🔄 *Connection Mode:* ${connMode}\n\n`;
            successMessage += `Device akan segera menerapkan konfigurasi WAN baru.`;
            
            await sock.sendMessage(remoteJid, { text: successMessage });
            
        } catch (error) {
            logger.error('Error sending task to GenieACS:', error);
            
            let errorMessage = `❌ *Failed mengkonfigurasi WAN*\n\n`;
            if (error.response) {
                errorMessage += `Status: ${error.response.status}\n`;
                errorMessage += `Pesan: ${JSON.stringify(error.response.data)}\n`;
            } else {
                errorMessage += `Error: ${error.message}\n`;
            }
            
            await sock.sendMessage(remoteJid, { text: errorMessage });
        }
        
    } catch (error) {
        logger.error('Error in handleAddWAN:', error);
        
        await sock.sendMessage(remoteJid, {
            text: `❌ *Error*\n\nTerjadi kesalahan saat mengkonfigurasi WAN: ${error.message}`
        });
    }
}

// Fungsi untuk mencari perangkat berdasarkan tag nomor customer
async function findDeviceByTag(customerNumber) {
    try {
        console.log(`🔍 [FIND_DEVICE] Searching for device with tag: ${customerNumber}`);
        
        // Dapatkan URL GenieACS
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        if (!genieacsUrl) {
            logger.error('GenieACS URL not configured');
            return null;
        }
        
        console.log(`🌐 [FIND_DEVICE] GenieACS URL: ${genieacsUrl}`);
        
        // Method 1: Coba dengan query exact match (FASTEST)
        try {
            const queryObj = { "_tags": customerNumber };
            const queryJson = JSON.stringify(queryObj);
            const encodedQuery = encodeURIComponent(queryJson);
            
            console.log(`📋 [FIND_DEVICE] Trying exact tag match:`, queryObj);
            
            const response = await axios.get(`${genieacsUrl}/devices/?query=${encodedQuery}`, {
                auth: { 
                    username: getSetting('genieacs_username', 'admin'), 
                    password: getSetting('genieacs_password', 'admin') 
                },
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 5000 // 5 second timeout untuk exact match
            });
            
            if (response.data && response.data.length > 0) {
                console.log(`✅ [FIND_DEVICE] Device found with exact tag match:`, response.data[0]._id);
                return response.data[0];
            }
        } catch (exactError) {
            console.log(`⚠️ [FIND_DEVICE] Exact tag search failed:`, exactError.message);
        }
        
        // Method 2: Coba dengan query partial match (MEDIUM SPEED)
        try {
            const partialQueryObj = { "_tags": { "$regex": customerNumber, "$options": "i" } };
            const partialQueryJson = JSON.stringify(partialQueryObj);
            const partialEncodedQuery = encodeURIComponent(partialQueryJson);
            
            console.log(`🔍 [FIND_DEVICE] Trying partial match query:`, partialQueryObj);
            
            const partialResponse = await axios.get(`${genieacsUrl}/devices/?query=${partialEncodedQuery}`, {
                auth: { 
                    username: getSetting('genieacs_username', 'admin'), 
                    password: getSetting('genieacs_password', 'admin') 
                },
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 8000 // 8 second timeout untuk partial match
            });
            
            if (partialResponse.data && partialResponse.data.length > 0) {
                console.log(`✅ [FIND_DEVICE] Device found with partial tag match:`, partialResponse.data[0]._id);
                return partialResponse.data[0];
            }
        } catch (partialError) {
            console.log(`⚠️ [FIND_DEVICE] Partial tag search failed:`, partialError.message);
        }
        
        // Method 3: Manual search hanya jika jumlah device < 100 (SLOWEST)
        try {
            console.log(`🔍 [FIND_DEVICE] Trying manual search through all devices...`);
            
            const allDevicesResponse = await axios.get(`${genieacsUrl}/devices`, {
                auth: { 
                    username: getSetting('genieacs_username', 'admin'), 
                    password: getSetting('genieacs_password', 'admin') 
                },
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000 // 10 second timeout untuk manual search
            });
            
            if (allDevicesResponse.data && allDevicesResponse.data.length > 0) {
                const totalDevices = allDevicesResponse.data.length;
                console.log(`📊 [FIND_DEVICE] Total devices in GenieACS: ${totalDevices}`);
                
                // Skip manual search jika terlalu banyak devices (performance issue)
                if (totalDevices > 200) {
                    console.log(`⚠️ [FIND_DEVICE] Too many devices (${totalDevices}), skipping manual search for performance`);
                    return null;
                }
                
                // Search device dengan tag yang cocok
                for (const device of allDevicesResponse.data) {
                    const deviceTags = device._tags || device.Tags || [];
                    
                    // Normalize tags array
                    const normalizedTags = Array.isArray(deviceTags) ? deviceTags : [deviceTags];
                    
                    for (const tag of normalizedTags) {
                        if (tag && typeof tag === 'string') {
                            // Exact match
                            if (tag === customerNumber) {
                                console.log(`✅ [FIND_DEVICE] Device found with exact tag match: ${device._id}`);
                                return device;
                            }
                            
                            // Partial match (tag contains customer number or vice versa)
                            if (tag.includes(customerNumber) || customerNumber.includes(tag)) {
                                console.log(`✅ [FIND_DEVICE] Device found with partial tag match: ${device._id} (tag: ${tag})`);
                                return device;
                            }
                            
                            // Remove common prefixes/suffixes and try again
                            const cleanTag = tag.replace(/^\+62|^62|^0/, '');
                            const cleanCustomer = customerNumber.replace(/^\+62|^62|^0/, '');
                            
                            if (cleanTag === cleanCustomer || cleanTag.includes(cleanCustomer) || cleanCustomer.includes(cleanTag)) {
                                console.log(`✅ [FIND_DEVICE] Device found with cleaned tag match: ${device._id} (original: ${tag}, cleaned: ${cleanTag})`);
                                return device;
                            }
                        }
                    }
                }
            }
        } catch (manualError) {
            console.log(`⚠️ [FIND_DEVICE] Manual search failed:`, manualError.message);
        }
        
        console.log(`❌ [FIND_DEVICE] No device found with tag: ${customerNumber}`);
        return null;
        
    } catch (error) {
        logger.error(`Error finding device by tag: ${error.message}`);
        console.error(`❌ [FIND_DEVICE] Fatal error:`, error);
        return null;
    }
}

// Function to create WAN task based on type and mode
function createWANTask(wanType, connMode) {
    // Parameter WAN yang akan diatur
    let connectionType = '';
    let serviceList = '';
    let task = {
        name: "setParameterValues",
        parameterValues: []
    };
    
    // Tentukan parameter berdasarkan tipe dan mode
    if (wanType === 'ppp') {
        if (connMode === 'bridge') {
            connectionType = 'PPPoE_Bridged';
            serviceList = 'INTERNET';
            
            // Parameter untuk PPPoE Bridge
            task.parameterValues = [
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", false, "xsd:boolean"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType", connectionType, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_ServiceList", serviceList, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", true, "xsd:boolean"]
            ];
            
        } else { // route
            connectionType = 'PPPoE_Routed';
            serviceList = 'TR069,INTERNET';
            
            // Parameter untuk PPPoE Route
            task.parameterValues = [
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", false, "xsd:boolean"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionType", connectionType, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_ServiceList", serviceList, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_VLAN", 0, "xsd:unsignedInt"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_HW_LANBIND", "LAN1,LAN2,LAN3,LAN4,SSID1,SSID2,SSID3,SSID4", "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Enable", true, "xsd:boolean"]
            ];
        }
    } else { // ip
        if (connMode === 'bridge') {
            connectionType = 'IP_Bridged';
            serviceList = 'INTERNET';
            
            // Parameter untuk IP Bridge
            task.parameterValues = [
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", false, "xsd:boolean"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionType", connectionType, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_ServiceList", serviceList, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", true, "xsd:boolean"]
            ];
            
        } else { // route
            connectionType = 'IP_Routed';
            serviceList = 'INTERNET';
            
            // Parameter untuk IP Route
            task.parameterValues = [
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", false, "xsd:boolean"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ConnectionType", connectionType, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_ServiceList", serviceList, "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_VLAN", 0, "xsd:unsignedInt"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_HW_LANBIND", "LAN1,LAN2,LAN3,LAN4,SSID1,SSID2,SSID3,SSID4", "xsd:string"],
                ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.Enable", true, "xsd:boolean"]
            ];
        }
    }
    
    return task;
}

module.exports = {
    handleAddWAN,
    findDeviceByTag
};
