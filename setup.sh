#!/bin/bash
set -e

echo "📦 Installing KDS Proxy..."

apt update
apt install -y git curl avahi-daemon nano cron

echo "📥 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Клонируем или обновляем
if [ ! -d /opt/kds-proxy ]; then
  git clone https://github.com/Makc0809/kds-proxy-tastytap.git /opt/kds-proxy
else
  cd /opt/kds-proxy && git pull
fi

cd /opt/kds-proxy
npm install

# Создаем update.sh
echo "🔁 Creating update.sh..."
cat <<EOF > /opt/kds-proxy/update.sh
#!/bin/bash
cd /opt/kds-proxy
echo "[\$(date)] 🔄 Updating agent from GitHub..." >> /opt/kds-proxy/update.log
git pull origin main >> /opt/kds-proxy/update.log 2>&1
npm install >> /opt/kds-proxy/update.log 2>&1
systemctl restart kds-proxy.service
EOF

chmod +x /opt/kds-proxy/update.sh

# Добавляем cron
echo "🕒 Registering cron update job..."
(crontab -l 2>/dev/null; echo "0 * * * * /opt/kds-proxy/update.sh") | crontab -

# Создаем systemd unit
echo "🛠 Installing systemd service..."
cat <<EOF > /etc/systemd/system/kds-proxy.service
[Unit]
Description=KDS Proxy Agent
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/kds-proxy/agent.js
Restart=always
User=root
Environment=NODE_ENV=production
WorkingDirectory=/opt/kds-proxy

[Install]
WantedBy=multi-user.target
EOF

# Активируем и запускаем
systemctl daemon-reexec
systemctl enable kds-proxy
systemctl start kds-proxy

echo "✅ Installed and running! You can check status via: systemctl status kds-proxy"
