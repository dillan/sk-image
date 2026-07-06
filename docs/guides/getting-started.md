# Getting started

This guide takes you from nothing to a working image library. It assumes you already have a **Signal K server** running on your boat (on a Raspberry Pi, a Cerbo GX, a small PC, or similar), and that it runs on **Node 22.13 or newer**.

If you're not sure what Signal K is: it's the free open-source software many boats run to collect and share their instrument data (GPS, depth, wind…). SK Image is an add-on for it that stores and serves a shared photo library for the whole boat.

---

## 1. Install the plugin

### The easy way — the Appstore

1. Open your Signal K server's web admin (usually `http://<your-server>:3000`).
2. Go to **Appstore → Available**.
3. Search for **SK Image** and click **Install**.
4. Restart the server when it asks you to.

### From source

On the server, in a terminal:

```bash
cd ~/.signalk
npm install sk-image
```

Then restart Signal K.

> **Note:** SK Image needs **Node 22.13 or newer** (it uses the built-in `node:sqlite`, which is available without a flag from Node 22.13). It also needs internet access on first install to download its dependencies. After that it works offline.

---

## 2. Switch it on

1. In the Signal K admin, go to **Server → Plugin Config**.
2. Find **SK Image** in the list and switch it **On**.
3. Click **Submit**.

There is nothing else to fill in here. The one setting the plugin has is **Max resized-image cache size**, and its default is fine to start with — you can revisit it later under [Configuration](../reference/configuration.md).

---

## 3. Open the image library

SK Image ships its own web app, served by your boat's server, so there's nothing extra to install.

1. In a browser on the same network, go to `http://<your-server>:3000/sk-image`.
2. The app opens to the **Library**. It's empty until you upload your first photo.

<p align="center"><img src="../images/library.webp" alt="The SK Image library view showing a grid of photo thumbnails with a sort control and collection chips along the top." width="85%"></p>

The web app signs you in with your existing Signal K session — there's no separate login. If you aren't signed in yet, it sends you to the server's login page and back.

You don't have to use the web app: SK Image also backs the **Image** widget in [KIP](https://github.com/mxtommy/Kip), so the same photos can appear on your instrument dashboard. See [The KIP widget](the-kip-widget.md).

---

## What just happened?

You installed a plugin, turned it on, and opened its library. The photos you upload from here live **on the boat's server**, not in one browser — so every phone, tablet, and laptop on the boat sees the same library. The plugin re-encodes each photo to a web-friendly size on demand and caches the result, so pictures load fast even on a slow cabin network.

---

## Where to next

- [The app](the-app.md) — a tour of the Library, Collections, and Settings views.
- [Uploading images](uploading-images.md) — add your first photos and learn the size and format limits.
- [The KIP widget](the-kip-widget.md) — show your library on a KIP dashboard.
- [Troubleshooting](troubleshooting.md) — if the app won't open or an upload is rejected.
