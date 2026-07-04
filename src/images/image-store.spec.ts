import { afterAll, describe, expect, test } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  ImageStore,
  detectImageType,
  sanitizeSvg,
  ImageValidationError,
  MAX_UPLOAD_BYTES,
} from './image-store';
import { inProcessProcessor, type ImageProcessor, type ProcessRequest } from './image-processing';

const TMP_ROOT = resolve('.tmp-sk-image-store-test');
const freshDir = (): string => join(TMP_ROOT, randomUUID());

// Track every store so we can close its SQLite handle before removing the temp dir — otherwise the
// open db file blocks rmSync on Windows (EPERM).
const opened: ImageStore[] = [];
function trackStore(...args: ConstructorParameters<typeof ImageStore>): ImageStore {
  const store = new ImageStore(...args);
  opened.push(store);
  return store;
}
function freshStore(): { store: ImageStore; dir: string } {
  const dir = freshDir();
  return { store: trackStore(dir), dir };
}

const png = (w = 8, h = 6): Promise<Buffer> =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
const jpeg = (): Promise<Buffer> =>
  sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
const webp = (): Promise<Buffer> =>
  sharp({
    create: { width: 8, height: 6, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .webp()
    .toBuffer();
const gif = (): Promise<Buffer> =>
  sharp({
    create: { width: 8, height: 6, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .gif()
    .toBuffer();

const countingProcessor = (): { proc: ImageProcessor; calls: () => number } => {
  let n = 0;
  return {
    calls: () => n,
    proc: {
      process: (req: ProcessRequest, key?: string) => {
        n++;
        return inProcessProcessor.process(req, key);
      },
    },
  };
};

afterAll(() => {
  for (const s of opened) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('ImageStore validation + storage', () => {
  test('detectImageType recognizes real formats by content and rejects non-images', async () => {
    expect(detectImageType(await png())).toBe('png');
    expect(detectImageType(await jpeg())).toBe('jpeg');
    expect(detectImageType(await webp())).toBe('webp');
    expect(detectImageType(await gif())).toBe('gif');
    expect(
      detectImageType(
        Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    ).toBe('svg');
    expect(detectImageType(Buffer.from('this is not an image, just text'))).toBeNull();
    expect(detectImageType(Buffer.from('PNG? no. plain text payload'))).toBeNull();
  });

  test('sanitizeSvg strips scripts and event handlers but keeps drawing', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10" onload="alert(2)" fill="red"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(/script/i.test(clean)).toBe(false);
    expect(/onload/i.test(clean)).toBe(false);
    expect(/<rect/i.test(clean)).toBe(true);
  });

  test('sanitizeSvg strips external resource refs (modern href + xlink:href) but keeps internal fragment refs', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">' +
      '<image href="https://evil.example/beacon.png" x="0" y="0" width="10" height="10"/>' +
      '<image xlink:href="https://evil.example/legacy.png" x="0" y="0" width="10" height="10"/>' +
      '<a href="https://evil.example/link"><rect width="1" height="1"/></a>' +
      '<radialGradient id="g"><stop offset="0" stop-color="red"/></radialGradient>' +
      '<rect width="10" height="10" fill="url(#g)"/>' +
      '</svg>';
    const clean = sanitizeSvg(dirty);
    expect(/evil\.example/i.test(clean)).toBe(false);
    expect(/url\(#g\)/i.test(clean)).toBe(true);
    expect(/<rect/i.test(clean)).toBe(true);
  });

  test('ingest stores a raster original plus persisted metadata', async () => {
    const { store, dir } = freshStore();
    const meta = await store.ingest(await png(12, 9), 'my map.png', 'user-1');
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(12);
    expect(meta.height).toBe(9);
    expect(meta.animated).toBe(false);
    expect(meta.uploadedBy).toBe('user-1');
    expect(meta.id).toMatch(/^[A-Za-z0-9-]+$/);
    expect(existsSync(join(dir, 'originals', `${meta.id}.png`))).toBe(true);
    const persisted = await store.getMeta(meta.id);
    expect(persisted?.id).toBe(meta.id);
    expect(persisted?.name).toBe('my map.png');
  });

  test('ingest stores a GIF', async () => {
    const { store } = freshStore();
    const meta = await store.ingest(await gif(), 'spin.gif');
    expect(meta.format).toBe('gif');
    expect(meta.animated).toBe(false);
  });

  test('ingest sanitizes SVG and stores it as vector', async () => {
    const { store, dir } = freshStore();
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>fetch("/evil")</script><circle cx="10" cy="10" r="5"/></svg>';
    const meta = await store.ingest(Buffer.from(dirty), 'logo.svg');
    expect(meta.format).toBe('svg');
    const stored = readFileSync(join(dir, 'originals', `${meta.id}.svg`), 'utf8');
    expect(/script/i.test(stored)).toBe(false);
    expect(/<circle/i.test(stored)).toBe(true);
  });

  test('ingest rejects a non-image disguised as an upload', async () => {
    const { store } = freshStore();
    await expect(store.ingest(Buffer.from('totally not an image'), 'evil.png')).rejects.toThrow(
      ImageValidationError,
    );
  });

  test('ingest rejects content that is not a decodable image (script-only)', async () => {
    const { store } = freshStore();
    await expect(store.ingest(Buffer.from('<script>1</script></svg>'), 'x.svg')).rejects.toThrow(
      ImageValidationError,
    );
  });

  test('ingest enforces the 10MB limit', async () => {
    const { store } = freshStore();
    const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    await expect(store.ingest(tooBig, 'big.png')).rejects.toThrow(ImageValidationError);
  });

  test('list returns stored images and remove deletes them', async () => {
    const { store, dir } = freshStore();
    const a = await store.ingest(await png(), 'a.png');
    const b = await store.ingest(await jpeg(), 'b.jpg');
    let list = await store.list();
    expect(list.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());

    expect(await store.remove(a.id)).toBe(true);
    list = await store.list();
    expect(list.map((m) => m.id)).toEqual([b.id]);
    expect(existsSync(join(dir, 'originals', `${a.id}.png`))).toBe(false);
    expect(await store.getMeta(a.id)).toBeNull();
  });

  test('remove and getMeta reject malformed ids (no path traversal)', async () => {
    const { store } = freshStore();
    expect(await store.remove('../../etc/passwd')).toBe(false);
    expect(await store.getMeta('..')).toBeNull();
  });

  test('rejects a brand-spoofed AVIF detected as HEIC (no un-serveable poison asset)', async () => {
    const { store } = freshStore();
    const avif = await sharp({
      create: { width: 80, height: 60, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .heif({ compression: 'av1', quality: 50 })
      .toBuffer();
    avif.write('heic', 8, 'ascii'); // spoof the ftyp major brand to look like HEVC HEIC
    await expect(store.ingest(avif, 'evil.heic')).rejects.toThrow(ImageValidationError);
    expect(await store.list()).toEqual([]);
  });

  test('enforces the library image-count quota', async () => {
    const store = trackStore(freshDir(), undefined, { maxImageCount: 2 });
    await store.ingest(await png(), 'a.png');
    await store.ingest(await png(), 'b.png');
    await expect(store.ingest(await png(), 'c.png')).rejects.toThrow(/full/i);
  });

  test('enforces the library total-bytes quota', async () => {
    const store = trackStore(freshDir(), undefined, { maxTotalBytes: 50 });
    await expect(store.ingest(await png(200, 200), 'big.png')).rejects.toThrow(/storage limit/i);
  });
});

describe('ImageStore serving + cache', () => {
  test('getServable generates a WebP variant on demand, then serves it from cache', async () => {
    const dir = freshDir();
    const { proc, calls } = countingProcessor();
    const store = trackStore(dir, proc);
    const meta = await store.ingest(await png(400, 300), 'map.png');

    const first = await store.getServable(meta.id, 100); // snaps to 160 -> generates
    expect(calls()).toBe(1);
    expect(first?.contentType).toBe('image/webp');
    expect(first?.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(/sandbox/.test(first?.headers['Content-Security-Policy'] ?? '')).toBe(true);
    expect(existsSync(join(dir, 'cache', meta.id, '160.webp'))).toBe(true);
    const md = await sharp(first!.buffer).metadata();
    expect(md.width).toBe(160);

    const second = await store.getServable(meta.id, 100); // cache hit -> no reprocessing
    expect(calls()).toBe(1);
    expect(second?.buffer).toEqual(first?.buffer);
  });

  test('getServable serves sanitized SVG as-is without invoking the processor', async () => {
    const dir = freshDir();
    const { proc, calls } = countingProcessor();
    const store = trackStore(dir, proc);
    const meta = await store.ingest(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
      ),
      'v.svg',
    );

    const s = await store.getServable(meta.id);
    expect(calls()).toBe(0);
    expect(s?.contentType).toBe('image/svg+xml');
    expect(s?.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(/<rect/i.test(s!.buffer.toString('utf8'))).toBe(true);
  });

  test('getServable returns null for unknown / malformed ids', async () => {
    const store = trackStore(freshDir());
    expect(await store.getServable('does-not-exist')).toBeNull();
    expect(await store.getServable('../../etc/passwd')).toBeNull();
  });

  test('cacheStats totals generated variants and purgeCache clears them (originals kept)', async () => {
    const dir = freshDir();
    const store = trackStore(dir);
    const meta = await store.ingest(await png(), 'm.png');
    await store.getServable(meta.id, 320);
    await store.getServable(meta.id, 640);

    let stats = await store.cacheStats();
    expect(stats.files).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);

    await store.purgeCache();
    stats = await store.cacheStats();
    expect(stats.files).toBe(0);
    expect(stats.bytes).toBe(0);
    // Original still present + still serveable (regenerated).
    expect(await store.getMeta(meta.id)).toBeTruthy();
    const reserved = await store.getServable(meta.id, 320);
    expect(reserved?.contentType).toBe('image/webp');
  });

  test('caps the variant cache to the configured budget (LRU eviction)', async () => {
    // Measure one 320px variant, then set a budget that holds ~2 of them.
    const probe = trackStore(freshDir());
    const pm = await probe.ingest(await png(800, 600), 'p.png');
    await probe.getServable(pm.id, 320);
    const variantBytes = (await probe.cacheStats()).bytes;

    const budget = variantBytes * 2 + Math.floor(variantBytes / 2); // room for 2, not 3
    const store = trackStore(freshDir(), undefined, { maxCacheBytes: budget });
    for (let i = 0; i < 5; i++) {
      const m = await store.ingest(await png(800, 600), `img${i}.png`);
      await store.getServable(m.id, 320);
    }

    const stats = await store.cacheStats();
    expect(stats.bytes).toBeLessThanOrEqual(budget);
    expect(stats.files).toBeLessThan(5); // older variants evicted
    expect(stats.files).toBeGreaterThanOrEqual(1);
  });

  test('removing an image drops its cached variants from the budget', async () => {
    const store = trackStore(freshDir(), undefined, { maxCacheBytes: 1_000_000 });
    const m = await store.ingest(await png(400, 300), 'm.png');
    await store.getServable(m.id, 320); // builds the cache index + records the variant
    expect((await store.cacheStats()).files).toBe(1);
    expect(await store.remove(m.id)).toBe(true);
    expect((await store.cacheStats()).files).toBe(0);
  });

  test('keeps the on-disk cache within budget under concurrent variant generation', async () => {
    // Measure one 320px variant so the budget is expressed in real variant sizes.
    const probe = trackStore(freshDir());
    const pm = await probe.ingest(await png(1200, 900), 'p.png');
    await probe.getServable(pm.id, 320);
    const variantBytes = (await probe.cacheStats()).bytes;

    const budget = variantBytes * 3; // room for ~3 variants
    const store = trackStore(freshDir(), undefined, { maxCacheBytes: budget });
    // Distinct images -> identical-size 320 variants the worker pool does NOT coalesce, so all
    // eight writes + evictions run concurrently (the interleaving that raced before the fix).
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push((await store.ingest(await png(1200, 900), `img${i}.png`)).id);
    }
    await Promise.all(ids.map((id) => store.getServable(id, 320)));

    // cacheStats walks the real disk (independent of the in-memory counter), so this catches the
    // double-subtract drift that previously let the cache grow without bound.
    const stats = await store.cacheStats();
    expect(stats.files).toBeLessThan(8); // eviction actually happened
    expect(stats.bytes).toBeLessThanOrEqual(budget + variantBytes * 2);
  });
});

describe('ImageStore — EXIF, sort, collections (M2)', () => {
  test('ingest extracts EXIF and getExif returns the raw tags', async () => {
    const { store } = freshStore();
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Make: 'TestCam', Model: 'X100' } })
      .jpeg()
      .toBuffer();
    const meta = await store.ingest(jpeg, 'photo.jpg');
    expect(meta.cameraMake).toBe('TestCam');
    expect(meta.cameraModel).toBe('X100');
    const raw = (await store.getExif(meta.id)) as Record<string, unknown> | null;
    expect(raw).not.toBeNull();
    expect((raw as Record<string, unknown>).Make).toBe('TestCam');
  });

  test('list sorts by name ascending/descending', async () => {
    const { store } = freshStore();
    await store.ingest(await png(), 'bravo.png');
    await store.ingest(await png(), 'alpha.png');
    expect((await store.list({ sort: 'name', order: 'asc' })).map((m) => m.name)).toEqual([
      'alpha.png',
      'bravo.png',
    ]);
    expect((await store.list({ sort: 'name', order: 'desc' })).map((m) => m.name)).toEqual([
      'bravo.png',
      'alpha.png',
    ]);
  });

  test('collections: create, add, filter, remove, rename, delete', async () => {
    const { store } = freshStore();
    const img = await store.ingest(await png(), 'a.png');
    const col = store.createCollection('Deck plans');
    expect(col.name).toBe('Deck plans');
    expect(store.listCollections().map((c) => c.id)).toContain(col.id);

    expect(store.addImageToCollection(col.id, img.id)).toBe(true);
    expect((await store.list({ collection: col.id })).map((m) => m.id)).toEqual([img.id]);
    expect(store.getCollection(col.id)?.imageCount).toBe(1);

    expect(store.removeImageFromCollection(col.id, img.id)).toBe(true);
    expect((await store.list({ collection: col.id })).length).toBe(0);

    expect(store.renameCollection(col.id, 'Deck')).toBe(true);
    expect(store.getCollection(col.id)?.name).toBe('Deck');
    expect(store.deleteCollection(col.id)).toBe(true);
    expect(store.getCollection(col.id)).toBeNull();
  });

  test('rejects malformed ids in collection ops', async () => {
    const { store } = freshStore();
    expect(store.getCollection('../x')).toBeNull();
    expect(store.addImageToCollection('../x', 'y')).toBe(false);
    expect(store.deleteCollection('..')).toBe(false);
  });
});

test('imageCount reflects the number of stored images', async () => {
  const { store } = freshStore();
  expect(store.imageCount()).toBe(0);
  await store.ingest(await png(), 'a.png');
  await store.ingest(await png(), 'b.png');
  expect(store.imageCount()).toBe(2);
});
