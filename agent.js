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
const WS_URL = 'ws://192.168.0.97:3000/kds/socket';

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

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const i of iface) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

async function registerDevice(deviceId, ip) {
  const res = await fetch(`${API_BASE}/api/kds/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, ip })
  });
  return res.json(); // { pairingCode, printers }
}

function startPrinterServers(printers, deviceId) {
  stopAllServers();

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
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'config_update') {
        console.log('🔄 Received updated printer config');
        startPrinterServers(msg.printers, deviceId);
      }
    } catch (err) {
      console.error('❌ Invalid WS message:', err);
    }
  });

  ws.on('close', () => {
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
    const deviceId = generateDeviceId();
    const ip = getLocalIp();
    const response = await registerDevice(deviceId, ip);
    config = {
      deviceId,
      ip,
      pairingCode: response.pairingCode,
      printers: response.printers
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
