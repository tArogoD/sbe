const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');
const net = require('net');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const CONFIG = {
    C_T: process.env.C_T || "eyJhIjoiZjAzMGY1ZDg4OGEyYmRlN2NiMDg3NTU5MzM4ZjE0OTciLCJ0IjoiOGUwNWI3MTctMjdjNC00M2Y1LTg1NDgtNGRiZWY5MmI1N2NjIiwicyI6IlpqWm1OMk5qTldRdE5qazJOaTAwTURoaExUazFaR0l0WVRCaE1UTTVOREJqTkRKaSJ9",
    B_D: process.env.B_D || "1.seaw.cf",
    C_D: process.env.C_D || "scalingo.seav.eu.org",
    N_S: process.env.N_S || "nz.seav.eu.org",
    N_P: process.env.N_P || "443",
    N_K: process.env.N_K || "nJqKWWLfSFvJnMXpZ8",
    N_T: process.env.N_T || "--tls",
    HY2_PORT: process.env.HY2_PORT || "",
    VMESS_PORT: process.env.VMESS_PORT || "8001",
    REALITY_PORT: process.env.REALITY_PORT || "",
    TUIC_PORT: process.env.TUIC_PORT || "",
    SERVER_IP: process.env.SERVER_IP || "",
    VMESS_UUID: process.env.VMESS_UUID || "feefeb96-bfcf-4a9b-aac0-6aac771c1b98",
    TUIC_UUID: process.env.TUIC_UUID || "feefeb96-bfcf-4a9b-aac0-6aac771c1b98",
    TUIC_PASSWORD: process.env.TUIC_PASSWORD || "789456",
    HY2_PASSWORD: process.env.HY2_PASSWORD || "789456",
    REALITY_PRIVATE_KEY: process.env.REALITY_PRIVATE_KEY || "",
    REALITY_PUBLIC_KEY: process.env.REALITY_PUBLIC_KEY || "",
    HY2_SNI: process.env.HY2_SNI || "www.bing.com",
    VMESS_PATH: process.env.VMESS_PATH || "/vms",
    REALITY_SNI: process.env.REALITY_SNI || "www.microsoft.com",
    REALITY_SHORT_ID: process.env.REALITY_SHORT_ID || "0123456789abcdef",
    PORT: process.env.PORT || 3000
};

const WORK_DIR = os.tmpdir();
const processes = [];
let serviceStatus = {singbox: 'stopped', cloudflared: 'stopped', nezha: 'stopped', http: 'stopped'};

