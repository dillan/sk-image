// Minimal static server for a built KIP app (Angular, base href /@mxtommy/kip/), used only by the
// KIP-widget screenshot capture. Serves KIP_PUBLIC_DIR under the /@mxtommy/kip/ path prefix so KIP
// boots exactly as it would when served by a Signal K server. No dependencies.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const DIR = process.env.KIP_PUBLIC_DIR && resolve(process.env.KIP_PUBLIC_DIR);
const PORT = Number(process.env.KIP_PORT || 4300);
const PREFIX = '/@mxtommy/kip';

if (!DIR) {
  console.error('KIP_PUBLIC_DIR is required (path to a built KIP public/ directory).');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === PREFIX) {
      res.writeHead(302, { Location: `${PREFIX}/` });
      return res.end();
    }
    if (!path.startsWith(`${PREFIX}/`)) {
      res.writeHead(404);
      return res.end('not found');
    }
    const rel = path.slice(PREFIX.length + 1) || 'index.html';
    let file = normalize(join(DIR, rel));
    if (!file.startsWith(DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(DIR, 'index.html'); // hash routing: fall back to the app shell
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, () => console.log(`KIP served at http://localhost:${PORT}${PREFIX}/`));
