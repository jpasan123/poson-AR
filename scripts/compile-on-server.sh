#!/bin/bash
# Compiles MindAR image target on the server (requires node + canvas deps)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$PROJECT_DIR/public"

cd "$PROJECT_DIR"

if [ ! -f "node_modules/mind-ar/dist/mindar-image.prod.js" ]; then
  echo "Installing dependencies..."
  apt-get update -qq
  apt-get install -y -qq build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev pkg-config > /dev/null 2>&1 || true
  npm install --omit=dev 2>/dev/null || npm install
fi

node scripts/compile-target.js
echo "Done: $PUBLIC_DIR/targets.mind"
