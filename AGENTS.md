# AGENTS.md

A terse map of this repo for AI agents and new contributors.

## What this is

A Signal K server plugin (CommonJS, TypeScript) that stores and serves a vessel image library: secure upload + content validation, on-demand resize/re-encode to WebP, a size-capped on-disk cache, and a REST API served on two mounts — `/signalk/v1/api/sk-image` (crew-reachable) and `/plugins/sk-image` (admin-only alias under security) — plus a v2 `images` resource type. Image bytes live on disk; metadata lives in an SQLite database (`node:sqlite`) beside them.

## Commands

```bash
npm run build          # tsc -> dist/
npm run build:webapp   # build the React web app -> public/
npm test               # vitest run
npm run test:coverage  # vitest + v8 coverage (thresholds enforced)
npm run lint           # eslint (flat config)
npm run format         # prettier --write .
```

## Source layout

- `src/index.ts` — plugin entry (`export = (app) => Plugin`): id/name/schema, lazy store + worker pool, both route mounts (`registerWithRouter` + `signalKApiRoutes`), and the v2 resource-provider registration.
- `src/images/image-router.ts` — Express routes + auth gate + the `/config` capabilities endpoint. Takes a `basePath` so the same routes serve both mounts.
- `src/images/image-resources.ts` — the read-only v2 `images` resource provider (metadata projection; no GPS, no writes).
- `src/images/image-store.ts` — validation, storage, on-demand serving, cache stats/purge. No Express.
- `src/images/metadata-store.ts` — SQLite metadata layer (isolated so the driver is swappable).
- `src/images/image-processing.ts` — pure convert/resize (sharp + heic-convert), width allow-list.
- `src/images/exif.ts` — EXIF extraction (exifr) on upload.
- `src/images/worker-pool.ts` / `image-worker.ts` — worker-thread pool for image processing.
- `webapp/` — the React + Vite web-app library (its own project; builds to `public/`, served at `/sk-image`).
- Tests are `src/**/*.spec.ts`; worker tests use `src/images/__fixtures__/fake-worker.cjs`.

## Conventions

- Node >= 22.13 (the built-in `node:sqlite` is un-flagged from Node 22.13). CommonJS output (`module: node16`, no `"type"`).
- Vitest specs co-located with source. Add a failing spec before implementing.
- Conventional Commits; releases via semantic-release.
- Prettier (single quotes, width 100) + ESLint flat config gate every change.

## Security invariants (do not weaken)

- Upload type is decided by **content sniffing**, never the client filename or MIME.
- Raster originals are **never** served raw — always re-encoded to WebP on the way out.
- SVGs are **sanitized** (DOMPurify) on ingest; scripts/event handlers/external refs are stripped.
- On-disk names are generated UUIDs; the client filename is stored only as display metadata, never used to build a path.
- Upload / delete / cache-purge require **read-write or admin permission** (via `isAuthorizedWriter` in `src/images/sk-request.ts`) when server security is on — an authenticated read-only principal is rejected. On the crew-reachable `/signalk/v1/api/sk-image` mount the server adds no write middleware, so this in-handler check is the only write gate (on `/plugins/sk-image` the server also admin-gates the whole mount). The v2 resource provider has no request principal, so it is read-only and never exposes GPS.