const HTML_TEMPLATES = {
    home: `
        <html>
        <head>
            <title>Service Panel</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body{font-family:Arial,sans-serif;margin:0;padding:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center}
                .container{text-align:center;background:white;padding:60px 40px;border-radius:15px;box-shadow:0 10px 30px rgba(0,0,0,0.2);max-width:500px;margin:20px}
                h1{color:#333;font-size:2.5em;margin-bottom:20px;font-weight:300}
                p{color:#666;font-size:1.2em;line-height:1.6;margin-bottom:30px}
                .icon{font-size:4em;margin-bottom:20px;color:#667eea;font-weight:bold}
                .footer{color:#999;font-size:0.9em;margin-top:30px}
                .nav-links{margin-top:30px}
                .nav-links a{display:inline-block;margin:0 10px;padding:10px 20px;background:#667eea;color:white;text-decoration:none;border-radius:5px;transition:background 0.3s}
                .nav-links a:hover{background:#5a67d8}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">[!]</div>
                <h1>Service Panel</h1>
                <p>Multi-protocol service management panel.</p>
                <div class="nav-links">
                    <a href="/status">View Status</a>
                </div>
                <div class="footer">Service Management Panel</div>
            </div>
        </body>
        </html>
    `,
    status: (serverIp, links) => `
        <html>
        <head>
            <title>Service Status</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body{font-family:Arial,sans-serif;margin:40px;background-color:#f5f5f5}
                .container{max-width:900px;margin:0 auto;background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
                h1{color:#333;text-align:center;margin-bottom:30px}
                .status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px}
                .status-card{padding:20px;background:#f8f9fa;border-radius:8px;text-align:center}
                .status-card h3{margin:0 0 10px 0;color:#555}
                .status-running{background:#d4edda;color:#155724}
                .status-stopped{background:#f8d7da;color:#721c24}
                .info-item{margin:20px 0;padding:15px;background:#f8f9fa;border-radius:5px}
                .label{font-weight:bold;color:#555;margin-bottom:10px}
                .value{font-family:monospace;background:#e9ecef;padding:10px;border-radius:4px;word-break:break-all;font-size:12px}
                .copy-btn{background:#007cba;color:white;border:none;padding:8px 15px;border-radius:3px;cursor:pointer;margin-top:10px}
                .copy-btn:hover{background:#0056b3}
                .protocol{color:#28a745;font-weight:bold}
                .nav{text-align:center;margin-bottom:20px}
                .nav a{margin:0 10px;color:#007cba;text-decoration:none}
                .nav a:hover{text-decoration:underline}
                .port-info{margin:20px 0;padding:15px;background:#e9ecef;border-radius:5px}
                .port-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px}
                .port-item{background:#fff;padding:10px;border-radius:4px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
                .port-label{font-weight:bold;color:#555}
                .port-value{font-family:monospace;color:#28a745;margin-top:5px}
            </style>
            <script>
                function refreshPage() {
                    location.reload();
                }
                setInterval(refreshPage, 30000);
            </script>
        </head>
        <body>
            <div class="container">
                <div class="nav">
                    <a href="/">Home</a> | <a href="/status">Status</a> | <a href="javascript:refreshPage()">Refresh</a>
                </div>
                <h1>Service Status</h1>
                
                <div class="status-grid">
                    <div class="status-card ${serviceStatus.singbox === 'running' ? 'status-running' : 'status-stopped'}">
                        <h3>Sing-Box</h3>
                        <div>${serviceStatus.singbox}</div>
                    </div>
                    <div class="status-card ${serviceStatus.cloudflared === 'running' ? 'status-running' : 'status-stopped'}">
                        <h3>Cloudflared</h3>
                        <div>${serviceStatus.cloudflared}</div>
                    </div>
                    <div class="status-card ${serviceStatus.nezha === 'running' ? 'status-running' : 'status-stopped'}">
                        <h3>Nezha</h3>
                        <div>${serviceStatus.nezha}</div>
                    </div>
                    <div class="status-card ${serviceStatus.http === 'running' ? 'status-running' : 'status-stopped'}">
                        <h3>HTTP Server</h3>
                        <div>${serviceStatus.http}</div>
                    </div>
                </div>
                
                <div class="port-info">
                    <div class="label">Configured Ports:</div>
                    <div class="port-grid">
                        <div class="port-item"><div class="port-label">HTTP</div><div class="port-value">${CONFIG.PORT}</div></div>
                        ${CONFIG.VMESS_PORT ? `<div class="port-item"><div class="port-label">VMESS</div><div class="port-value">${CONFIG.VMESS_PORT}</div></div>` : ''}
                        ${CONFIG.HY2_PORT ? `<div class="port-item"><div class="port-label">Hysteria2</div><div class="port-value">${CONFIG.HY2_PORT}</div></div>` : ''}
                        ${CONFIG.REALITY_PORT ? `<div class="port-item"><div class="port-label">Reality</div><div class="port-value">${CONFIG.REALITY_PORT}</div></div>` : ''}
                        ${CONFIG.TUIC_PORT ? `<div class="port-item"><div class="port-label">TUIC</div><div class="port-value">${CONFIG.TUIC_PORT}</div></div>` : ''}
                    </div>
                </div>
                
                <div class="info-item">
                    <div class="label">Server IP:</div>
                    <div class="value">${serverIp}</div>
                </div>
                
                ${links.length > 0 ? links.map(link => `
                    <div class="info-item">
                        <div class="label"><span class="protocol">${link.protocol}:</span></div>
                        <div class="value" id="${link.protocol.toLowerCase()}">${link.url}</div>
                        <button class="copy-btn" onclick="navigator.clipboard.writeText('${link.url}').then(()=>alert('Copied ${link.protocol}!'))">Copy</button>
                    </div>
                `).join('') : '<div class="info-item"><div class="label">No active connections</div></div>'}
            </div>
        </body>
        </html>
    `
};

const COMMON_PROCESS_NAMES = [
    'sshd', 'nginx', 'apache2', 'httpd', 'mysqld',
    'postgres', 'redis-server', 'memcached', 'ntpd',
    'systemd', 'crond', 'rsyslogd', 'supervisord',
    'node', 'python', 'php-fpm', 'java', 'ruby',
    'mongod', 'dockerd', 'containerd', 'snapd',
    'logrotate', 'udevd', 'syslogd', 'dbus-daemon',
    'cron', 'atd', 'dhclient', 'polkitd', 'irqbalance'
];

function getRandomProcessName() {
    return COMMON_PROCESS_NAMES[Math.floor(Math.random() * COMMON_PROCESS_NAMES.length)];
}

