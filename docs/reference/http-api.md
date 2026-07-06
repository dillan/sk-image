# HTTP API

**Base path.** The routes below are published on two mounts:

- **`/signalk/v1/api/sk-image`** — the primary mount (what the web app uses). It is _not_ admin-gated, so on a secured server ordinary crew can reach it: read-only accounts can browse, read-write accounts can manage.
- **`/plugins/sk-image`** — a backward-compatible alias. On a secured server the Signal K server admin-gates every `/plugins/*` route, so this mount is **admin only**. Prefer the `/signalk/v1/api/sk-image` path.

The paths in each section below are relative to whichever base you use.

When server security is enabled, the mutating routes (upload, delete, cache purge, collection edits) require **write access** — a read-write or admin principal. A denied write returns `401` for an anonymous request (log in) or `403` for a logged-in read-only account (your account lacks write access). Read routes are available to any client that can read Signal K data.

Image metadata is additionally published as a v2 resource type — see [Resource API](#resource-api-v2) at the bottom.

## `GET /config`

Capabilities discovery. Clients read this instead of hard-coding limits.

```json
{
  "widthAllowlist": [160, 320, 640, 960, 1280, 1920, 2560],
  "supportedFormats": ["svg", "jpeg", "png", "webp", "gif", "heic"],
  "maxUploadBytes": 10485760,
  "maxImageCount": 500,
  "maxTotalOriginalBytes": 524288000,
  "maxCacheBytes": 1073741824
}
```

## `GET /revision`

A cheap change token: `{ "revision": <number> }`. It changes whenever the library or collections change (upload, delete, or a collection edit). The web app polls it and refreshes when it moves, so a change made in one browser shows up in another. Read-only.

## `POST /images`

Upload an image. `multipart/form-data` with a single `file` field. **Write access required.**

- The type is detected from content (magic bytes), not the filename or MIME type.
- Returns `201` with the stored metadata (`id`, `name`, `format`, `width`, `height`, `bytes`, `animated`, `createdAt`) plus a relative `url`.
- Errors: `401` (not logged in), `403` (logged in without write access), `413` (over the size limit), `415` (unsupported / unsafe content).

## `GET /images`

List the library — an array of image metadata. Optional query parameters:

- `sort` — `name` or `date` (capture date, falling back to upload time). Default: upload order.
- `order` — `asc` or `desc`. Default: `asc`.
- `collection` — a collection id to list only that collection's images.

Each item includes EXIF-derived fields when present: `captureDate`, `lat`, `lon`, `cameraMake`, `cameraModel`, `orientation`, and the audit field `uploadedBy`. On a secured server, capture GPS (`lat`/`lon`) and the uploader's username (`uploadedBy`) are omitted for anonymous clients — only logged-in users see them. (On an unsecured server everything is returned.)

## `GET /images/:id?w=<width>`

Serve an image. Raster images are re-encoded to WebP and resized to the nearest allow-listed width (`w` snaps up; omit it for the largest variant). SVGs are served sanitized. Variants are cached on disk and returned with long-lived immutable cache headers. Returns `404` for an unknown id, `400` for a malformed id.

## `GET /images/:id/exif`

The full raw EXIF tag set for one image (or `null` when none was captured). Because raw EXIF can contain capture GPS, on a secured server this **requires a logged-in user** — an anonymous request gets `401`. `404` for an unknown id.

## `DELETE /images/:id`

Delete an image — original bytes, metadata, and cached variants. **Write access required.** `404` if the id doesn't exist.

## `GET /images/cache`

Report the generated-variant cache: `{ "bytes": <number>, "files": <number> }`.

## `DELETE /images/cache`

Purge generated variants (originals are kept and regenerate on demand). **Write access required.**

## Collections

Group images into named collections (an image can be in many). All mutations require write access (read-write or admin).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/collections` | List collections with image counts |
| `POST` | `/collections` | Create — body `{ "name": "..." }`, returns the collection |
| `PUT` | `/collections/:id` | Rename — body `{ "name": "..." }` |
| `DELETE` | `/collections/:id` | Delete the collection (images are kept) |
| `POST` | `/collections/:id/images/:imageId` | Add an image to a collection |
| `DELETE` | `/collections/:id/images/:imageId` | Remove an image from a collection |

Filter the library to a collection with `GET /images?collection=<id>`.

## Resource API (v2)

Image metadata is also exposed as the custom **`images`** resource type, so it shows up in the Signal K admin UI's resource browser and is discoverable by generic v2 clients:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/signalk/v2/api/resources/images` | List image metadata keyed by id; each doc carries a `url` to fetch the bytes |
| `GET` | `/signalk/v2/api/resources/images/:id` | One image's metadata |

This layer is **read-only** (uploads and deletes go through `POST`/`DELETE /images`) and — because a resource provider has no request principal to authorize against — it **never** includes capture GPS (`lat`/`lon`) or the uploader (`uploadedBy`) for anyone. Each doc's `url` points at `/signalk/v1/api/sk-image/images/:id`. To read capture location or raw EXIF, use the REST routes above as a logged-in user.

## Web app

The plugin ships a web-app image library, served by the Signal K server at `/sk-image`, that uses the `/signalk/v1/api/sk-image` endpoints. It authenticates with the Signal K session cookie, so on a secured server the same crew who can read Signal K data can browse the library, and read-write crew can manage it.
