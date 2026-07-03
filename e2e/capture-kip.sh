#!/usr/bin/env bash
# Capture the KIP Image-widget configuration screenshot for the docs.
#
# Unlike capture.sh (which shoots the SK Image web app), this drives KIP — a separate app — pointed
# at the SK Image server, so it needs a KIP checkout that ships the Image widget
# (requiredPlugins: ['sk-image']).
#
#   KIP_DIR=/path/to/kip ./capture-kip.sh
#
# Env:
#   KIP_DIR       (required) a KIP checkout on a branch that includes the Image widget
#   KIP_BUILD     build KIP first (default 1; set 0 if KIP_DIR/public is already built)
#   SIGNALK_PORT  SK Image server port (default 3007)
#   KIP_PORT      local port to serve the built KIP app on (default 4300)
set -euo pipefail
cd "$(dirname "$0")"

: "${KIP_DIR:?set KIP_DIR to a KIP checkout that includes the Image widget}"
SIGNALK_PORT="${SIGNALK_PORT:-3007}"
KIP_PORT="${KIP_PORT:-4300}"
BASE="http://localhost:${SIGNALK_PORT}"
export SIGNALK_URL="$BASE"
export KIP_URL="http://localhost:${KIP_PORT}/@mxtommy/kip/"
export KIP_PUBLIC_DIR="${KIP_DIR}/public"

echo "==> Ensuring the SK Image server is up on :${SIGNALK_PORT}"
SIGNALK_PORT="$SIGNALK_PORT" docker compose up -d --build
ready=""
for _ in $(seq 1 90); do
  if curl -fsS "${BASE}/plugins/sk-image/config" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ -n "$ready" ] || { echo "!! SK Image plugin never came up"; docker compose logs --tail=40 signalk; exit 1; }

echo "==> Installing deps + seeding sample images"
npm install --no-audit --no-fund >/dev/null
node seed.mjs

if [ "${KIP_BUILD:-1}" != "0" ]; then
  echo "==> Building KIP (${KIP_DIR})"
  ( cd "$KIP_DIR" && npm run build:prod )
fi
[ -f "${KIP_PUBLIC_DIR}/index.html" ] || { echo "!! no built KIP at ${KIP_PUBLIC_DIR} (build it, or set KIP_BUILD=1)"; exit 1; }

echo "==> Serving the built KIP on :${KIP_PORT}"
node kip/serve-kip.mjs &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -fsS "${KIP_URL}" >/dev/null 2>&1 && break; sleep 0.5; done

echo "==> Installing Playwright chromium (first run only)"
npx playwright install chromium >/dev/null

echo "==> Capturing the KIP Image-widget config screenshot"
node kip/capture-kip.mjs

echo "==> Done -> ../docs/images/kip-widget-config.webp"
