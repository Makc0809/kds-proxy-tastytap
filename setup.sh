#!/bin/bash
set -e

echo "📦 Installing KDS Proxy..."

apt update
apt install -y git curl avahi-daemon nano cron

echo "📥 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Клонируем агента
echo "📁 Cloning agent..."
git clone https://github.com/Makc0809/kds-proxy-tastytap.git /opt/kds-proxy || (cd /opt/kds-proxy && git pull)
cd /opt/kds-proxy
npm install

# Создаем update.sh
echo "🛠 Creating update.sh..."
cat <<EOF > /opt/kds-proxy/update.sh
#!/bin/bash
cd /opt/kds-proxy
echo "[\$(date)] 🔄 Updating agent from GitHub..." >> /opt/kds-proxy/update.log
git pull origin main >> /opt/kds-proxy/update.log 2>&1
npm install >> /opt/kds-proxy/update.log 2>&1
EOF

chmod +x /opt/kds-proxy/update.sh

# Добавим cron-задание
echo "🕒 Adding cron job..."
(crontab -l 2>/dev/null; echo "0 * * * * /opt/kds-proxy/update.sh") | crontab -

echo "✅ KDS Proxy installed!"
echo "🆔 To start agent manually: cd /opt/kds-proxy && node agent.js"
