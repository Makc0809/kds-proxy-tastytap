#!/bin/bash
set -e  # остановит при ошибке

echo "📦 Installing KDS Proxy..."

apt install sudo -y

sudo apt update
sudo apt install -y git curl avahi-daemon

# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Клонируем агента
git clone https://github.com/Makc0809/kds-proxy-tastytap.git /opt/kds-proxy
cd /opt/kds-proxy
npm install

# Установка сервиса
if pidof systemd > /dev/null; then
  echo "🧩 Detected systemd — setting up service..."
  cp ./kds-proxy.service /etc/systemd/system/
  systemctl daemon-reexec
  systemctl enable kds-proxy
  systemctl start kds-proxy
else
  echo "⚠️ systemd not found. Run agent manually:"
  echo "cd /opt/kds-proxy && node agent.js"
fi

echo "✅ Done. Device ID: $(cat /opt/kds-proxy/device-config.json | jq -r .deviceId)"
