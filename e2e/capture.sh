#!/usr/bin/env bash
# Reproducible documentation screenshots for SK Image.
#
#   ./capture.sh          build, run the Docker stack, seed sample data, capture, convert to WebP,
#                         and copy the curated set into ../docs/images/
#   ./capture.sh --down   stop + remove the stack
#
# Requires Docker + Node. See README.md.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${SIGNALK_PORT:-3007}"
BASE="http://localhost:${PORT}"
export SIGNALK_URL="$BASE"

if [ "${1:-}" = "--down" ]; then
  SIGNALK_PORT="$PORT" docker compose down -v
  exit 0
fi

echo "==> Building the plugin + web app (the image build copies dist/ + public/)"
( cd .. && npm run build && npm run build:webapp )

echo "==> Building + starting the Signal K + SK Image stack on :${PORT}"
SIGNALK_PORT="$PORT" docker compose up -d --build

echo "==> Waiting for the plugin to answer"
ready=""
for _ in $(seq 1 90); do
  if curl -fsS "${BASE}/plugins/sk-image/config" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "!! plugin never came up — recent logs:"
  SIGNALK_PORT="$PORT" docker compose logs --tail=60 signalk
  exit 1
fi

echo "==> Installing Playwright + deps (first run only)"
npm install --no-audit --no-fund >/dev/null
npx playwright install chromium >/dev/null

echo "==> Seeding sample images + collections"
node seed.mjs

echo "==> Capturing screenshots into screenshots/out/"
npm run screenshots

echo "==> Converting to WebP and copying into ../docs/images/"
node scripts/to-webp.mjs

echo "==> Done. Stop the stack with: ./capture.sh --down"
