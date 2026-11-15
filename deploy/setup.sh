#!/usr/bin/env bash
# AllerGeez: set up a fresh Ubuntu 24.04 Vultr server in one go (run as root).
#   curl -fsSL https://raw.githubusercontent.com/preethiamara/allergeez/main/deploy/setup.sh | bash
# Optional: DOMAIN=yourdomain.com EMAIL=you@example.com before "bash" to use your own domain.
# Without a domain it uses a free <ip-with-dashes>.sslip.io name so HTTPS works (needed for camera, mic and sign-in).
set -euo pipefail

APP_DIR=/var/www/allergeez
REPO=https://github.com/preethiamara/allergeez.git
BRANCH=${BRANCH:-main}
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN=${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}
EMAIL=${EMAIL:-}

echo "==> Server IP $IP, site will be https://$DOMAIN"

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y git nginx curl ufw certbot python3-certbot-nginx

# Building Next.js needs ~2 GB of memory: add swap on small servers
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 3000000 ]; then
  echo "==> Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> Firewall: SSH + web only"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone -b "$BRANCH" "$REPO" "$APP_DIR"; fi

echo "==> Nginx"
cat > /etc/nginx/sites-available/allergeez <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20m;            # photo + voice uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;          # menu lookups and AI calls can take a while
    }
}
NGINX
ln -sf /etc/nginx/sites-available/allergeez /etc/nginx/sites-enabled/allergeez
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> HTTPS certificate (Let's Encrypt)"
if [ -n "$EMAIL" ]; then CERT_EMAIL=(-m "$EMAIL"); else CERT_EMAIL=(--register-unsafely-without-email); fi
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${CERT_EMAIL[@]}" --redirect \
  || echo "!! Couldn't get a certificate yet (the site still works on http://$DOMAIN). Re-run this script to retry."

echo "$DOMAIN" > "$APP_DIR/.deploy-domain"

if [ -f "$APP_DIR/.env.local" ]; then
  bash "$APP_DIR/deploy/update.sh"
else
  cat <<NEXT

==> Almost done. Your API keys aren't on the server yet (they never go in GitHub).
    From your Mac, in the project folder, run:

      scp .env.local root@$IP:$APP_DIR/.env.local

    Then back on the server:

      bash $APP_DIR/deploy/update.sh

    Your app will be at: https://$DOMAIN
NEXT
fi
