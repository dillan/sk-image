# e2e — documentation screenshot harness

A Docker + Playwright harness that captures fresh screenshots of the SK Image web app for the docs. It builds the plugin, runs it inside a real Signal K server, seeds synthetic sample data, drives the UI, and writes WebP images into `../docs/images/`.

For the full picture of how this fits the docs, see [`../docs/developers/screenshots.md`](../docs/developers/screenshots.md).

## Prerequisites

- **Docker** (with Compose v2) running.
- **Node.js** on the host (to run the seed, Playwright, and the WebP conversion). You do **not** need Node 24 or a configured Signal K server — the container provides those.

## Run it

```bash
cd e2e
./capture.sh            # build, start the stack, seed, capture, convert, copy into ../docs/images/
./capture.sh --down     # stop and remove the stack
```

The first run is slower: it builds the Docker image (installing the plugin's Linux-native dependencies), downloads the Chromium build for Playwright, and pulls the base Signal K image. Later runs reuse all of that.

Override the port with `SIGNALK_PORT` (default `3007`):

```bash
SIGNALK_PORT=3010 ./capture.sh
```

### The KIP widget screenshot

The KIP **Image** widget's configuration screenshot comes from a separate app (KIP), so it has its own script. It needs a KIP checkout that includes the Image widget:

```bash
KIP_DIR=/path/to/kip ./capture-kip.sh
```

This reuses the Docker SK Image server, builds and serves the KIP app, and drives it with Playwright to write `../docs/images/kip-widget-config.webp`. See [`../docs/developers/screenshots.md`](../docs/developers/screenshots.md) for how it works.

## Authorization matrix (secured server)

A separate, API-only Playwright spec (`auth/authz-matrix.spec.ts`) pins how the plugin's REST API behaves when the Signal K server has **security enabled**, across both mounts. It documents two facts: (1) signalk-server admin-gates **all** `/plugins/*` routes, so the `/plugins/sk-image/*` alias is **admin-only** under security; and (2) `/signalk/v1/api/sk-image/*` is **not** admin-gated, so ordinary crew reach it and the plugin's own auth applies — reads are open, writes need read-write/admin (anonymous → `401`, logged-in read-only → `403`). It also checks the v2 `images` resource type (crew-readable, no GPS) and that the `/sk-image` web app bundle loads for crew.

It runs against the `signalk-secured` compose service (security on, three baked test users — `admin`/`adminpw` (admin), `writer`/`writerpw` (readwrite), `reader`/`readerpw` (readonly) — and `allow_readonly` on):

```bash
cd e2e
docker compose up -d --build signalk-secured        # secured server on :3008
SIGNALK_SECURED_URL=http://localhost:3008 npm run authz
docker compose down
```

The users, secret key, and strategy live in `signalk-config-secured/` (test-only values). See [`../docs/developers/security-model.md`](../docs/developers/security-model.md) for the full access model — why the plugin's own in-handler auth is the effective gate on the crew-reachable mount and only defense-in-depth on the admin-gated `/plugins` alias.

## What it does

`capture.sh` runs these steps in order:

1. `npm run build && npm run build:webapp` in the repo root, producing `dist/` and `public/`.
2. `docker compose up -d --build` — builds an image from `Dockerfile` (Signal K server + the plugin installed with its Linux deps + baked config) and starts it with security off.
3. Polls `GET /plugins/sk-image/config` until the plugin answers.
4. `node seed.mjs` — generates sample images with `sharp` and uploads them, then creates a few collections, over the plugin's HTTP API. Idempotent: it skips if the library already has images.
5. `npm run screenshots` — Playwright drives the web app at `/sk-image` and writes PNGs to `screenshots/out/`.
6. `node scripts/to-webp.mjs` — converts the curated PNGs to WebP and copies them into `../docs/images/`.

## Sample data

The seed data is entirely synthetic and safe to commit:

- Images are generated from scratch (technical "diagrams" and gradient "photos"), never sourced from a real boat.
- The "photo" files carry only made-up EXIF — a fictional camera make/model and a fixed capture date.
- The server identifies as `Test Vessel` with MMSI `000000000`.

No real hostnames, positions, vessel names, or personal data appear anywhere in this directory.

## Troubleshooting

- **`npm error ETIMEDOUT` during install** — a transient network hiccup fetching Playwright or its browser. The Docker stack is already up; just re-run `./capture.sh` (the build + image steps are cached and the seed is idempotent).
- **The plugin never answers** — check the server logs: `docker compose logs --tail=60 signalk`. A Node-version or native-dependency error shows up here.
- **A capture step fails on a selector** — the web app UI changed. Update the matching `test(...)` in `screenshots/webapp.spec.ts`.

## Layout

| Path | Role |
| --- | --- |
| `capture.sh` | orchestration entry point |
| `Dockerfile` | Signal K server image with the plugin + Linux deps + baked config |
| `docker-compose.yml` | builds and runs the stack |
| `signalk-config/` | the baked `settings.json` and `plugin-config-data/sk-image.json` |
| `seed.mjs` | generates and uploads sample images + collections |
| `screenshots.config.ts` | Playwright configuration |
| `screenshots/webapp.spec.ts` | the capture specs |
| `screenshots/harness.ts` | the `shot()` helper |
| `scripts/to-webp.mjs` | PNG → WebP conversion into `../docs/images/` |
| `capture-kip.sh` | captures the KIP Image-widget config screenshot (needs a KIP checkout) |
| `kip/serve-kip.mjs` | static server for a built KIP app |
| `kip/capture-kip.mjs` | Playwright capture of the KIP widget config dialog |
