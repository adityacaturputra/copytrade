#!/bin/bash
#
# setup.sh — Automated setup for copytrade-proxy on Ubuntu (Oracle Cloud)
#
# Usage:
#   1. Upload proxy/ folder to your VPS
#   2. Run: bash setup.sh
#   3. Configure .env: cp .env.example .env && nano .env
#   4. Start: sudo systemctl start copytrade-proxy
#

set -e

echo ""
echo "=== copytrade-proxy Setup ==="
echo ""

# Check OS
if ! command -v apt-get &>/dev/null; then
  echo "❌ This script is designed for Ubuntu/Debian. Please adapt for your OS."
  exit 1
fi

# 1. Install Node.js 20.x
if command -v node &>/dev/null; then
  echo "✅ Node.js $(node --version) already installed"
else
  echo "📦 Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "✅ Node.js $(node --version) installed"
fi

# 2. Install PM2 globally
if command -v pm2 &>/dev/null; then
  echo "✅ PM2 already installed"
else
  echo "📦 Installing PM2..."
  if command -v npm &>/dev/null; then
    GLOBAL_ROOT=$(npm root -g 2>/dev/null || true)
    if [ -n "$GLOBAL_ROOT" ] && [ -w "$GLOBAL_ROOT" ] || [ "$(id -u)" -eq 0 ]; then
      npm install -g pm2
    else
      sudo env "PATH=$PATH" npm install -g pm2
    fi
  else
    sudo env "PATH=$PATH" npm install -g pm2
  fi
  echo "✅ PM2 installed"
fi

# 3. Install dependencies
echo "📦 Installing proxy dependencies..."
npm install --production
echo "✅ Dependencies installed"

# 4. Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  Created .env from .env.example — please edit it!"
  echo "   Run: nano .env"
else
  echo "✅ .env already exists"
fi

# 5. Configure firewall (iptables)
echo ""
echo "🔥 Configuring firewall..."
if sudo iptables -C INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null; then
  echo "✅ Port 3000 already allowed in iptables"
else
  sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
  echo "✅ Port 3000 opened in iptables"
fi

# 6. Setup PM2 service
echo ""
echo "🔧 Setting up PM2 service..."
pm2 start server.js --name copytrade-proxy
pm2 save
pm2 startup 2>/dev/null || true
echo "✅ PM2 service configured (auto-restart on reboot)"

# 7. Show IP
echo ""
echo "==========================================="
echo "  🎉 Setup complete!"
echo "==========================================="
echo ""
echo "  Your proxy is running on port 3000"
echo ""

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "<could not determine>")
echo "  🌐 Your Static IP: ${PUBLIC_IP}"
echo ""
echo "  Next steps:"
echo "  1. Edit .env: nano .env"
echo "  2. Set API_SECRET for security"
echo "  3. Whitelist ${PUBLIC_IP} on OKX/MEXC dashboard"
echo "  4. Set these env vars on Vercel:"
echo "     OKX_PROXY_URL=http://${PUBLIC_IP}:3000/okx"
echo "     MEXC_PROXY_URL=http://${PUBLIC_IP}:3000/mexc"
echo ""
echo "  Test: curl http://${PUBLIC_IP}:3000/okx/api/v5/public/time"
echo ""

# Test the proxy
echo "  Testing proxy..."
sleep 2
TEST=$(curl -s --max-time 5 "http://localhost:3000/okx/api/v5/public/time" 2>/dev/null)
if echo "$TEST" | grep -q "code"; then
  echo "  ✅ Proxy is working! OKX responded."
else
  echo "  ⚠️  Could not verify proxy. Check logs: pm2 logs copytrade-proxy"
fi

echo ""
