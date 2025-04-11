import net from 'net';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import fetch from 'node-fetch';
import WebSocket from 'ws';

const CONFIG_FILE = './device-config.json';
// const API_BASE = 'https://your-backend.com';
// const WS_URL = 'wss://your-backend.com/kds/socket';

const API_BASE = 'http://192.168.0.97:5005';
const WS_URL = 'ws://192.168.0.97:5005/ws/kds';

let wsBlocked = false;

let currentServers = [];

function generateDeviceId() {
  const interfaces = os.networkInterfaces();
  const macs = Object.values(interfaces)
      .flat()
      .filter(i => i && !i.internal && i.mac)
      .map(i => i.mac)
      .sort();

  const raw = macs.join('-') + os.hostname();
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);
}

function getCachedDeviceId() {
  const idFile = './.device-id';
  if (fs.existsSync(idFile)) {
    return fs.readFileSync(idFile, 'utf-8').trim();
  }

  const interfaces = os.networkInterfaces();
  const macs = Object.values(interfaces)
      .flat()
      .filter(i => i && !i.internal && i.mac)
      .map(i => i.mac)
      .sort();

  const raw = macs.join('-');
  const deviceId = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 12);

  fs.writeFileSync(idFile, deviceId);
  return deviceId;
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const i of iface) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

const registerDevice = async (deviceId, ip) => {
  const res = await fetch(`${API_BASE}/api/kds/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, ip })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend responded with ${res.status}: ${text}`);
  }

  const data = await res.json();

  if (!data || !data.pairingCode || !Array.isArray(data.printers)) {
    throw new Error('Backend response invalid or incomplete');
  }

  return data; // { pairingCode, printers }
};

async function tryRegister(deviceId, ip, maxAttempts = 5, delay = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔌 Attempt ${attempt}/${maxAttempts} to register device...`);
      const res = await registerDevice(deviceId, ip);
      if (!res || typeof res !== 'object') throw new Error('Empty response');

      console.log(`✅ Registration complete.`);
      return res;
    } catch (err) {
      console.error(`❌ Register failed [${attempt}]:`, err.message);
      if (attempt < maxAttempts) {
        console.log(`⏳ Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error('🚫 Max attempts reached. Exiting.');
        process.exit(1);
      }
    }
  }
}

function startPrinterServers(printers, deviceId) {
  stopAllServers();

  if (!Array.isArray(printers)) {
    console.log('⚠️ No printers configured yet. Waiting for backend update...');
    return;
  }

  if (Array.isArray(printers) && printers.length === 0) {
    console.log('⚠️ No printers registered for this device yet.');
    return;
  }

  printers.forEach(({ name, port }) => {
    const server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (data) => buffer += data.toString());
      socket.on('end', () => {
        console.log(`📦 [${name}] Order received:\n${buffer}`);
        fetch(`${API_BASE}/api/kds/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ station: name, deviceId, content: buffer })
        }).catch(err => console.error('❌ Order post failed:', err));
      });
    });

    server.listen(port, () => {
      console.log(`🖨 [${name}] listening on port ${port}`);
    });

    currentServers.push(server);
  });
}

function stopAllServers() {
  currentServers.forEach(server => {
    try {
      server.close();
    } catch (e) {
      console.error('❌ Failed to close server:', e);
    }
  });
  currentServers = [];
}

function setupWebSocket(deviceId) {
  const ws = new WebSocket(`${WS_URL}?deviceId=${deviceId}`);

  ws.on('open', () => {
    console.log('🌐 WebSocket connected');
    ws.send(JSON.stringify({
      type: 'hello',
      deviceId,
      ip: getLocalIp()
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'unauthorized') {
        console.warn(`🔒 Unauthorized: reason=${msg.reason}`);
        wsBlocked = true;

        if (msg.reason === 'not_registered') {
          try {
            if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
            if (fs.existsSync('.device-id')) fs.unlinkSync('.device-id');
          } catch (e) {
            console.error('❌ Failed to delete config:', e.message);
          }
          stopAllServers();
          setTimeout(() => {
            wsBlocked = false;
            init();
          }, 3000);
        } else {
          // Просто ждём
          stopAllServers();
          setTimeout(() => {
            wsBlocked = false;
            setupWebSocket(deviceId);
          }, 60000);
        }

        return;
      }

      if (msg.type === 'config_update') {
        console.log('🔄 Received updated printer config');
        startPrinterServers(msg.printers, deviceId);
      }

    } catch (err) {
      console.error('❌ Invalid WS message:', err);
    }
  });

  ws.on('close', () => {
    if (wsBlocked) return;
    console.log('❌ WebSocket disconnected. Reconnecting in 10s...');
    setTimeout(() => setupWebSocket(deviceId), 10000);
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err);
  });
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

async function init() {
  let config;
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE));
  } else {
    const deviceId = getCachedDeviceId();
    const ip = getLocalIp();


    console.log(`🆔 Device ID: ${deviceId}`);
    console.log(`🌐 Local IP: ${ip}`);

    const response = await tryRegister(deviceId, ip, 100, 5000); // 100 попыток, каждые 1 сек
    const printers = response.printers || [];

    config = {
      deviceId,
      ip,
      pairingCode: response.pairingCode,
      printers,
    };
    saveConfig(config);
    console.log(`🔗 Pairing Code: ${response.pairingCode}`);
  }

  startPrinterServers(config.printers, config.deviceId);
  setupWebSocket(config.deviceId);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  stopAllServers();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('🛑 Terminated');
  stopAllServers();
  process.exit();
});

init();
