const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { URL } = require('url');
const crypto = require('crypto');
const net = require('net');

const CONFIG = {
    C_T: process.env.C_T || "",
    B_D: process.env.B_D || "1.seaw.cf",
    C_D: process.env.C_D || "",
    N_S: process.env.N_S || "nz.seav.eu.org",
    N_P: process.env.N_P || "443",
    N_K: process.env.N_K || "",
    N_T: process.env.N_T || "--tls",
    HY2_PORT: process.env.HY2_PORT || process.env.SERVER_PORT || "",
    VMESS_PORT: process.env.VMESS_PORT || "8001",
    REALITY_PORT: process.env.REALITY_PORT || "",
    TUIC_PORT: process.env.TUIC_PORT || "",
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
    PORT: process.env.PORT || 7860,
    MAX_RESTART_ATTEMPTS: 5,
    RESTART_DELAY: 3000,
    HEALTH_CHECK_INTERVAL: 15000
};

const WORK_DIR = path.resolve(process.env.WORK_DIR || os.tmpdir());
if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
}

const processManager = {
    processes: new Map(),
    restartCounts: new Map(),
    
    add(name, proc, config) {
        this.processes.set(name, { proc, config });
        this.restartCounts.set(name, 0);
        
        proc.on('exit', (code, signal) => {
            serviceStatus[name] = 'stopped';
            this.processes.delete(name);
            
            if (code !== 0 && !this.isShuttingDown) {
                this.scheduleRestart(name, config);
            }
        });
        
        proc.on('error', (error) => {
            serviceStatus[name] = 'error';
        });
    },
    
    scheduleRestart(name, config) {
        const restartCount = this.restartCounts.get(name) || 0;
        
        if (restartCount >= CONFIG.MAX_RESTART_ATTEMPTS) {
            serviceStatus[name] = 'failed';
            return;
        }
        
        this.restartCounts.set(name, restartCount + 1);
        const delay = CONFIG.RESTART_DELAY * Math.pow(2, restartCount);
        
        setTimeout(async () => {
            if (!this.isShuttingDown) {
                await this.startProcess(name, config);
            }
        }, delay);
    },
    
    async startProcess(name, config) {
        try {
            serviceStatus[name] = 'starting';
            const proc = await config.starter();
            if (proc) {
                this.add(name, proc, config);
                serviceStatus[name] = 'running';
                this.restartCounts.set(name, 0);
                return proc;
            }
        } catch (error) {
            serviceStatus[name] = 'error';
            this.scheduleRestart(name, config);
        }
        return null;
    },
    
    killAll() {
        this.isShuttingDown = true;
        this.processes.forEach(({ proc }, name) => {
            try {
                proc.kill('SIGTERM');
                setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill('SIGKILL');
                    }
                }, 5000);
            } catch (e) {}
        });
    },
    
    getProcessInfo() {
        const info = {};
        this.processes.forEach((procInfo, name) => {
            info[name] = {
                restarts: this.restartCounts.get(name) || 0
            };
        });
        return info;
    }
};

