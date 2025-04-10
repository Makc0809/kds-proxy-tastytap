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
sudo cp ./kds-proxy.service /etc/systemd/system/
sudo systemctl daemon-reexec
sudo systemctl enable kds-proxy
sudo systemctl start kds-proxy

echo "✅ Done. Device ID: $(cat /opt/kds-proxy/device-config.json | jq -r .deviceId)"
