#!/bin/bash
# Deploy JENDO Poson AR — only touches /var/www/ar-model
# Usage: SSHPASS='your-password' ./scripts/deploy.sh
set -euo pipefail

SERVER="root@168.144.40.152"
REMOTE_DIR="/var/www/ar-model"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${SSHPASS:-}" ]; then
  echo "Set SSHPASS env var or use ssh key auth."
  echo "Example: SSHPASS='...' ./scripts/deploy.sh"
  exit 1
fi

SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new"
RSYNC="sshpass -e rsync"

echo "==> Syncing files to $SERVER:$REMOTE_DIR"
$SSH "$SERVER" "mkdir -p $REMOTE_DIR"

$RSYNC -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'poson AR modle.glb' \
  "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

echo "==> Ensuring targets.mind exists"
if [ ! -f "$LOCAL_DIR/public/targets.mind" ]; then
  echo "Compiling targets.mind locally first..."
  node "$LOCAL_DIR/scripts/compile-browser.js"
fi

echo "==> Setting permissions"
$SSH "$SERVER" "chmod -R 755 $REMOTE_DIR/public"

echo "==> Configuring nginx + self-signed SSL (required for mobile camera)"
$SSH "$SERVER" 'bash -s' << 'REMOTE'
set -e
CONF="/etc/nginx/sites-available/ar-model"
ENABLED="/etc/nginx/sites-enabled/ar-model"
CERT_DIR="/etc/nginx/ssl/ar-model"

mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/cert.pem" ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -subj "/CN=168.144.40.152/O=JENDO/C=LK" 2>/dev/null
fi

cat > "$CONF" << 'NGINX'
server {
    listen 8443 ssl;
    listen [::]:8443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/ar-model/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/ar-model/key.pem;

    root /var/www/ar-model/public;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(js|css|html)$ {
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "no-cache";
    }

    location ~* \.(glb|mind|jpeg|jpg|png|wasm)$ {
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "public, max-age=86400";
    }
}
NGINX

ln -sf "$CONF" "$ENABLED"
nginx -t
systemctl reload nginx
echo "Nginx reloaded — HTTPS on port 8443"
REMOTE

echo ""
echo "==> Deploy complete!"
echo "URL: https://168.144.40.152:8443/"
echo "On first visit, accept the security certificate warning, then camera will work."
