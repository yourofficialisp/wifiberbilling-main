#!/usr/bin/env node

/**
 * Script untuk auto-konfigurasi DNS GenieACS di server development
 * Auto detect server IP and configure DNS when application is first run
 */

const os = require('os');
const { getSetting } = require('../config/settingsManager');
const genieacs = require('../config/genieacs');
const { GenieACSDNSConfig } = require('./genieacs-dns-config');
const logger = require('../config/logger');

class AutoGenieACSDNSDev {
    constructor() {
        this.dnsConfig = new GenieACSDNSConfig();
        this.serverIP = null;
        this.genieacsPort = 7547;
    }

    // Fungsi untuk mendeteksi IP server otomatis
    detectServerIP() {
        try {
            console.log('🔍 Mendeteksi IP server...');
            
            const networkInterfaces = os.networkInterfaces();
            const possibleIPs = [];

            // Search IP yang sesuai untuk development
            for (const [interfaceName, interfaces] of Object.entries(networkInterfaces)) {
                for (const iface of interfaces) {
                    // Skip loopback dan IPv6
                    if (iface.family === 'IPv4' && !iface.internal) {
                        const ip = iface.address;
                        
                        // Priority IP untuk development
                        if (ip.startsWith('192.168.') || 
                            ip.startsWith('10.') || 
                            ip.startsWith('172.')) {
                            possibleIPs.push({
                                ip: ip,
                                interface: interfaceName,
                                priority: this.getIPPriority(ip)
                            });
                        }
                    }
                }
            }

            // Urutkan berdasarkan prioritas
            possibleIPs.sort((a, b) => b.priority - a.priority);

            if (possibleIPs.length > 0) {
                this.serverIP = possibleIPs[0].ip;
                console.log(`✅ IP server terdeteksi: ${this.serverIP} (interface: ${possibleIPs[0].interface})`);
                
                // Show all found IPs
                console.log('📋 Semua IP yang ditemukan:');
                possibleIPs.forEach((item, index) => {
                    console.log(`   ${index + 1}. ${item.ip} (${item.interface}) - Priority: ${item.priority}`);
                });
                
                return this.serverIP;
            } else {
                throw new Error('No suitable IP network found');
            }

        } catch (error) {
            console.error('❌ Error mendeteksi IP server:', error.message);
            return null;
        }
    }

    // Fungsi untuk menentukan prioritas IP
    getIPPriority(ip) {
        // Priority berdasarkan range IP
        if (ip.startsWith('192.168.8.')) return 100; // IP yang paling umum untuk development
        if (ip.startsWith('192.168.10.')) return 90;  // IP PPPoE range
        if (ip.startsWith('192.168.1.')) return 80;   // IP router umum
        if (ip.startsWith('192.168.')) return 70;     // IP private lainnya
        if (ip.startsWith('10.')) return 60;          // IP class A private
        if (ip.startsWith('172.')) return 50;         // IP class B private
        return 10; // IP lainnya
    }