function detectArch() {
    const arch = process.arch;
    return arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : (process.exit(1), '');
}

async function downloadBinary(url, filepath) {
    return new Promise((resolve, reject) => {
        exec(`curl -s -L "${url}" -o "${filepath}" && chmod +x "${filepath}"`, (error) => {
            if (error) return reject(error);
            resolve();
        });
    });
}

async function getServerIP() {
    return new Promise((resolve) => {
        https.get('https://ipv4.icanhazip.com', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', () => resolve('127.0.0.1'));
    });
}

async function startTempTunnel(cloudflaredFile, port) {
    return new Promise((resolve) => {
        for (let i = 0; i < 3; i++) {
            const logFile = path.join(WORK_DIR, `cf_${crypto.randomBytes(4).toString('hex')}.log`);
            
            const process = spawn(cloudflaredFile, [
                'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            
            processes.push(process);
            
            const logStream = fs.createWriteStream(logFile);
            process.stdout.pipe(logStream);
            process.stderr.pipe(logStream);
            
            serviceStatus.cloudflared = 'running';
            
            process.on('error', () => {
                serviceStatus.cloudflared = 'error';
            });
            
            process.on('exit', (code) => {
                if (code !== 0) {
                    serviceStatus.cloudflared = 'stopped';
                }
            });
            
            setTimeout(() => {
                try {
                    const logContent = fs.readFileSync(logFile, 'utf8');
                    const match = logContent.match(/https:\/\/([^\/\s]+\.trycloudflare\.com)/);
                    if (match) {
                        CONFIG.C_D = match[1];
                        try { fs.unlinkSync(logFile); } catch (e) {}
                        return resolve(true);
                    }
                } catch (e) {}
                
                process.kill();
                try { fs.unlinkSync(logFile); } catch (e) {}
                
                if (i === 2) {
                    serviceStatus.cloudflared = 'error';
                    resolve(false);
                }
            }, 10000);
        }
    });
}

async function generateRealityKeys(singboxFile) {
    if (!CONFIG.REALITY_PORT || (CONFIG.REALITY_PRIVATE_KEY && CONFIG.REALITY_PUBLIC_KEY)) {
        return;
    }
    
    return new Promise((resolve) => {
        exec(`"${singboxFile}" generate reality-keypair`, (error, stdout) => {
            if (!error && stdout) {
                const privateMatch = stdout.match(/PrivateKey:\s*(\S+)/);
                const publicMatch = stdout.match(/PublicKey:\s*(\S+)/);
                
                if (privateMatch && publicMatch) {
                    CONFIG.REALITY_PRIVATE_KEY = privateMatch[1];
                    CONFIG.REALITY_PUBLIC_KEY = publicMatch[1];
                }
            }
            resolve();
        });
    });
}

async function generateSingBoxConfig() {
    const inbounds = [];

    if (CONFIG.HY2_PORT) {
        inbounds.push({
            type: "hysteria2",
            tag: "hy2-in",
            listen: "::",
            listen_port: parseInt(CONFIG.HY2_PORT),
            users: [{ name: "user1", password: CONFIG.HY2_PASSWORD }],
            tls: {
                enabled: true,
                server_name: CONFIG.HY2_SNI,
                insecure: true, // Replace with certificate_path in production
                alpn: ["h3", "h2", "http/1.1"]
            }
        });
    }

    if (CONFIG.VMESS_PORT) {
        inbounds.push({
            type: "vmess",
            tag: "vmess-in",
            listen: "::",
            listen_port: parseInt(CONFIG.VMESS_PORT),
            users: [{ uuid: CONFIG.VMESS_UUID, security: "aes-128-gcm" }],
            transport: { type: "ws", path: CONFIG.VMESS_PATH },
            tls: {
                enabled: true,
                server_name: CONFIG.C_D,
                insecure: true // Replace with certificate_path in production
            }
        });
    }

    if (CONFIG.REALITY_PORT) {
        inbounds.push({
            type: "vless",
            tag: "reality-in",
            listen: "::",
            listen_port: parseInt(CONFIG.REALITY_PORT),
            users: [{ uuid: CONFIG.VMESS_UUID }],
            tls: {
                enabled: true,
                server_name: CONFIG.REALITY_SNI,
                reality: {
                    enabled: true,
                    handshake: {
                        server: CONFIG.REALITY_SNI,
                        server_port: 443
                    },
                    private_key: CONFIG.REALITY_PRIVATE_KEY,
                    short_id: CONFIG.REALITY_SHORT_ID
                }
            }
        });
    }

    if (CONFIG.TUIC_PORT) {
        inbounds.push({
            type: "tuic",
            tag: "tuic-in",
            listen: "::",
            listen_port: parseInt(CONFIG.TUIC_PORT),
            users: [{ uuid: CONFIG.TUIC_UUID, password: CONFIG.TUIC_PASSWORD }],
            congestion_control: "cubic",
            tls: {
                enabled: true,
                server_name: CONFIG.HY2_SNI,
                insecure: true, // Replace with certificate_path in production
                alpn: ["h3", "spdy/3.1"]
            }
        });
    }

    const config = {
        log: { level: "warn", timestamp: false },
        dns: {
            servers: [
                { tag: "local", address: "local" },
                { tag: "google", address: "8.8.8.8", detour: "direct" }
            ],
            strategy: "ipv4_only"
        },
        inbounds,
        outbounds: [
            { type: "direct", tag: "direct" },
            { type: "block", tag: "block" }
        ],
        route: {
            rules: [
                { protocol: "dns", outbound: "google" },
                { ip_is_private: true, outbound: "direct" }
            ],
            final: "direct"
        },
        experimental: {
            cache_file: {
                enabled: true,
                path: "/tmp/singbox_cache.db"
            }
        }
    };

    const configPath = path.join(WORK_DIR, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
}

function generateLinks(serverIp) {
    const links = [];
    
    if (CONFIG.HY2_PORT) {
        links.push({
            protocol: 'Hysteria2',
            url: `hysteria2://${CONFIG.HY2_PASSWORD}@${serverIp}:${CONFIG.HY2_PORT}?insecure=1&sni=${CONFIG.HY2_SNI}&alpn=h3#HY2`
        });
    }
    
    if (CONFIG.VMESS_PORT) {
        const vmessObj = {
            v: "2",
            ps: "VMESS",
            add: CONFIG.B_D,
            port: "443",
            id: CONFIG.VMESS_UUID,
            aid: "0",
            scy: "auto",
            net: "ws",
            type: "none",
            host: CONFIG.C_D,
            path: CONFIG.VMESS_PATH,
            tls: "tls",
            sni: CONFIG.C_D,
            alpn: "",
            fp: "chrome"
        };
        
        links.push({
            protocol: 'VMess',
            url: `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`
        });
    }
    
    if (CONFIG.REALITY_PORT) {
        links.push({
            protocol: 'Reality',
            url: `vless://${CONFIG.VMESS_UUID}@${serverIp}:${CONFIG.REALITY_PORT}?encryption=none&security=reality&sni=${CONFIG.REALITY_SNI}&fp=chrome&pbk=${CONFIG.REALITY_PUBLIC_KEY}&sid=${CONFIG.REALITY_SHORT_ID}&type=tcp#REALITY`
        });
    }
    
    if (CONFIG.TUIC_PORT) {
        links.push({
            protocol: 'TUIC',
            url: `tuic://${CONFIG.TUIC_UUID}:${CONFIG.TUIC_PASSWORD}@${serverIp}:${CONFIG.TUIC_PORT}?congestion_control=cubic&udp_relay_mode=native&alpn=h3,spdy/3.1&allow_insecure=1#TUIC`
        });
    }
    
    return links;
}

function cleanup() {
    processes.forEach(proc => {
        try { proc.kill(); } catch (e) {}
    });
    process.exit(0);
}

async function startService(file, args, name, options = {}) {
    try {
        const proc = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
        
        if (options.logFile) {
            const logStream = fs.createWriteStream(options.logFile);
            proc.stdout.pipe(logStream);
            proc.stderr.pipe(logStream);
        }
        
        serviceStatus[name.toLowerCase()] = 'running';
        
        proc.on('spawn', () => {
            serviceStatus[name.toLowerCase()] = 'running';
        });
        
        proc.on('error', () => {
            serviceStatus[name.toLowerCase()] = 'error';
        });
        
        proc.on('exit', () => {
            serviceStatus[name.toLowerCase()] = 'stopped';
        });
        
        return new Promise((resolve) => {
            const checkRunning = () => {
                if (proc.killed) {
                    serviceStatus[name.toLowerCase()] = 'stopped';
                    resolve(null);
                } else {
                    processes.push(proc);
                    resolve(proc);
                }
            };
            
            setTimeout(checkRunning, 2000);
        });
    } catch (error) {
        serviceStatus[name.toLowerCase()] = 'error';
        return null;
    }
}

const app = express();

app.get('/', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATES.home);
});

app.get('/status', async (req, res) => {
    const serverIp = await getServerIP();
    const links = generateLinks(serverIp);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATES.status(serverIp, links));
});

app.get('/x', async (req, res) => {
    const serverIp = await getServerIP();
    const links = generateLinks(serverIp);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML_TEMPLATES.status(serverIp, links));
});

