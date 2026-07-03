# HTTP API

All routes are served by the Signal K server under `/plugins/sk-image`. When server security is enabled, the mutating routes (upload, delete, cache purge) require an authenticated request; read routes are available to any client that can read data.

## `GET /config`

Capabilities discovery. Clients read this instead of hard-coding limits.

```json
{
  "widthAllowlist": [160, 320, 640, 960, 1280, 1920, 2560],
  "supportedFormats": ["svg", "jpeg", "png", "webp", "gif", "heic"],
  "maxUploadBytes": 10485760,
  "maxImageCount": 500,
  "maxTotalOriginalBytes": 524288000,
  "maxCacheBytes": 5368709120
}
```

## `POST /images`

Upload an image. `multipart/form-data` with a single `file` field. **Login required.**

- The type is detected from content (magic bytes), not the filename or MIME type.
- Returns `201` with the stored metadata (`id`, `name`, `format`, `width`, `height`, `bytes`, `animated`, `createdAt`) plus a relative `url`.
- Errors: `401` (not logged in), `413` (over the size limit), `415` (unsupported / unsafe content).

## `GET /images`

List the shared library — an array of image metadata, oldest first.

## `GET /images/:id?w=<width>`

Serve an image. Raster images are re-encoded to WebP and resized to the nearest allow-listed width (`w` snaps up; omit it for the largest variant). SVGs are served sanitized. Variants are cached on disk and returned with long-lived immutable cache headers. Returns `404` for an unknown id, `400` for a malformed id.

## `DELETE /images/:id`

Delete an image — original bytes, metadata, and cached variants. **Login required.** `404` if the id doesn't exist.

## `GET /images/cache`

Report the generated-variant cache: `{ "bytes": <number>, "files": <number> }`.

## `DELETE /images/cache`

Purge generated variants (originals are kept and regenerate on demand). **Login required.**
