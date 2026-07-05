# Configuration

SK Image is configured from its plugin config screen in the Signal K admin UI.

## Max resized-image cache size

The disk budget for generated (resized / re-encoded) image variants. Originals are **not** counted against this budget.

- Default: **1 GiB** (`1073741824` bytes).
- Choose from presets: 512 MiB, **1 GiB** (default), 2 GiB, 4 GiB, or 8 GiB.

When the cache would exceed this size, the least-recently-used variants are evicted. Variants always regenerate on demand, so eviction never loses anything permanent.

## Purging the cache

You can clear all generated variants at any time (from the admin UI, the KIP settings card, or `DELETE /signalk/v1/api/sk-image/images/cache`). This frees disk immediately; variants regenerate the next time an image is requested. Your original uploads are never affected.

## Storage location

Images and the metadata database are stored under the plugin's data directory (`<signalk-data>/plugin-config-data/sk-image/`):

- `originals/` — the uploaded image bytes, named by a generated id.
- `cache/` — generated WebP variants (safe to delete; this is what "purge" clears).
- `metadata.db` — the SQLite metadata index (rebuildable from the originals).