app.get('/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
});

const server = http.createServer(app);

server.on('upgrade', createProxyMiddleware({
    target: `ws://localhost:${CONFIG.VMESS_PORT}`,
    changeOrigin: true,
    ws: true,
    logLevel: 'silent'
}));

async function main() {
    server.listen(CONFIG.PORT, () => {
        serviceStatus.http = 'running';
    });
    
    try {
        const arch = detectArch();
        const isArm = arch === 'arm64';
        
        const singboxName = getRandomProcessName();
        const cloudflaredName = getRandomProcessName();
        const nezhaName = getRandomProcessName();
        
        const singboxFile = path.join(WORK_DIR, singboxName);
        const cloudflaredFile = path.join(WORK_DIR, cloudflaredName);
        const nezhaFile = path.join(WORK_DIR, nezhaName);
        
        const downloadUrls = {
            singbox: isArm ? 'https://github.com/seav1/dl/releases/download/upx/sb-arm' : 'https://github.com/seav1/dl/releases/download/upx/sb',
            cloudflared: isArm ? 'https://github.com/seav1/dl/releases/download/upx/cf-arm' : 'https://github.com/seav1/dl/releases/download/upx/cf',
            nezha: isArm ? 'https://github.com/seav1/dl/releases/download/upx/nz-arm' : 'https://github.com/seav1/dl/releases/download/upx/nz'
        };
        
        await Promise.all([
            downloadBinary(downloadUrls.singbox, singboxFile),
            downloadBinary(downloadUrls.cloudflared, cloudflaredFile),
            downloadBinary(downloadUrls.nezha, nezhaFile)
        ]);
        
        [singboxFile, cloudflaredFile, nezhaFile].forEach(file => {
            if (!fs.existsSync(file)) throw new Error(`文件未找到: ${file}`);
        });
        
        const serverIp = await getServerIP();
        
        if (CONFIG.HY2_PORT || CONFIG.VMESS_PORT || CONFIG.REALITY_PORT || CONFIG.TUIC_PORT) {
            await generateRealityKeys(singboxFile);
            const configPath = await generateSingBoxConfig();
            
            try {
                await new Promise((resolve, reject) => {
                    exec(`"${singboxFile}" check -c "${configPath}"`, (error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                });
                
                await startService(singboxFile, ['run', '-c', configPath], 'singbox');
            } catch (error) {
                serviceStatus.singbox = 'error';
            }
        }
        
        if (CONFIG.C_T) {
            try {
                const args = [
                    'tunnel', 
                    '--edge-ip-version', 'auto', 
                    '--protocol', 'http2',
                    '--no-autoupdate',
                    'run', 
                    '--token', CONFIG.C_T, 
                    '--url', `http://localhost:${CONFIG.PORT}`
                ];
                
                await startService(cloudflaredFile, args, 'cloudflared');
            } catch (error) {
                serviceStatus.cloudflared = 'error';
            }
        } else if (CONFIG.VMESS_PORT) {
            const tunnelResult = await startTempTunnel(cloudflaredFile, CONFIG.PORT);
            if (!tunnelResult) {
                serviceStatus.cloudflared = 'error';
            }
        }
        
        if (CONFIG.N_S && CONFIG.N_K) {
            const nezhaArgs = ['-s', `${CONFIG.N_S}:${CONFIG.N_P}`, '-p', `${CONFIG.N_K}`, '--report-delay', '3', '--disable-auto-update'];
            
            if (CONFIG.N_T === '--tls' || (typeof CONFIG.N_T === 'string' && CONFIG.N_T.includes('--tls'))) {
                nezhaArgs.push('--tls');
            }
            
            try {
                await startService(nezhaFile, nezhaArgs, 'nezha', {
                    logFile: path.join(WORK_DIR, 'nezha.log')
                });
            } catch (error) {
                serviceStatus.nezha = 'error';
            }
        }
        
        setInterval(() => {
            processes.forEach(proc => {
                if (proc.killed) {
                    const serviceName = Object.keys(serviceStatus).find(key => 
                        serviceStatus[key] === 'running' && !processes.some(p => p !== proc && !p.killed));
                    
                    if (serviceName) {
                        serviceStatus[serviceName] = 'stopped';
                    }
                }
            });
            
            if (processes.length > 0 && processes.every(proc => proc.killed)) {
                cleanup();
            }
        }, 10000);
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        
    } catch (error) {
        process.exit(1);
    }
}

main().catch(() => process.exit(1));