let serviceStatus = {singbox: 'stopped', cloudflared: 'stopped', nezha: 'stopped', http: 'stopped'};
let binaryFiles = {};

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
                <p>Multi-protocol service management panel with auto-restart.</p>
                <div class="nav-links">
                    <a href="/status">View Status</a>
                </div>
                <div class="footer">Service Management Panel v2.0</div>
            </div>
        </body>
        </html>
    `,
    status: (serverIp, links, processInfo) => `
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
                .status-card{padding:20px;background:#f8f9fa;border-radius:8px;text-align:center;position:relative}
                .status-card h3{margin:0 0 10px 0;color:#555}
                .status-running{background:#d4edda;color:#155724}
                .status-stopped{background:#f8d7da;color:#721c24}
                .status-starting{background:#fff3cd;color:#856404}
                .status-error{background:#f8d7da;color:#721c24}
                .status-failed{background:#6c757d;color:white}
                .restart-count{position:absolute;top:5px;right:10px;background:#6c757d;color:white;border-radius:50%;width:20px;height:20px;font-size:12px;display:flex;align-items:center;justify-content:center}
                .process-info{font-size:11px;margin-top:5px;opacity:0.7}
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
            <script>setInterval(()=>location.reload(),10000);</script>
        </head>
        <body>
            <div class="container">
                <div class="nav">
                    <a href="/">Home</a> | <a href="/status">Status</a> | <a href="javascript:location.reload()">Refresh</a>
                </div>
                <h1>Service Status</h1>
                
                <div class="status-grid">
                    ${Object.keys(serviceStatus).map(service => {
                        const status = serviceStatus[service];
                        const info = processInfo[service];
                        const restarts = info ? info.restarts : 0;
                        
                        return `
                        <div class="status-card status-${status}">
                            <h3>${service.charAt(0).toUpperCase() + service.slice(1)}</h3>
                            <div>${status}</div>
                            ${restarts > 0 ? `<div class="restart-count">${restarts}</div>` : ''}
                        </div>
                        `;
                    }).join('')}
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
                        <div class="value">${link.url}</div>
                        <button class="copy-btn" onclick="navigator.clipboard.writeText('${link.url}').then(()=>alert('Copied ${link.protocol}!'))">Copy</button>
                    </div>
                `).join('') : '<div class="info-item"><div class="label">No active connections</div></div>'}
            </div>
        </body>
        </html>
    `
};

// Generate random 6-character filename using alphanumeric characters
function generateRandomFileName() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateUniqueFileNames() {
    const usedNames = new Set();
    const fileNames = {};
    
    ['singbox', 'cloudflared', 'nezha'].forEach(service => {
        let fileName;
        do {
            fileName = generateRandomFileName();
        } while (usedNames.has(fileName));
        
        usedNames.add(fileName);
        fileNames[service] = fileName;
    });
    
    return fileNames;
}

async function downloadBinary(url, filepath) {
    return new Promise((resolve, reject) => {
        const curlProcess = spawn('curl', ['-s', '-L', '-o', filepath, url]);
        
        curlProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    fs.chmodSync(filepath, 0o755);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            } else {
                reject(new Error(`curl failed with code ${code}`));
            }
        });
        
        curlProcess.on('error', reject);
    });
}

async function getServerIP() {
    return new Promise((resolve) => {
        const curlProcess = spawn('curl', ['-s', 'ipv4.icanhazip.com']);
        let output = '';
        
        curlProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        curlProcess.on('close', (code) => {
            resolve(code === 0 ? output.trim() : '127.0.0.1');
        });
        
        curlProcess.on('error', () => {
            resolve('127.0.0.1');
        });
    });
}

async function startTempTunnel(cloudflaredFile, port) {
    return new Promise((resolve) => {
        for (let i = 0; i < 3; i++) {
            const logFile = path.join(WORK_DIR, `cf_${crypto.randomBytes(4).toString('hex')}.log`);
            
            const process = spawn(cloudflaredFile, [
                'tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            
            const logStream = fs.createWriteStream(logFile);
            process.stdout.pipe(logStream);
            process.stderr.pipe(logStream);
            
            process.on('error', () => {});
            process.on('exit', (code) => {});
            
            setTimeout(() => {
                try {
                    const logContent = fs.readFileSync(logFile, 'utf8');
                    const match = logContent.match(/https:\/\/([^\/\s]+\.trycloudflare\.com)/);
                    if (match) {
                        CONFIG.C_D = match[1];
                        try { fs.unlinkSync(logFile); } catch (e) {}
                        return resolve(process);
                    }
                } catch (e) {}
                
                process.kill();
                try { fs.unlinkSync(logFile); } catch (e) {}
                
                if (i === 2) {
                    resolve(null);
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
        const singboxProcess = spawn(singboxFile, ['generate', 'reality-keypair']);
        let output = '';
        
        singboxProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        singboxProcess.on('close', (code) => {
            if (code === 0 && output) {
                const privateMatch = output.match(/PrivateKey:\s*(\S+)/);
                const publicMatch = output.match(/PublicKey:\s*(\S+)/);
                
                if (privateMatch && publicMatch) {
                    CONFIG.REALITY_PRIVATE_KEY = privateMatch[1];
                    CONFIG.REALITY_PUBLIC_KEY = publicMatch[1];
                }
            }
            resolve();
        });
        
        singboxProcess.on('error', () => {
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
            listen: "0.0.0.0",
            listen_port: parseInt(CONFIG.HY2_PORT),
            users: [
                {
                    password: CONFIG.HY2_PASSWORD
                }
            ],
            tls: {
                enabled: true,
                server_name: CONFIG.HY2_SNI,
                insecure: true,
                alpn: ["h3"]
            }
        });
    }
    
    if (CONFIG.VMESS_PORT) {
        inbounds.push({
            type: "vmess",
            tag: "vmess-in",
            listen: "0.0.0.0",
            listen_port: parseInt(CONFIG.VMESS_PORT),
            users: [
                {
                    uuid: CONFIG.VMESS_UUID,
                    alterId: 0
                }
            ],
            transport: {
                type: "ws",
                path: CONFIG.VMESS_PATH,
                headers: {}
            }
        });
    }
    
    if (CONFIG.REALITY_PORT) {
        inbounds.push({
            type: "vless",
            tag: "reality-in",
            listen: "0.0.0.0",
            listen_port: parseInt(CONFIG.REALITY_PORT),
            users: [
                {
                    uuid: CONFIG.VMESS_UUID,
                    flow: "xtls-rprx-vision"
                }
            ],
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
                    short_id: [CONFIG.REALITY_SHORT_ID]
                }
            }
        });
    }
    
    if (CONFIG.TUIC_PORT) {
        inbounds.push({
            type: "tuic",
            tag: "tuic-in",
            listen: "0.0.0.0",
            listen_port: parseInt(CONFIG.TUIC_PORT),
            users: [
                {
                    uuid: CONFIG.TUIC_UUID,
                    password: CONFIG.TUIC_PASSWORD
                }
            ],
            congestion_control: "cubic",
            auth_timeout: "3s",
            zero_rtt_handshake: false,
            heartbeat: "10s",
            tls: {
                enabled: true,
                server_name: CONFIG.HY2_SNI,
                insecure: true,
                alpn: ["h3"]
            }
        });
    }

    const config = {
        log: {
            level: "warn",
            timestamp: true
        },
        dns: {
            servers: [
                {
                    tag: "google",
                    address: "8.8.8.8"
                },
                {
                    tag: "cloudflare", 
                    address: "1.1.1.1"
                }
            ],
            final: "google"
        },
        inbounds,
        outbounds: [
            {
                type: "direct",
                tag: "direct"
            },
            {
                type: "block",
                tag: "block"
            }
        ],
        route: {
            rules: [
                {
                    ip_is_private: true,
                    outbound: "direct"
                }
            ],
            final: "direct"
        },
        experimental: {
            cache_file: {
                enabled: true,
                path: path.join(WORK_DIR, "cache.db")
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
            v: "2", ps: "VMESS", add: CONFIG.B_D, port: "443", id: CONFIG.VMESS_UUID,
            aid: "0", scy: "auto", net: "ws", type: "none", host: CONFIG.C_D,
            path: CONFIG.VMESS_PATH, tls: "tls", sni: CONFIG.C_D, alpn: "", fp: "chrome"
        };
        links.push({
            protocol: 'VMess',
            url: `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`
        });
    }
    
    if (CONFIG.REALITY_PORT) {
        links.push({
            protocol: 'Reality',
            url: `vless://${CONFIG.VMESS_UUID}@${serverIp}:${CONFIG.REALITY_PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${CONFIG.REALITY_SNI}&fp=chrome&pbk=${CONFIG.REALITY_PUBLIC_KEY}&sid=${CONFIG.REALITY_SHORT_ID}&type=tcp#REALITY`
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
    processManager.killAll();
    
    setTimeout(() => {
        process.exit(0);
    }, 10000);
}

function createServiceStarters() {
    const starters = {};
    
    if (CONFIG.HY2_PORT || CONFIG.VMESS_PORT || CONFIG.REALITY_PORT || CONFIG.TUIC_PORT) {
        starters.singbox = async () => {
            try {
                await generateRealityKeys(binaryFiles.singbox);
                const configPath = await generateSingBoxConfig();
                
                const checkProcess = spawn(binaryFiles.singbox, ['check', '-c', configPath], { stdio: 'ignore' });
                
                await new Promise((resolve, reject) => {
                    checkProcess.on('close', (code) => {
                        code === 0 ? resolve() : reject(new Error(`Config check failed: ${code}`));
                    });
                    checkProcess.on('error', reject);
                });
                
                const proc = spawn(binaryFiles.singbox, ['run', '-c', configPath], { 
                    stdio: ['ignore', 'pipe', 'pipe'] 
                });
                
                return proc;
            } catch (error) {
                throw new Error(`SingBox startup failed: ${error.message}`);
            }
        };
    }
    
    if (CONFIG.C_T) {
        starters.cloudflared = async () => {
            const proc = spawn(binaryFiles.cloudflared, [
                'tunnel', '--edge-ip-version', 'auto', '--protocol', 'http2',
                '--region', 'us', '--no-autoupdate', 'run', '--token', CONFIG.C_T,
                '--url', `http://localhost:${CONFIG.PORT}`
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            
            return proc;
        };
    } else if (CONFIG.VMESS_PORT) {
        starters.cloudflared = async () => {
            return await startTempTunnel(binaryFiles.cloudflared, CONFIG.PORT);
        };
    }
    
    if (CONFIG.N_S && CONFIG.N_K) {
        starters.nezha = async () => {
            const nezhaArgs = ['-s', `${CONFIG.N_S}:${CONFIG.N_P}`, '-p', CONFIG.N_K, '--report-delay', '3', '--disable-auto-update'];
            
            if (CONFIG.N_T.includes('--tls')) {
                nezhaArgs.push('--tls');
            }
            
            const proc = spawn(binaryFiles.nezha, nezhaArgs, { 
                stdio: ['ignore', 'pipe', 'pipe'] 
            });
            
            const logFile = path.join(WORK_DIR, 'nezha.log');
            const logStream = fs.createWriteStream(logFile);
            proc.stdout.pipe(logStream);
            proc.stderr.pipe(logStream);
            
            return proc;
        };
    }
    
    return starters;
}

function handleWebSocketUpgrade(request, socket, head) {
    const target = net.createConnection(CONFIG.VMESS_PORT, '127.0.0.1');
    
    target.on('connect', () => {
        const requestLine = `${request.method} ${request.url} HTTP/1.1\r\n`;
        const headers = Object.keys(request.headers).map(key => `${key}: ${request.headers[key]}`).join('\r\n');
        target.write(requestLine + headers + '\r\n\r\n');
        
        socket.pipe(target);
        target.pipe(socket);
    });
    
    target.on('error', () => socket.end());
    socket.on('error', () => target.destroy());
}

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    
    if (pathname === '/') {
        res.writeHead(200);
        res.end(HTML_TEMPLATES.home);
    } else if (pathname === '/status' || pathname === '/x') {
        const serverIp = await getServerIP();
        const links = generateLinks(serverIp);
        const processInfo = processManager.getProcessInfo();
        res.writeHead(200);
        res.end(HTML_TEMPLATES.status(serverIp, links, processInfo));
    } else if (pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ 
            status: 'ok', 
            services: serviceStatus,
            processes: processManager.getProcessInfo()
        }));
    } else {
        res.writeHead(404);
        res.end('<h1>404 Not Found</h1>');
    }
});

server.on('upgrade', handleWebSocketUpgrade);

function setupHealthCheck() {
    setInterval(async () => {
        const starters = createServiceStarters();
        
        for (const [serviceName, starter] of Object.entries(starters)) {
            const currentStatus = serviceStatus[serviceName];
            const hasProcess = processManager.processes.has(serviceName);
            
            if (!hasProcess && (currentStatus === 'stopped' || currentStatus === 'error')) {
                await processManager.startProcess(serviceName, { starter });
            }
        }
        
        processManager.processes.forEach((procInfo, name) => {
            if (procInfo.proc.killed) {
                processManager.processes.delete(name);
                if (serviceStatus[name] === 'running') {
                    serviceStatus[name] = 'stopped';
                }
            }
        });
        
    }, CONFIG.HEALTH_CHECK_INTERVAL);
}

async function main() {
    server.listen(CONFIG.PORT, () => {
        serviceStatus.http = 'running';
    });
    
    try {
        const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.exit(1);
        const isArm = arch === 'arm64';
        
        const uniqueFileNames = generateUniqueFileNames();
        
        binaryFiles = {
            singbox: path.join(WORK_DIR, uniqueFileNames.singbox),
            cloudflared: path.join(WORK_DIR, uniqueFileNames.cloudflared),
            nezha: path.join(WORK_DIR, uniqueFileNames.nezha)
        };
        
        const downloadUrls = {
            singbox: `https://github.com/seav1/dl/releases/download/files/sb${isArm ? '-arm' : ''}`,
            cloudflared: `https://github.com/seav1/dl/releases/download/files/cf${isArm ? '-arm' : ''}`,
            nezha: `https://github.com/seav1/dl/releases/download/files/nz${isArm ? '-arm' : ''}`
        };
        
        const filesToDownload = Object.entries(binaryFiles).filter(([name, file]) => !fs.existsSync(file));
        
        for (const [name, filepath] of filesToDownload) {
            try {
                await downloadBinary(downloadUrls[name], filepath);
            } catch (error) {
                throw error;
            }
        }
        
        for (const [name, file] of Object.entries(binaryFiles)) {
            if (!fs.existsSync(file)) {
                throw new Error(`Binary file not found: ${name} at ${file}`);
            }
        }
        
        const starters = createServiceStarters();
        
        for (const [serviceName, starter] of Object.entries(starters)) {
            await processManager.startProcess(serviceName, { starter });
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        setupHealthCheck();
        
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('uncaughtException', (error) => {
            cleanup();
        });
        
        process.on('unhandledRejection', (reason, promise) => {});
        
    } catch (error) {
        process.exit(1);
    }
}

main().catch((error) => {
    process.exit(1);
});