    // Fungsi untuk update konfigurasi GenieACS dengan IP yang terdeteksi
    updateGenieACSConfig() {
        try {
            console.log('🔧 Mengupdate konfigurasi GenieACS...');
            
            // Update GenieACS URL dengan IP yang terdeteksi
            const newGenieacsUrl = `http://${this.serverIP}:${this.genieacsPort}`;
            
            // Update DNS server di dnsConfig
            this.dnsConfig.dnsServer = this.serverIP;
            this.dnsConfig.genieacsUrl = newGenieacsUrl;
            
            console.log(`✅ Konfigurasi GenieACS diupdate:`);
            console.log(`   URL: ${newGenieacsUrl}`);
            console.log(`   DNS Server: ${this.serverIP}`);
            
            return {
                success: true,
                genieacsUrl: newGenieacsUrl,
                dnsServer: this.serverIP
            };

        } catch (error) {
            console.error('❌ Error mengupdate konfigurasi GenieACS:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Fungsi untuk generate script Mikrotik dengan IP yang terdeteksi
    generateMikrotikScript() {
        try {
            console.log('📝 Generate script Mikrotik dengan IP terdeteksi...');
            
            const script = `# Mikrotik Script to Configure GenieACS DNS Server (Auto-Generated)
# IP Server GenieACS: ${this.serverIP}:${this.genieacsPort}
# IP PPPoE: 192.168.10.0/24
# DNS Server: ${this.serverIP} (GenieACS server)
# Generated on: ${new Date().toLocaleString('en-PK')}

# ===========================================
# 1. SETUP DNS SERVER UNTUK PPPoE USERS
# ===========================================

# Delete DNS server lama (jika ada)
/ip dns static remove [find where name="genieacs.local" and address="${this.serverIP}"]

# Addkan DNS static untuk GenieACS server
/ip dns static add name="genieacs.local" address="${this.serverIP}" ttl=300
/ip dns static add name="acs.local" address="${this.serverIP}" ttl=300
/ip dns static add name="tr069.local" address="${this.serverIP}" ttl=300

# ===========================================
# 2. SETUP DHCP SERVER UNTUK PPPoE USERS
# ===========================================

# Delete DHCP server lama untuk PPPoE (jika ada)
/ip dhcp-server remove [find where interface="pppoe-out1" and address-pool="pppoe-pool"]

# Create address pool for PPPoE users
/ip pool remove [find where name="pppoe-pool"]
/ip pool add name="pppoe-pool" ranges=192.168.10.2-192.168.10.254

# Create DHCP server for PPPoE users
/ip dhcp-server add interface=pppoe-out1 address-pool=pppoe-pool name="pppoe-dhcp" \\
    lease-time=1h authoritative=after-2sec-delay use-radius=no

# ===========================================
# 3. SETUP DNS SERVER UNTUK DHCP CLIENTS
# ===========================================

# Delete DHCP network lama (jika ada)
/ip dhcp-server network remove [find where address="192.168.10.0/24"]

# Addkan DHCP network dengan DNS server GenieACS
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 \\
    dns-server=${this.serverIP},8.8.8.8,8.8.4.4 domain=local

# ===========================================
# 4. SETUP NAT RULES UNTUK TR069 TRAFFIC
# ===========================================

# Delete NAT rules lama untuk TR069 (jika ada)
/ip firewall nat remove [find where comment~"tr069"]

# Allow TR069 traffic dari PPPoE users ke GenieACS server
/ip firewall nat add chain=srcnat src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=${this.genieacsPort} protocol=tcp \\
    action=masquerade comment="tr069-genieacs"

# Allow TR069 traffic dari PPPoE users ke GenieACS server (HTTPS)
/ip firewall nat add chain=srcnat src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=7548 protocol=tcp \\
    action=masquerade comment="tr069-genieacs-https"

# ===========================================
# 5. SETUP FIREWALL RULES UNTUK TR069
# ===========================================

# Delete firewall rules lama untuk TR069 (jika ada)
/ip firewall filter remove [find where comment~"tr069"]

# Allow TR069 traffic dari PPPoE users ke GenieACS server
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=${this.genieacsPort} protocol=tcp \\
    action=accept comment="tr069-allow-http"

# Allow TR069 traffic dari PPPoE users ke GenieACS server (HTTPS)
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=7548 protocol=tcp \\
    action=accept comment="tr069-allow-https"

# Allow DNS queries dari PPPoE users ke GenieACS server
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=53 protocol=udp \\
    action=accept comment="tr069-allow-dns"

# Allow DNS queries dari PPPoE users ke GenieACS server (TCP)
/ip firewall filter add chain=forward src-address=192.168.10.0/24 \\
    dst-address=${this.serverIP} dst-port=53 protocol=tcp \\
    action=accept comment="tr069-allow-dns-tcp"

# ===========================================
# 6. SETUP PPPoE PROFILE UNTUK DNS
# ===========================================

# Delete PPPoE profile lama (jika ada)
/ppp profile remove [find where name="genieacs-dns"]

# Create PPPoE profile with GenieACS DNS server
/ppp profile add name="genieacs-dns" local-address=192.168.10.1 \\
    remote-address=pppoe-pool dns-server=${this.serverIP},8.8.8.8,8.8.4.4 \\
    use-encryption=no use-compression=no use-vj-compression=no \\
    only-one=yes change-tcp-mss=yes use-ipv6=no \\
    comment="Profileeeeeeeeee dengan DNS server GenieACS (Auto-Generated)"

# ===========================================
# 7. SETUP ADDRESS LIST UNTUK TR069 USERS
# ===========================================

# Delete address list lama (jika ada)
/ip firewall address-list remove [find where list="tr069-users"]

# Addkan IP range PPPoE ke address list
/ip firewall address-list add address=192.168.10.0/24 list="tr069-users" \\
    comment="PPPoE Users untuk TR069 (Auto-Generated)"

# ===========================================
# 8. VERIFIKASI KONFIGURASI
# ===========================================

:put "=== KONFIGURASI DNS GENIEACS SELESAI (AUTO-GENERATED) ==="
:put "DNS Server: ${this.serverIP} (GenieACS)"
:put "PPPoE Range: 192.168.10.0/24"
:put "TR069 Port: ${this.genieacsPort} (HTTP), 7548 (HTTPS)"
:put "Generated on: ${new Date().toLocaleString('en-PK')}"
:put ""
:put "=== VERIFICATION ==="

# Cek DNS static
:put "DNS Static Rules:"
/ip dns static print where name~"genieacs"

# Cek DHCP server
:put "DHCP Server:"
/ip dhcp-server print where name="pppoe-dhcp"

# Cek DHCP network
:put "DHCP Network:"
/ip dhcp-server network print where address="192.168.10.0/24"

# Cek NAT rules
:put "NAT Rules:"
/ip firewall nat print where comment~"tr069"

# Cek Firewall rules
:put "Firewall Rules:"
/ip firewall filter print where comment~"tr069"

# Cek PPPoE profile
:put "PPPoE Profileeeeeeeeee:"
/ppp profile print where name="genieacs-dns"

# Cek Address List
:put "Address List:"
/ip firewall address-list print where list="tr069-users"

:put ""
:put "=== CARA KERJA ==="
:put "1. PPPoE users get IP from range 192.168.10.0/24"
:put "2. DNS server diarahkan ke ${this.serverIP} (GenieACS)"
:put "3. TR069 traffic diizinkan ke port ${this.genieacsPort}/7548"
:put "4. ONU can communicate with GenieACS server"
:put ""
:put "=== SELESAI ==="

echo "Script DNS GenieACS has been created with IP: ${this.serverIP}!"
echo "Make sure GenieACS server is accessible from IP: ${this.serverIP}"
echo "Port TR069: ${this.genieacsPort} (HTTP), 7548 (HTTPS)"`;

            return script;

        } catch (error) {
            console.error('❌ Error generate script Mikrotik:', error.message);
            return null;
        }
    }

    // Function to save Mikrotik script
    saveMikrotikScript(script) {
        try {
            const fs = require('fs');
            const path = require('path');
            
            const filename = `mikrotik-dns-genieacs-auto-${this.serverIP.replace(/\./g, '-')}.rsc`;
            const filepath = path.join(__dirname, filename);
            
            fs.writeFileSync(filepath, script);
            
            console.log(`✅ Script Mikrotik disimpan: ${filename}`);
            console.log(`📁 Path: ${filepath}`);
            
            return {
                success: true,
                filename,
                filepath
            };

        } catch (error) {
            console.error('❌ Error saving Mikrotik script:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Fungsi untuk konfigurasi DNS ONU otomatis
    async configureONUDNS() {
        try {
            console.log('🔧 Mengkonfigurasi DNS ONU otomatis...');
            
            // Update konfigurasi dengan IP yang terdeteksi
            const configResult = this.updateGenieACSConfig();
            if (!configResult.success) {
                throw new Error(configResult.error);
            }

            // Konfigurasi DNS untuk semua ONU
            const result = await this.dnsConfig.configureAllONUDNS();
            
            if (result.success) {
                console.log(`✅ DNS ONU successful dikonfigurasi untuk ${result.successCount} device`);
                return {
                    success: true,
                    ...result
                };
            } else {
                console.log(`⚠️  DNS ONU konfigurasi: ${result.message}`);
                return result;
            }

        } catch (error) {
            console.error('❌ Error konfigurasi DNS ONU:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Fungsi utama untuk auto-setup
    async autoSetup() {
        try {
            console.log('🚀 AUTO SETUP DNS GENIEACS UNTUK DEVELOPMENT');
            console.log('=' .repeat(60));

            // Step 1: Deteksi IP server
            console.log('📋 Step 1: Mendeteksi IP server...');
            const serverIP = this.detectServerIP();
            if (!serverIP) {
                throw new Error('Cannot detect server IP');
            }

            // Step 2: Generate script Mikrotik
            console.log('\n📋 Step 2: Generate script Mikrotik...');
            const mikrotikScript = this.generateMikrotikScript();
            if (!mikrotikScript) {
                throw new Error('Failed generate script Mikrotik');
            }

            // Step 3: Save script Mikrotik
            console.log('\n📋 Step 3: Saving Mikrotik script...');
            const saveResult = this.saveMikrotikScript(mikrotikScript);
            if (!saveResult.success) {
                throw new Error(saveResult.error);
            }

            // Step 4: Konfigurasi DNS ONU (opsional)
            console.log('\n📋 Step 4: Konfigurasi DNS ONU...');
            const dnsResult = await this.configureONUDNS();

            // Step 5: Hasil akhir
            console.log('\n📊 HASIL AUTO SETUP:');
            console.log('=' .repeat(40));
            console.log(`✅ IP Server terdeteksi: ${this.serverIP}`);
            console.log(`✅ Script Mikrotik: ${saveResult.filename}`);
            console.log(`✅ GenieACS URL: http://${this.serverIP}:${this.genieacsPort}`);
            console.log(`✅ DNS Server: ${this.serverIP}`);
            
            if (dnsResult.success) {
                console.log(`✅ DNS ONU: ${dnsResult.successCount} device dikonfigurasi`);
            } else {
                console.log(`⚠️  DNS ONU: ${dnsResult.message || dnsResult.error}`);
            }

            console.log('\n📋 NEXT STEPS:');
            console.log('1. Upload script Mikrotik ke router:');
            console.log(`   /import file-name=${saveResult.filename}`);
            console.log('2. Verifikasi konektivitas:');
            console.log(`   ping ${this.serverIP}`);
            console.log(`   telnet ${this.serverIP} ${this.genieacsPort}`);

            return {
                success: true,
                serverIP: this.serverIP,
                genieacsUrl: `http://${this.serverIP}:${this.genieacsPort}`,
                dnsServer: this.serverIP,
                mikrotikScript: saveResult.filename,
                dnsResult
            };

        } catch (error) {
            console.error('❌ Error in auto setup:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Fungsi untuk menjalankan auto setup
async function runAutoSetup() {
    const autoSetup = new AutoGenieACSDNSDev();
    return await autoSetup.autoSetup();
}

// Run if called directly
if (require.main === module) {
    runAutoSetup()
        .then((result) => {
            if (result.success) {
                console.log('\n🎉 Auto setup successful!');
                console.log(`📋 IP Server: ${result.serverIP}`);
                console.log(`📋 Script Mikrotik: ${result.mikrotikScript}`);
            } else {
                console.log('\n❌ Auto setup failed:', result.error);
            }
            process.exit(result.success ? 0 : 1);
        })
        .catch((error) => {
            console.error('\n❌ Auto setup error:', error);
            process.exit(1);
        });
}

module.exports = { AutoGenieACSDNSDev, runAutoSetup };
