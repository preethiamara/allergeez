#!/usr/bin/env bash
# AllerGeez: get the latest code from GitHub, rebuild, and restart (run on the server as root).
#   bash /var/www/allergeez/deploy/update.sh
set -euo pipefail
APP_DIR=/var/www/allergeez
cd "$APP_DIR"

if [ ! -f .env.local ]; then
  echo "!! $APP_DIR/.env.local is missing. Copy it from your Mac first:  scp .env.local root@<server-ip>:$APP_DIR/.env.local"
  exit 1
fi
chmod 600 .env.local   # only root can read the keys

echo "==> Latest code"
git pull --ff-only

echo "==> Dependencies"
npm ci --no-audit --no-fund

echo "==> Build"
NODE_OPTIONS=--max-old-space-size=1536 npm run build

echo "==> (Re)start"
if pm2 describe allergeez >/dev/null 2>&1; then
  pm2 reload allergeez --update-env
else
  pm2 start npm --name allergeez -- start
  pm2 startup systemd -u root --hp /root >/dev/null
fi
pm2 save

DOMAIN=$(cat .deploy-domain 2>/dev/null || echo "your-server")
echo "==> Live at https://$DOMAIN"
