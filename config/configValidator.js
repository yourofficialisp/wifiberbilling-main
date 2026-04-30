const axios = require('axios');
const { getSetting } = require('./settingsManager');
const logger = require('./logger');

/**
 * Validator for GenieACS and Mikrotik configuration
 * Detects IP settings that are incorrect or dummy
 */
class ConfigValidator {
    constructor() {
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [] },
            mikrotik: { isValid: false, errors: [], warnings: [] },
            overall: { isValid: false, needsAttention: false }
        };
    }

    /**
     * Validate IP address format
     */
    isValidIPAddress(ip) {
        // Regex for IPv4 validation
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        
        // Check IP format
        if (!ipv4Regex.test(ip)) {
            return false;
        }

        // Check invalid/dummy IPs
        const dummyIPs = [
            '0.0.0.0',           // Invalid
            '127.0.0.1',         // Localhost (possibly dummy)
            '192.168.1.1',       // Common router default
            '192.168.0.1',       // Common router default
            '10.0.0.1',          // Common router default
            '172.16.0.1',        // Common router default
            'localhost',         // Localhost hostname
            'example.com',       // Dummy domain
            'test.com',          // Dummy domain
            'dummy',             // Dummy word
            'admin',             // Admin word
            'test'               // Test word
        ];

        return !dummyIPs.includes(ip.toLowerCase());
    }

    /**
     * Validate port number
     */
    isValidPort(port) {
        const portNum = parseInt(port);
        return portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validate URL format
     */
    isValidURL(url) {
        try {
            const urlObj = new URL(url);
            return this.isValidIPAddress(urlObj.hostname) || urlObj.hostname.includes('.');
        } catch (e) {
            return false;
        }
    }

    /**
     * Test connection to GenieACS
     */
    async testGenieACSConnection() {
        const genieacsUrl = getSetting('genieacs_url', 'http://localhost:7557');
        const genieacsUsername = getSetting('genieacs_username', 'acs');
        const genieacsPassword = getSetting('genieacs_password', '');

        try {

            // Validate URL format
            if (!this.isValidURL(genieacsUrl)) {
                return {
                    success: false,
                    error: 'Invalid GenieACS URL format',
                    details: `URL: ${genieacsUrl}`
                };
            }

            // Validate credentials
            if (!genieacsUsername || !genieacsPassword) {
                return {
                    success: false,
                    error: 'GenieACS username or password not configured',
                    details: `Username: ${genieacsUsername ? "Exists" : "Empty"}, Password: ${genieacsPassword ? "Exists" : "Empty"}`
                };
            }

            // Test connection with very short timeout for login
            const response = await axios.get(`${genieacsUrl}/devices`, {
                auth: {
                    username: genieacsUsername,
                    password: genieacsPassword
                },
                timeout: 3000, // 3 seconds timeout for quick login
                headers: {
                    'Accept': 'application/json'
                }
            });

            return {
                success: true,
                message: 'Connection to GenieACS successful',
                details: `Status: ${response.status}, Data devices: ${response.data ? response.data.length || 0 : 0}`
            };

        } catch (error) {
            let errorMessage = 'Failed to connect to GenieACS';
            let errorDetails = error.message;

            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'GenieACS cannot be reached';
                errorDetails = `Server not responding at ${genieacsUrl}. Make sure GenieACS is running and accessible.`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'GenieACS host not found';
                errorDetails = `IP address ${genieacsUrl} cannot be reached. Check network connection.`;
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'GenieACS timeout';
                errorDetails = `Connection to ${genieacsUrl} timed out. Server may be slow or inactive.`;
            } else if (error.response) {
                if (error.response.status === 401) {
                    errorMessage = 'GenieACS authentication failed';
                    errorDetails = 'Username or password incorrect';
                } else if (error.response.status === 404) {
                    errorMessage = 'GenieACS endpoint not found';
                    errorDetails = 'URL may be incorrect or server does not support API';
                }
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails
            };
        }
    }

    /**
     * Test connection to Mikrotik
     */
    async testMikrotikConnection() {
        const mikrotikHost = getSetting('mikrotik_host', '192.168.1.1');
        const mikrotikPort = getSetting('mikrotik_port', '8728');
        const mikrotikUser = getSetting('mikrotik_user', 'admin');
        const mikrotikPassword = getSetting('mikrotik_password', '');

        try {
            const { getMikrotikConnection } = require('./mikrotik');
            const { listMikrotikRouters } = require('./mikrotik');

            const routerInfo = typeof listMikrotikRouters === 'function' ? listMikrotikRouters() : { routers: [], defaultRouterId: null };
            const routers = Array.isArray(routerInfo.routers) ? routerInfo.routers : [];

            if (routers.length > 0) {
                const invalidRouters = [];
                for (const r of routers) {
                    const label = `${r.name || r.id} (${r.id})`;
                    if (!r.host || !this.isValidIPAddress(r.host)) {
                        invalidRouters.push({ id: r.id, label, reason: `Invalid host: ${r.host || '(empty)'}` });
                        continue;
                    }
                    if (!this.isValidPort(r.port)) {
                        invalidRouters.push({ id: r.id, label, reason: `Invalid port: ${r.port || '(empty)'}` });
                        continue;
                    }
                    if (!r.user || !r.password) {
                        invalidRouters.push({ id: r.id, label, reason: 'Username or password not configured' });
                        continue;
                    }
                }

                const routerIdToTest = routerInfo.defaultRouterId || (routers[0] ? routers[0].id : null);
                const routerToTest = routers.find(r => r.id === routerIdToTest) || null;

                if (!routerIdToTest || !routerToTest) {
                    return {
                        success: false,
                        error: 'Invalid Mikrotik multi-router configuration',
                        details: 'No default router available for connection test'
                    };
                }

                const routerLabel = `${routerToTest.name || routerToTest.id} (${routerToTest.id})`;
                const routerInvalid = invalidRouters.find(r => r.id === routerToTest.id);
                if (routerInvalid) {
                    return {
                        success: false,
                        error: 'Invalid default Mikrotik router configuration',
                        details: `${routerLabel}: ${routerInvalid.reason}`
                    };
                }

                const connection = await Promise.race([
                    getMikrotikConnection({ routerId: routerIdToTest }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Connection timeout')), 10000)
                    )
                ]);

                if (connection) {
                    const invalidSummary = invalidRouters.length
                        ? `; Problematic routers: ${invalidRouters.map(r => r.label).join(', ')}`
                        : '';
                    return {
                        success: true,
                        message: 'Connection to Mikrotik successful',
                        details: `Router: ${routerLabel}${invalidSummary}`
                    };
                }

                return {
                    success: false,
                    error: 'Connection to Mikrotik failed',
                    details: `Cannot connect to default router: ${routerLabel}`
                };
            }
            
            if (!this.isValidIPAddress(mikrotikHost)) {
                return {
                    success: false,
                    error: 'Invalid Mikrotik IP address',
                    details: `IP: ${mikrotikHost}`
                };
            }

            if (!this.isValidPort(mikrotikPort)) {
                return {
                    success: false,
                    error: 'Invalid Mikrotik port',
                    details: `Port: ${mikrotikPort}`
                };
            }

            if (!mikrotikUser || !mikrotikPassword) {
                return {
                    success: false,
                    error: 'Mikrotik username or password not configured',
                    details: `Username: ${mikrotikUser ? "Exists" : "Empty"}, Password: ${mikrotikPassword ? "Exists" : "Empty"}`
                };
            }

            // Try connection with 10 second timeout for login (more stable on server)
            const connection = await Promise.race([
                getMikrotikConnection(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 10000)
                )
            ]);

            if (connection) {
                return {
                    success: true,
                    message: 'Connection to Mikrotik successful',
                    details: `Host: ${mikrotikHost}:${mikrotikPort}, User: ${mikrotikUser}`
                };
            } else {
                return {
                    success: false,
                    error: 'Connection to Mikrotik failed',
                    details: 'Cannot connect to Mikrotik router'
                };
            }

        } catch (error) {
            let errorMessage = 'Failed to connect to Mikrotik';
            let errorDetails = error.message;

            if (error.message.includes('timeout')) {
                errorMessage = 'Mikrotik not responding';
                errorDetails = `Timeout (10s) - Router may be busy or unreachable at ${mikrotikHost}:${mikrotikPort}`;
            } else if (error.message.includes('ECONNREFUSED')) {
                errorMessage = 'Connection to Mikrotik rejected';
                errorDetails = `Port ${mikrotikPort} rejected by router. Make sure API service is active in Mikrotik.`;
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Mikrotik host not found';
                errorDetails = `IP address ${mikrotikHost} cannot be reached. Check network connection.`;
            } else {
                // Display original error from library (e.g: "invalid username or password")
                errorMessage = 'Authentication Failed / API Error';
                errorDetails = error.message;
            }

            return {
                success: false,
                error: errorMessage,
                details: errorDetails
            };
        }
    }

    /**
     * Validate all configurations completely
     */
    async validateAllConfigurations() {
        console.log('🔍 [CONFIG_VALIDATOR] Starting configuration validation...');
        
        // Reset validation results
        this.validationResults = {
            genieacs: { isValid: false, errors: [], warnings: [] },
            mikrotik: { isValid: false, errors: [], warnings: [] },
            overall: { isValid: false, needsAttention: false }
        };

        // Validasi GenieACS
        console.log('🔍 [CONFIG_VALIDATOR] Validating GenieACS configuration...');
        const genieacsResult = await this.testGenieACSConnection();
        
        if (genieacsResult.success) {
            this.validationResults.genieacs.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] GenieACS: Konfigurasi valid');
        } else {
            this.validationResults.genieacs.errors.push(genieacsResult.error);
            console.log(`❌ [CONFIG_VALIDATOR] GenieACS: ${genieacsResult.error}`);
        }

        // Validasi Mikrotik
        console.log('🔍 [CONFIG_VALIDATOR] Validating Mikrotik configuration...');
        const mikrotikResult = await this.testMikrotikConnection();
        
        if (mikrotikResult.success) {
            this.validationResults.mikrotik.isValid = true;
            console.log('✅ [CONFIG_VALIDATOR] Mikrotik: Konfigurasi valid');
        } else {
            this.validationResults.mikrotik.errors.push(mikrotikResult.error);
            console.log(`❌ [CONFIG_VALIDATOR] Mikrotik: ${mikrotikResult.error}`);
        }

        // Evaluasi hasil keseluruhan
        this.validationResults.overall.isValid = 
            this.validationResults.genieacs.isValid && this.validationResults.mikrotik.isValid;
        
        this.validationResults.overall.needsAttention = 
            this.validationResults.genieacs.errors.length > 0 || this.validationResults.mikrotik.errors.length > 0;

        console.log(`🔍 [CONFIG_VALIDATOR] Validasi selesai. Status: ${this.validationResults.overall.isValid ? 'VALID' : 'PERLU PERHATIAN'}`);
        
        return this.validationResults;
    }

    /**
     * Dapatkan ringkasan validasi untuk ditampilkan ke admin
     */
    getValidationSummary() {
        const summary = {
            status: this.validationResults.overall.isValid ? 'valid' : 'warning',
            message: '',
            details: {
                genieacs: {
                    status: this.validationResults.genieacs.isValid ? 'valid' : 'error',
                    message: this.validationResults.genieacs.isValid ? 'Konfigurasi GenieACS valid' : 'Konfigurasi GenieACS bermasalah',
                    errors: this.validationResults.genieacs.errors
                },
                mikrotik: {
                    status: this.validationResults.mikrotik.isValid ? 'valid' : 'error', 
                    message: this.validationResults.mikrotik.isValid ? 'Konfigurasi Mikrotik valid' : 'Konfigurasi Mikrotik bermasalah',
                    errors: this.validationResults.mikrotik.errors
                }
            }
        };

        if (this.validationResults.overall.isValid) {
            summary.message = 'Semua konfigurasi sistem valid dan siap digunakan';
        } else {
            const errorCount = this.validationResults.genieacs.errors.length + this.validationResults.mikrotik.errors.length;
            summary.message = `Ditemukan ${errorCount} masalah konfigurasi yang perlu diperbaiki`;
        }

        return summary;
    }

    /**
     * Check if current configuration is using default/dummy settings
     */
    checkForDefaultSettings() {
        const warnings = [];
        
        // Cek GenieACS
        const genieacsUrl = getSetting('genieacs_url', '');
        const genieacsUser = getSetting('genieacs_username', '');
        const genieacsPass = getSetting('genieacs_password', '');
        
        if (genieacsUrl.includes('localhost') || genieacsUrl.includes('127.0.0.1')) {
            warnings.push('GenieACS is using localhost address - make sure this matches your setup');
        }
        
        if (genieacsUser === 'admin' || genieacsUser === 'acs' || genieacsUser === '') {
            warnings.push('GenieACS is using default username - consider changing it');
        }
        
        if (genieacsPass === 'admin' || genieacsPass === 'password' || genieacsPass === '') {
            warnings.push('GenieACS is using default password - change it immediately for security');
        }

        // Cek Mikrotik
        const mikrotikHost = getSetting('mikrotik_host', '');
        const mikrotikUser = getSetting('mikrotik_user', '');
        const mikrotikPass = getSetting('mikrotik_password', '');
        
        if (mikrotikHost === '192.168.1.1' || mikrotikHost === '192.168.0.1' || mikrotikHost === '') {
            warnings.push('Mikrotik is using default IP - make sure it matches your router setup');
        }
        
        if (mikrotikUser === 'admin' || mikrotikUser === '') {
            warnings.push('Mikrotik is using default username - consider changing it');
        }
        
        if (mikrotikPass === 'admin' || mikrotikPass === 'password' || mikrotikPass === '') {
            warnings.push('Mikrotik is using default password - change it immediately for security');
        }

        return warnings;
    }
}

// Export instance singleton
const configValidator = new ConfigValidator();

module.exports = {
    ConfigValidator,
    configValidator,
    validateConfiguration: () => configValidator.validateAllConfigurations(),
    getValidationSummary: () => configValidator.getValidationSummary(),
    checkForDefaultSettings: () => configValidator.checkForDefaultSettings()
};
