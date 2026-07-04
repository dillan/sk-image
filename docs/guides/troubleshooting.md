# Troubleshooting

Common problems and their fixes. Work top to bottom within a section — the first item in each is the most likely cause.

---

## Installation and startup

### The web app won't load, or you get a 404 at `/sk-image`

The plugin is probably installed but not enabled, or the server has not been restarted since you installed it. Open **Server → Plugin Config**, enable **SK Image**, then restart the Signal K server and reload the page.

### The Appstore can't install it

Installing pulls the package from npm, so the server needs internet access on first install. Check the machine's connection (and any proxy or firewall), then try **Appstore → SK Image → Install** again.

### It won't start, or asks for a newer Node

SK Image needs **Node 24 or newer** because it uses Node's built-in SQLite. Run `node -v`; if it is below 24, upgrade Node on the server and restart Signal K. Some appliances lag behind on Node — notably the **Victron Cerbo GX / Venus OS**, which ships Node 20 — and can't run SK Image until they update to Node 24.

---

## Uploads

### Uploads fail with "login required" (401)

Your Signal K server has security enabled, so uploading requires an authenticated account with write access. Sign in to Signal K (the web app uses your session cookie), or ask an admin to grant your account write permission.

### An upload is rejected as unsupported (415)

The file is not one of the supported types — **JPEG, PNG, WebP, GIF, HEIC/HEIF, or SVG** — or it is a non-image renamed to look like one. SK Image decides the type by sniffing the file's content, not its name or extension, so renaming a file will not get it in.

### An upload is too large (413)

The file is over the **10 MB** per-upload limit. Resize or re-compress it below 10 MB and try again.

---

## Display

### Images look slightly different after upload

This is expected. Raster images are always re-encoded to WebP when served, so fine detail, color, or compression can shift slightly from the original; your original bytes are kept untouched on disk.

---

> **Note:** When a problem is not covered here, check the plugin's log. Open **Server → Plugin Config → SK Image** and expand the log panel — validation errors, cache activity, and startup messages are recorded there.

## Where to next

- [Configuration](../reference/configuration.md) — the cache-size setting and how to purge the cache.
- [HTTP API](../reference/http-api.md) — status codes and the full endpoint list.
