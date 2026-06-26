#!/bin/bash
# Set up free SSL for AR site on a subdomain (requires DNS A record)
# Usage: ./scripts/setup-ssl.sh ar.veritasinnovations.lk
set -euo pipefail

DOMAIN="${1:-}"
SERVER="root@168.144.40.152"
REMOTE_DIR="/var/www/ar-model"

if [ -z "$DOMAIN" ]; then
  echo "Usage: SSHPASS='...' ./scripts/setup-ssl.sh your-subdomain.example.com"
  echo ""
  echo "Steps:"
  echo "  1. Add DNS A record: subdomain -> 168.144.40.152"
  echo "  2. Run this script with the subdomain"
  exit 1
fi

if [ -z "${SSHPASS:-}" ]; then
  echo "Set SSHPASS env var first."
  exit 1
fi

SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new"

echo "==> Creating nginx config for $DOMAIN"
$SSH "$SERVER" "bash -s" << REMOTE
set -e
CONF="/etc/nginx/sites-available/ar-model"
ENABLED="/etc/nginx/sites-enabled/ar-model"

cat > "\$CONF" << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN_PLACEHOLDER;

    root /var/www/ar-model/public;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~* \.(glb|mind|jpeg|jpg|png|js|css|html|wasm)$ {
        add_header Cache-Control "public, max-age=3600";
    }
}
NGINX

sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/" "\$CONF"
ln -sf "\$CONF" "\$ENABLED"
nginx -t && systemctl reload nginx
REMOTE

echo "==> Getting free SSL certificate from Let's Encrypt"
$SSH "$SERVER" "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect" || {
  echo ""
  echo "Certbot failed. Make sure DNS A record for $DOMAIN points to 168.144.40.152"
  echo "Check with: dig +short $DOMAIN"
  exit 1
}

echo ""
echo "==> Done! Use: https://$DOMAIN/"
