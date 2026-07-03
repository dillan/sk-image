# A Signal K server with the built SK Image plugin installed for THIS platform (its native sharp
# binary), pre-enabled, and running with no security (anonymous read/write) — a turnkey, reproducible
# stack for capturing documentation screenshots. Do not expose it.
#
# Build context is the repo root (see docker-compose.yml): dist/ and public/ must be built first.
FROM signalk/signalk-server:latest

USER node

# Install the built plugin into the server's plugin dir. We fetch runtime deps for the container's
# platform (sharp's prebuilt Linux binary, jsdom, …) rather than reusing the host's macOS
# node_modules. --ignore-scripts mirrors how the Signal K App Store installs plugins (sharp's binary
# still arrives as an optional dependency, no build step needed).
WORKDIR /home/node/.signalk/node_modules/sk-image
COPY --chown=node:node package.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node public ./public
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# Seed server + plugin config so the plugin boots enabled, with no security.
COPY --chown=node:node e2e/signalk-config/settings.json /home/node/.signalk/settings.json
COPY --chown=node:node e2e/signalk-config/plugin-config-data/sk-image.json /home/node/.signalk/plugin-config-data/sk-image.json

WORKDIR /home/node
