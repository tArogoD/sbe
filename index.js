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

async function generateRealityKeys(singboxFile) {
    if (!CONFIG.REALITY_PORT || (CONFIG.REALITY_PRIVATE_KEY && CONFIG.REALITY_PUBLIC_KEY)) return;
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

// === 已更新为 Sing-Box 1.12.0 新格式 ===
async function generateSingBoxConfig() {
    const inbounds = [];
    if (CONFIG.HY2_PORT) {
        inbounds.push({
            type: "hysteria2",
            tag: "hy2-in",
            listen: "::",
            listen_port: parseInt(CONFIG.HY2_PORT),
            users: [{ password: CONFIG.HY2_PASSWORD }],
            tls: { enabled: true, server_name: CONFIG.HY2_SNI, insecure: true, alpn: ["h3", "h2", "http/1.1"] }
        });
    }
    if (CONFIG.VMESS_PORT) {
        inbounds.push({
            type: "vmess",
            tag: "vmess-in",
            listen: "::",
            listen_port: parseInt(CONFIG.VMESS_PORT),
            users: [{ uuid: CONFIG.VMESS_UUID, alterId: 0 }],
            transport: { type: "ws", path: CONFIG.VMESS_PATH }
        });
    }
    if (CONFIG.REALITY_PORT) {
        inbounds.push({
            type: "vless",
            tag: "reality-in",
            listen: "::",
            listen_port: parseInt(CONFIG.REALITY_PORT),
            users: [{ uuid: CONFIG.VMESS_UUID, flow: "xtls-rprx-vision" }],
            tls: {
                enabled: true,
                server_name: CONFIG.REALITY_SNI,
                reality: {
                    enabled: true,
                    handshake: { server: CONFIG.REALITY_SNI, server_port: 443 },
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
            listen: "::",
            listen_port: parseInt(CONFIG.TUIC_PORT),
            users: [{ uuid: CONFIG.TUIC_UUID, password: CONFIG.TUIC_PASSWORD }],
            tls: { enabled: true, server_name: CONFIG.HY2_SNI, insecure: true, alpn: ["h3", "spdy/3.1"] }
        });
    }

    const config = {
        log: { level: "warn", timestamp: false },
        dns: {
            servers: [
                { type: "local", tag: "local" },
                { type: "udp", tag: "google", server: "8.8.8.8" }
            ],
            strategy: "ipv4_only",
            domain_resolver: "local"
        },
        ntp: { enabled: true, detour: "direct" },
        certificate: {},
        endpoints: [],
        inbounds,
        outbounds: [
            { type: "direct", tag: "direct", domain_resolver: "local" },
            { type: "block", tag: "block" }
        ],
        route: {
            rules: [
                { action: "sniff" },
                { protocol: "dns", action: "hijack-dns" },
                { ip_is_private: true, outbound: "direct" }
            ],
            default_domain_resolver: "local"
        },
        services: [],
        experimental: { cache_file: { enabled: true } }
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
    processes.forEach(proc => { try { proc.kill(); } catch (e) {} });
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
        proc.on('error', () => { serviceStatus[name.toLowerCase()] = 'error'; });
        proc.on('exit', () => { serviceStatus[name.toLowerCase()] = 'stopped'; });
        return new Promise((resolve) => {
            setTimeout(() => {
                if (proc.killed) {
                    serviceStatus[name.toLowerCase()] = 'stopped';
                    resolve(null);
                } else {
                    processes.push(proc);
                    resolve(proc);
                }
            }, 2000);
        });
    } catch {
        serviceStatus[name.toLowerCase()] = 'error';
        return null;
    }
}

const app = express();
app.get('/', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <html><body>
        <h1>Service Panel</h1>
        <a href="/status">View Status</a>
        </body></html>
    `);
});
app.get('/status', async (req, res) => {
    const serverIp = await getServerIP();
    const links = generateLinks(serverIp);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<pre>${JSON.stringify({ status: serviceStatus, links }, null, 2)}</pre>`);
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
    server.listen(CONFIG.PORT, () => { serviceStatus.http = 'running'; });
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
        const serverIp = await getServerIP();
        if (CONFIG.HY2_PORT || CONFIG.VMESS_PORT || CONFIG.REALITY_PORT || CONFIG.TUIC_PORT) {
            await generateRealityKeys(singboxFile);
            const configPath = await generateSingBoxConfig();
            try {
                await new Promise((resolve, reject) => {
                    exec(`"${singboxFile}" check -c "${configPath}"`, (error) => {
                        if (error) reject(error); else resolve();
                    });
                });
                await startService(singboxFile, ['run', '-c', configPath], 'singbox');
            } catch {
                serviceStatus.singbox = 'error';
            }
        }
        if (CONFIG.C_T) {
            try {
                await startService(cloudflaredFile, [
                    'tunnel', '--edge-ip-version', 'auto', '--protocol', 'http2',
                    '--no-autoupdate', 'run', '--token', CONFIG.C_T,
                    '--url', `http://localhost:${CONFIG.PORT}`
                ], 'cloudflared');
            } catch {
                serviceStatus.cloudflared = 'error';
            }
        }
        if (CONFIG.N_S && CONFIG.N_K) {
            const nezhaArgs = ['-s', `${CONFIG.N_S}:${CONFIG.N_P}`, '-p', `${CONFIG.N_K}`, '--report-delay', '3', '--disable-auto-update'];
            if (CONFIG.N_T.includes('--tls')) nezhaArgs.push('--tls');
            try {
                await startService(nezhaFile, nezhaArgs, 'nezha', {
                    logFile: path.join(WORK_DIR, 'nezha.log')
                });
            } catch {
                serviceStatus.nezha = 'error';
            }
        }
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    } catch {
        process.exit(1);
    }
}

main().catch(() => process.exit(1));
