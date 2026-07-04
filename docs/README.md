# SK Image documentation

Plain-language guides for boaters, plus developer docs for anyone working on the plugin. New here? Start with [Getting started](guides/getting-started.md).

## For boaters

- [Getting started](guides/getting-started.md) — install the plugin, switch it on, and open the library.
- [The app](guides/the-app.md) — a tour of the Library, Collections, and Settings views.
- [Uploading images](guides/uploading-images.md) — add photos, with the supported formats and limits.
- [Organizing with collections](guides/collections.md) — group images and filter the library.
- [Finding images](guides/finding-images.md) — sort, filter, and read an image's details and EXIF.
- [The KIP widget](guides/the-kip-widget.md) — show a library image on a KIP dashboard.
- [Troubleshooting](guides/troubleshooting.md) — quick fixes for the common snags.

## Reference

- [HTTP API](reference/http-api.md) — every REST endpoint, parameter, and status code.
- [Configuration](reference/configuration.md) — the plugin's cache-size option and what purge does.

## For developers

Start with the [Architecture overview](developers/architecture.md), then follow the flow you're changing. See also [`../AGENTS.md`](../AGENTS.md) for a source-tree map and commands, and [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the contribution workflow.

- [Architecture overview](developers/architecture.md) — the component map and where each concern lives.
- [Request flows](developers/request-flows.md) — upload and serve-with-cache, as sequence diagrams.
- [Storage & data model](developers/storage-and-data.md) — the disk layout, the SQLite schema, and the variant cache.
- [Security model](developers/security-model.md) — the invariants every change must keep, and how uploads are validated.
- [Widget auto-install](developers/auto-install.md) — how KIP installs, enables, and restarts to load the plugin.
- [Screenshots](developers/screenshots.md) — the Docker + Playwright pipeline that keeps these docs' images fresh.
