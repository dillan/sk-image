# Uploading images

Every picture in your shared boat library starts with an upload. You add images from the web app, and the server stores your original untouched while serving safe, resized copies to everyone else on board. This guide walks through the upload flow, the formats you can use, and what happens to a file once the server has it.

---

## Upload from the web app

Open the web app at `/sk-image` and go to **Library**. Then:

1. Select **Upload**, or **drag files straight onto the Library** and drop them.
2. Pick **one or more** files from your device.
3. Watch the progress panel — it shows overall percent, transfer speed, and estimated time remaining, with a per-file list beneath. Each image appears in the library as it finishes; if one file fails (for example it's too large), the rest keep going and the failed one is flagged.

<p align="center"><img src="../images/library.webp" alt="The Library view with the Upload button and a grid of image thumbnails." width="85%"></p>

If you are not signed in, the web app sends you to `/admin/#/login` first. Uploading needs an authenticated session whenever server security is on.

---

## Supported formats

You can upload these formats:

- **JPEG**
- **PNG**
- **WebP**
- **GIF**
- **HEIC/HEIF**
- **SVG**

> **Note:** HEIC and HEIF photos from phones are converted once, on upload. SVG files are sanitized on upload so they can be served safely as vector images.

---

## Limits

Uploads are capped to keep the library light on a boat's storage:

| Limit             | Value              |
| ----------------- | ------------------ |
| Per file          | 10 MB              |
| Library images    | up to 500          |
| Library originals | up to 500 MB total |

Once you hit a cap, delete some images to make room before uploading more.

---

## What the server does with your image

The server never serves your original file back to viewers. Instead:

- It keeps your original bytes on disk, unchanged.
- When a client asks for the image, it re-encodes and resizes a copy to WebP on demand.
- Those resized copies are cached, so repeat requests are fast.

This means the picture you see in the library or a KIP widget is always a fresh, safe re-encoding, not the raw file you sent.

> **Note:** The server decides an upload's type by reading its actual bytes, not its filename or the MIME type your browser reports. A file renamed to `.jpg` is still checked by its real content.

---

## Where to next

- [Organizing images into collections](collections.md)
- [Finding images](finding-images.md)
