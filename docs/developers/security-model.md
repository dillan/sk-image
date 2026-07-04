# Security model

SK Image accepts untrusted files and serves them back into everyone's browser. It runs unattended on a shared boat: any crew member with an account can upload, and everyone else views the result. An uploaded file is never trusted for what it claims to be — a `.jpg` might be an HTML page, a PNG might be a polyglot, an SVG might carry a `<script>`. This page is the contract: **the invariants every change must keep**, and the mechanisms in `src/images/image-store.ts` and `src/images/image-router.ts` that enforce them.

> **Reviewing a PR? This is your checklist.** A new route, format, or serve path that breaks one of these is a security regression even if every test still passes:
>
> 1. **Type is decided by a content sniff of the bytes — never the filename or the client's `Content-Type`.** The extension and MIME header are display data at most; they never pick a code path.
> 2. **Raster originals are never served raw.** Everything raster goes back out re-encoded to WebP; the stored original bytes are never streamed to a browser.
> 3. **SVG is sanitized on ingest with DOMPurify.** Scripts, event handlers, and external references are stripped before it's stored; what's on disk is already safe to serve.
> 4. **On-disk names are generated UUIDs.** The client filename is kept only as display metadata — it never touches a filesystem path.
> 5. **Upload, delete, and purge require read-write or admin permission** when the server has security enabled — an authenticated _read-only_ principal (including the anonymous one the server attaches under "Allow Readonly Access") is rejected.
> 6. **Served images carry `X-Content-Type-Options: nosniff` and a strict CSP,** so a browser can't be tricked into re-interpreting a response.

---

## The ingest gate

Every upload runs the same validation before a single byte is persisted. The decision is driven entirely by the leading **magic bytes**, not by anything the client asserts.

```mermaid
flowchart TD
  U[upload bytes] --> Sniff{content sniff<br/>magic bytes}
  Sniff -- unknown --> Reject[415 reject]
  Sniff -- SVG --> San[DOMPurify sanitize]
  San -- empty after --> Reject
  San -- ok --> StoreV[store as vector]
  Sniff -- HEIC --> Heic[transcode to WebP once<br/>proves it decodes]
  Heic -- fails --> Reject
  Heic -- ok --> StoreR
  Sniff -- raster --> Probe[sharp probe dimensions]
  Probe --> Quota{within quota?}
  Quota -- no --> Reject2[reject: full / too big]
  Quota -- yes --> StoreR[store original;<br/>re-encode on serve]
```

What falls out of this shape:

- **Unknown means rejected, not guessed.** If the sniff doesn't recognize the bytes, the upload is refused with `415` — there is no "trust the extension" fallback.
- **SVG can't survive ingest with anything executable in it.** DOMPurify runs before storage, and if sanitizing leaves nothing, the upload is rejected rather than stored empty. The file on disk is already the sanitized vector, so the serve path has nothing left to clean up.
- **HEIC has to prove it decodes.** It's transcoded to WebP once at ingest; a file that only pretends to be HEIC fails that transcode and is rejected before it's ever stored.
- **Raster is bounded before it's kept.** `sharp` probes the real dimensions, and the library quota (image count and total bytes of originals) is checked before the original is written. The original is stored, but every request for it re-encodes to WebP on the way out.

---

## Other mechanisms at a glance

| Concern | Mechanism | File |
| --- | --- | --- |
| Spoofed type / polyglot upload | content sniff on magic bytes; filename and `Content-Type` are never trusted | `src/images/image-store.ts` |
| Executable raster tricks on serve | raster originals never served raw; always re-encoded to WebP with a snapped width | `src/images/image-store.ts` |
| Active content in SVG | DOMPurify sanitize on ingest; scripts, handlers, and external refs stripped | `src/images/image-store.ts` |
| Browser MIME re-sniffing | `X-Content-Type-Options: nosniff` + strict CSP on every image response | `src/images/image-router.ts` |
| Path traversal via client filename | on-disk names are generated UUIDs; the client filename is stored only as display metadata | `src/images/image-store.ts` |
| Unauthenticated mutation | upload / delete / cache-purge require read-write or admin permission when server security is on | `src/images/sk-request.ts` |
| Disk / memory exhaustion | max upload size + library caps (image count and total originals) enforced at ingest | `src/images/image-store.ts` |

---

## Known residual notes

- **The write gate is the plugin's own, not the server's.** Signal K mounts plugin routers _without_ write middleware, so the in-handler check in `src/images/sk-request.ts` (`isAuthorizedWriter`) is the only thing between an anonymous request and a mutation. It authorizes on the principal's permission — read-write or admin — mirroring the server's own write rule, and fails closed: a request without write permission is rejected. This matters because the server marks an anonymous visitor as _authenticated_ with `permissions: 'readonly'` when "Allow Readonly Access" is enabled; gating on mere authentication would let that visitor write.
- **Reads are open, but capture location is not public.** Listing and viewing images are not auth-gated — the library is meant to be shared across the boat. Capture GPS is more sensitive, so on a **secured** server the per-image `lat`/`lon` are stripped from the listing and the raw EXIF endpoint (`GET /images/:id/exif`) requires a logged-in user (`canReadSensitiveMetadata` in `sk-request.ts`); an **unsecured** server leaves everything open. Only the state-changing routes (upload, delete, purge) require write permission. If you add a route that exposes per-image metadata, gate location the same way; if it mutates state, gate it for write access.
- **Sanitizing depends on the sniff being right first.** SVG is only sanitized because it was sniffed as SVG. Anything that would let a non-SVG code path serve raw stored bytes would route around DOMPurify — which is why invariant (2), "raster originals are never served raw," is load-bearing for the SVG story too.

---

## Where to next

- [Storage and data](storage-and-data.md) — where originals, cache variants, and metadata live, and how a corrupt index is quarantined.
- [HTTP API](../reference/http-api.md) — the routes these invariants gate.
- [Configuration](../reference/configuration.md) — the cache budget and how purge relates to it.
