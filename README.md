# SK Image

**Your boat's image library, served by Signal K.**

[![CI](https://github.com/dillan/sk-image/actions/workflows/ci.yml/badge.svg)](https://github.com/dillan/sk-image/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)

SK Image is a Signal K server plugin that stores and serves images for your vessel — logos, cabin diagrams, deck plans, safety cards, reference photos. It validates uploads, re-encodes and resizes them to WebP on demand, keeps a size-capped disk cache, and exposes a small REST API. It ships its own web-app image library — browse, upload, view EXIF, and organize into collections — served at `/sk-image`, and is also built to back the KIP **Image** widget.

**Documentation:** start with [Getting started](docs/guides/getting-started.md), or browse the [full docs](docs/README.md) — boater guides, the HTTP API reference, and developer docs with architecture and sequence diagrams.

## Why you need it

- **One shared library.** Upload once; every dashboard and device on the boat can display it.
- **Fast, right-sized images.** Originals are re-encoded to WebP and resized to the width each screen actually needs, then cached on disk so repeat views are instant.
- **Safe by default.** Uploads are validated by content (not filename), raster images are always re-encoded, and SVGs are sanitized — so a malicious upload can't run scripts or phone home.

## What you'll need

- A Signal K server, version 2 or newer, running on **Node.js 22.13 or newer** — required by the plugin's built-in SQLite (`node:sqlite`). Devices still on Node.js 20 (including the **Victron Cerbo GX / Venus OS**) can't run it yet.
- Enough disk for your originals plus the resize cache (the cache size is configurable; default 1 GiB).

## Install

Install **SK Image** from the Signal K **Appstore**, then enable it and restart the server.

Or install manually:

```bash
npm install sk-image
```

## How to use it

Once enabled, the plugin serves its API under `/signalk/v1/api/sk-image` (reachable by ordinary crew on a secured server; a `/plugins/sk-image` alias also exists but is admin-only under security):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/signalk/v1/api/sk-image/config` | Capabilities (supported widths, size limits) |
| `POST` | `/signalk/v1/api/sk-image/images` | Upload an image (write access required) |
| `GET` | `/signalk/v1/api/sk-image/images` | List the library |
| `GET` | `/signalk/v1/api/sk-image/images/:id?w=<width>` | Serve a resized WebP variant (or sanitized SVG) |
| `DELETE` | `/signalk/v1/api/sk-image/images/:id` | Delete an image (write access required) |
| `GET` | `/signalk/v1/api/sk-image/images/cache` | Cache size + file count |
| `DELETE` | `/signalk/v1/api/sk-image/images/cache` | Purge generated variants (write access required) |

Image metadata is also published as the v2 `images` resource type at `/signalk/v2/api/resources/images` (read-only, no GPS). See [`docs/reference/http-api.md`](docs/reference/http-api.md) for details.

## Good to know

- Requested widths snap to a fixed allow-list, so the cache stays bounded and browser caching lines up across devices. Clients discover the list from `GET /config` rather than hard-coding it.
- Purging the cache only removes generated variants — your originals are untouched and variants regenerate on demand.

## Configuration

The only setting is the resize-cache budget, edited on the plugin's config screen:

- **Max resized-image cache size** — disk budget for generated variants (default **1 GiB**). Originals are not counted against it.

See [`docs/reference/configuration.md`](docs/reference/configuration.md).

## Troubleshooting

- **Uploads return 401** — the server has security enabled and you're not logged in. Log in, or grant the account write access.
- **The Appstore can't install it** — the server needs internet access to reach the npm registry.

---

## For developers

```bash
npm install        # install deps + git hooks
npm run build      # compile the plugin to dist/
npm test           # run the unit tests (vitest)
npm run lint       # eslint
npm run format     # prettier --write
```

Source lives in `src/` and compiles to `dist/` (the published entry is `dist/index.js`). Image bytes are stored on disk under the plugin's data dir; metadata lives in an SQLite database beside them. See [`AGENTS.md`](AGENTS.md) for a source-tree map and the security invariants.

The developer docs go deeper, with diagrams:

- [Architecture overview](docs/developers/architecture.md) — the component map and where each concern lives.
- [Request flows](docs/developers/request-flows.md) — upload and serve-with-cache as sequence diagrams.
- [Storage & data model](docs/developers/storage-and-data.md) — disk layout, the SQLite schema, and the variant cache.
- [Security model](docs/developers/security-model.md) — the invariants every change must keep.
- [Widget auto-install](docs/developers/auto-install.md) — how KIP installs and enables the plugin.
- [Screenshots](docs/developers/screenshots.md) — the Docker + Playwright pipeline that refreshes the docs' images.

### Run your changes against a Signal K server

Build, then symlink the working copy into the server's modules so it loads your local build:

```bash
npm run build
ln -s "$(pwd)" ~/.signalk/node_modules/sk-image
# restart the Signal K server, then enable "SK Image" in the plugin config
```

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[MIT](LICENSE) © Dillan Laughlin
