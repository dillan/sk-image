import { afterAll, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { IRouter } from 'express';
import { ImageStore } from './image-store';
import { registerImageRoutes } from './image-router';
import { isAuthorizedWriter, canReadSensitiveMetadata } from './sk-request';

type Handler = (req: unknown, res: unknown) => void;

interface RouterMock {
  getHandlers: Map<string, Handler>;
  postHandlers: Map<string, Handler>;
  putHandlers: Map<string, Handler>;
  deleteHandlers: Map<string, Handler>;
  get(p: string, h: Handler): void;
  post(p: string, h: Handler): void;
  put(p: string, h: Handler): void;
  delete(p: string, h: Handler): void;
  param(): void;
}
function createRouterMock(): RouterMock {
  const r: RouterMock = {
    getHandlers: new Map(),
    postHandlers: new Map(),
    putHandlers: new Map(),
    deleteHandlers: new Map(),
    get(p, h) {
      r.getHandlers.set(p, h);
    },
    post(p, h) {
      r.postHandlers.set(p, h);
    },
    put(p, h) {
      r.putHandlers.set(p, h);
    },
    delete(p, h) {
      r.deleteHandlers.set(p, h);
    },
    param() {},
  };
  return r;
}

interface ResMock {
  statusCode: number;
  jsonBody: unknown;
  sentBuffer: Buffer | undefined;
  headers: Record<string, string>;
  done: Promise<void>;
  status(c: number): ResMock;
  json(b: unknown): ResMock;
  send(b: Buffer): ResMock;
  setHeader(k: string, v: string): ResMock;
}
function createResMock(): ResMock {
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });
  const res: ResMock = {
    statusCode: 200,
    jsonBody: undefined,
    sentBuffer: undefined,
    headers: {},
    done,
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.jsonBody = b;
      resolveDone();
      return res;
    },
    send(b) {
      res.sentBuffer = b;
      resolveDone();
      return res;
    },
    setHeader(k, v) {
      res.headers[k] = v;
      return res;
    },
  };
  return res;
}

const TMP_ROOT = resolve('.tmp-sk-image-router-test');
const png = (): Promise<Buffer> =>
  sharp({
    create: { width: 120, height: 90, channels: 4, background: { r: 5, g: 6, b: 7, alpha: 1 } },
  })
    .png()
    .toBuffer();

// Track every store so its SQLite handle is closed before rmSync (Windows can't remove an open file).
const opened: ImageStore[] = [];
function trackStore(...args: ConstructorParameters<typeof ImageStore>): ImageStore {
  const store = new ImageStore(...args);
  opened.push(store);
  return store;
}
function setup(): { store: ImageStore; router: RouterMock } {
  const store = trackStore(join(TMP_ROOT, randomUUID()));
  const router = createRouterMock();
  registerImageRoutes(router as unknown as IRouter, { resolveStore: () => store });
  return { store, router };
}

// isAuthorizedWriter takes an SK-augmented express Request; feed it small partials.
type SkReq = Parameters<typeof isAuthorizedWriter>[0];
const asReq = (r: object): SkReq => r as unknown as SkReq;
/** A logged-in read-write principal — the shape SK attaches for an authorized writer. */
const AUTH = { skPrincipal: { identifier: 'u1', permissions: 'readwrite' } };

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

test('isAuthorizedWriter: open only when no security; otherwise requires read-write/admin', () => {
  expect(isAuthorizedWriter(asReq({}))).toBe(true); // no security strategy at all → open
  expect(
    isAuthorizedWriter(asReq({ skPrincipal: { identifier: 'u1', permissions: 'readwrite' } })),
  ).toBe(true);
  expect(
    isAuthorizedWriter(asReq({ skPrincipal: { identifier: 'u1', permissions: 'admin' } })),
  ).toBe(true);
  // authenticated but without write permission → rejected
  expect(isAuthorizedWriter(asReq({ skPrincipal: { identifier: 'u1' } }))).toBe(false);
  expect(isAuthorizedWriter(asReq({ skIsAuthenticated: true }))).toBe(false);
  expect(isAuthorizedWriter(asReq({ skIsAuthenticated: false }))).toBe(false);
  expect(isAuthorizedWriter(asReq({ skPrincipal: null, skIsAuthenticated: false }))).toBe(false);
});

test('isAuthorizedWriter: an anonymous readonly principal (Allow Readonly Access) cannot write', () => {
  // The SK server marks anonymous readonly visitors as authenticated with permissions:'readonly'.
  // Writes must require read-write/admin — presence of a principal is not enough.
  const ro = asReq({
    skPrincipal: { identifier: 'AUTO', permissions: 'readonly' },
    skIsAuthenticated: true,
  });
  expect(isAuthorizedWriter(ro)).toBe(false);
});

test('reads stay open on an unsecured server: list and EXIF need no principal', async () => {
  // With no security strategy (both signals unset) the boat is unsecured, so everything is readable
  // — pinned so a future change can't silently start requiring login to view images on such a setup.
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');

  const list = createResMock();
  router.getHandlers.get('/images')!({}, list);
  await list.done;
  expect(list.statusCode).toBe(200);

  const exif = createResMock();
  router.getHandlers.get('/images/:id/exif')!({ params: { id: meta.id } }, exif);
  await exif.done;
  expect(exif.statusCode).toBe(200);
});

test('denied writes: 403 for a logged-in read-only user, 401 for anonymous/AUTO', async () => {
  const { router } = setup();

  // A real logged-in read-only account is authenticated but not authorized → 403 (no login loop).
  const ro = createResMock();
  router.postHandlers.get('/collections')!(
    {
      skPrincipal: { identifier: 'guest', permissions: 'readonly' },
      skIsAuthenticated: true,
      body: { name: 'Deck' },
    },
    ro,
  );
  await ro.done;
  expect(ro.statusCode).toBe(403);

  // The anonymous AUTO principal (Allow Readonly Access) should be prompted to log in → 401.
  const auto = createResMock();
  router.postHandlers.get('/collections')!(
    {
      skPrincipal: { identifier: 'AUTO', permissions: 'readonly' },
      skIsAuthenticated: true,
      body: { name: 'Deck' },
    },
    auto,
  );
  await auto.done;
  expect(auto.statusCode).toBe(401);
});

test('canReadSensitiveMetadata: open when unsecured or logged in; blocked for secured anon/AUTO', () => {
  expect(canReadSensitiveMetadata(asReq({}))).toBe(true); // no security strategy
  expect(
    canReadSensitiveMetadata(
      asReq({
        skPrincipal: { identifier: 'u1', permissions: 'readonly' },
        skIsAuthenticated: true,
      }),
    ),
  ).toBe(true);
  expect(canReadSensitiveMetadata(asReq({ skIsAuthenticated: false }))).toBe(false); // secured anon
  expect(
    canReadSensitiveMetadata(
      asReq({
        skPrincipal: { identifier: 'AUTO', permissions: 'readonly' },
        skIsAuthenticated: true,
      }),
    ),
  ).toBe(false);
});

test('GET /images hides capture GPS from a secured anonymous client but keeps it for a logged-in user', async () => {
  const stub = {
    list: async () => [
      {
        id: 'a',
        name: 'a.jpg',
        format: 'jpeg',
        width: 1,
        height: 1,
        bytes: 1,
        animated: false,
        createdAt: 't',
        lat: 12.3,
        lon: 45.6,
      },
    ],
  };
  const router = createRouterMock();
  registerImageRoutes(router as unknown as IRouter, {
    resolveStore: () => stub as unknown as ImageStore,
  });

  const anon = createResMock();
  router.getHandlers.get('/images')!({ skIsAuthenticated: false }, anon);
  await anon.done;
  const anonItems = anon.jsonBody as { lat: number | null; lon: number | null }[];
  expect(anonItems[0].lat).toBeNull();
  expect(anonItems[0].lon).toBeNull();

  const user = createResMock();
  router.getHandlers.get('/images')!(
    { skPrincipal: { identifier: 'u1', permissions: 'readonly' }, skIsAuthenticated: true },
    user,
  );
  await user.done;
  const userItems = user.jsonBody as { lat: number | null; lon: number | null }[];
  expect(userItems[0].lat).toBe(12.3);
  expect(userItems[0].lon).toBe(45.6);
});

test('GET /images/:id/exif requires a logged-in user on a secured server', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');

  const anon = createResMock();
  router.getHandlers.get('/images/:id/exif')!(
    { skIsAuthenticated: false, params: { id: meta.id } },
    anon,
  );
  await anon.done;
  expect(anon.statusCode).toBe(401);

  const user = createResMock();
  router.getHandlers.get('/images/:id/exif')!(
    {
      skPrincipal: { identifier: 'u1', permissions: 'readonly' },
      skIsAuthenticated: true,
      params: { id: meta.id },
    },
    user,
  );
  await user.done;
  expect(user.statusCode).toBe(200);
});

test('POST /images rejects an anonymous (not-logged-in) request with 401', async () => {
  const { router } = setup();
  const res = createResMock();
  router.postHandlers.get('/images')!({ skIsAuthenticated: false, headers: {} }, res);
  await res.done;
  expect(res.statusCode).toBe(401);
  expect(String((res.jsonBody as { error: string }).error)).toMatch(/login required/i);
});

test('DELETE /images/:id and /images/cache require login', async () => {
  const { router } = setup();
  for (const handler of [
    router.deleteHandlers.get('/images/:id'),
    router.deleteHandlers.get('/images/cache'),
  ]) {
    const res = createResMock();
    handler!({ skIsAuthenticated: false, params: { id: 'abc' } }, res);
    await res.done;
    expect(res.statusCode).toBe(401);
  }
});

test('GET /images lists the shared library', async () => {
  const { store, router } = setup();
  const a = await store.ingest(await png(), 'a.png');
  const res = createResMock();
  router.getHandlers.get('/images')!({}, res);
  await res.done;
  expect(Array.isArray(res.jsonBody)).toBe(true);
  expect((res.jsonBody as { id: string }[]).map((m) => m.id)).toEqual([a.id]);
});

test('GET /images/:id serves bytes with the safe headers', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  const res = createResMock();
  router.getHandlers.get('/images/:id')!({ params: { id: meta.id }, query: { w: '320' } }, res);
  await res.done;
  expect(res.statusCode).toBe(200);
  expect(Buffer.isBuffer(res.sentBuffer)).toBe(true);
  expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  expect(res.headers['Content-Security-Policy']).toMatch(/sandbox/);
  expect(res.headers['Content-Type']).toBe('image/webp');
});

test('GET /images/:id rejects malformed ids and 404s unknown ids', async () => {
  const { router } = setup();
  const bad = createResMock();
  router.getHandlers.get('/images/:id')!({ params: { id: '../secret' }, query: {} }, bad);
  await bad.done;
  expect(bad.statusCode).toBe(400);

  const missing = createResMock();
  router.getHandlers.get('/images/:id')!({ params: { id: 'deadbeef-0000' }, query: {} }, missing);
  await missing.done;
  expect(missing.statusCode).toBe(404);
});

test('GET /images/cache reports size + count', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  await store.getServable(meta.id, 320);
  const res = createResMock();
  router.getHandlers.get('/images/cache')!({}, res);
  await res.done;
  expect((res.jsonBody as { files: number }).files).toBe(1);
  expect((res.jsonBody as { bytes: number }).bytes).toBeGreaterThan(0);
});

test('GET /config returns the capabilities payload when provided', async () => {
  const store = trackStore(join(TMP_ROOT, randomUUID()));
  const router = createRouterMock();
  registerImageRoutes(router as unknown as IRouter, {
    resolveStore: () => store,
    getConfig: () => ({ widthAllowlist: [160, 320] }),
  });
  const res = createResMock();
  router.getHandlers.get('/config')!({}, res);
  await res.done;
  expect((res.jsonBody as { widthAllowlist: number[] }).widthAllowlist).toEqual([160, 320]);
});

test('DELETE /images/:id removes an existing image (authenticated)', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  const res = createResMock();
  router.deleteHandlers.get('/images/:id')!({ ...AUTH, params: { id: meta.id } }, res);
  await res.done;
  expect(res.statusCode).toBe(200);
  expect((res.jsonBody as { ok: boolean }).ok).toBe(true);
  expect(await store.getMeta(meta.id)).toBeNull();
});

test('DELETE /images/:id 404s an unknown id (authenticated)', async () => {
  const { router } = setup();
  const res = createResMock();
  router.deleteHandlers.get('/images/:id')!({ ...AUTH, params: { id: 'nope-0000' } }, res);
  await res.done;
  expect(res.statusCode).toBe(404);
});

test('DELETE /images/cache purges the variant cache (authenticated)', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  await store.getServable(meta.id, 320);
  expect((await store.cacheStats()).files).toBe(1);
  const res = createResMock();
  router.deleteHandlers.get('/images/cache')!({ ...AUTH }, res);
  await res.done;
  expect(res.statusCode).toBe(200);
  expect((res.jsonBody as { ok: boolean }).ok).toBe(true);
  expect((await store.cacheStats()).files).toBe(0);
});

test('routes return 503 when the store is not ready', async () => {
  const router = createRouterMock();
  registerImageRoutes(router as unknown as IRouter, { resolveStore: () => null });
  const res = createResMock();
  router.getHandlers.get('/images')!({}, res);
  await res.done;
  expect(res.statusCode).toBe(503);
});

test('GET /images honours the sort + order query', async () => {
  const { store, router } = setup();
  await store.ingest(await png(), 'bravo.png');
  await store.ingest(await png(), 'alpha.png');
  const res = createResMock();
  router.getHandlers.get('/images')!({ query: { sort: 'name', order: 'asc' } }, res);
  await res.done;
  expect((res.jsonBody as { name: string }[]).map((m) => m.name)).toEqual([
    'alpha.png',
    'bravo.png',
  ]);
});

test('GET /images/:id/exif returns EXIF for an image and 404s an unknown id', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  const res = createResMock();
  router.getHandlers.get('/images/:id/exif')!({ params: { id: meta.id } }, res);
  await res.done;
  expect(res.statusCode).toBe(200);

  const missing = createResMock();
  router.getHandlers.get('/images/:id/exif')!({ params: { id: 'nope-0000' } }, missing);
  await missing.done;
  expect(missing.statusCode).toBe(404);
});

test('collections: create (auth), add image, filtered list, and counts', async () => {
  const { store, router } = setup();
  const img = await store.ingest(await png(), 'a.png');

  const created = createResMock();
  router.postHandlers.get('/collections')!({ ...AUTH, body: { name: 'Deck' } }, created);
  await created.done;
  expect(created.statusCode).toBe(201);
  const colId = (created.jsonBody as { id: string }).id;

  const add = createResMock();
  router.postHandlers.get('/collections/:id/images/:imageId')!(
    { ...AUTH, params: { id: colId, imageId: img.id } },
    add,
  );
  await add.done;
  expect(add.statusCode).toBe(200);

  const listed = createResMock();
  router.getHandlers.get('/images')!({ query: { collection: colId } }, listed);
  await listed.done;
  expect((listed.jsonBody as { id: string }[]).map((m) => m.id)).toEqual([img.id]);

  const cols = createResMock();
  router.getHandlers.get('/collections')!({}, cols);
  await cols.done;
  const found = (cols.jsonBody as { id: string; imageCount: number }[]).find((c) => c.id === colId);
  expect(found?.imageCount).toBe(1);
});

test('POST /collections rejects anonymous and empty names', async () => {
  const { router } = setup();
  const anon = createResMock();
  router.postHandlers.get('/collections')!({ skIsAuthenticated: false, body: { name: 'X' } }, anon);
  await anon.done;
  expect(anon.statusCode).toBe(401);

  const empty = createResMock();
  router.postHandlers.get('/collections')!({ ...AUTH, body: { name: '   ' } }, empty);
  await empty.done;
  expect(empty.statusCode).toBe(400);
});

test('PUT /collections/:id renames — 200 ok, 404 unknown, 400 bad id, 401 anon', async () => {
  const { store, router } = setup();
  const created = createResMock();
  router.postHandlers.get('/collections')!({ ...AUTH, body: { name: 'Deck' } }, created);
  await created.done;
  const id = (created.jsonBody as { id: string }).id;

  const ok = createResMock();
  router.putHandlers.get('/collections/:id')!(
    { ...AUTH, params: { id }, body: { name: 'Deck plans' } },
    ok,
  );
  await ok.done;
  expect(ok.statusCode).toBe(200);
  expect(store.getCollection(id)?.name).toBe('Deck plans');

  const notFound = createResMock();
  router.putHandlers.get('/collections/:id')!(
    { ...AUTH, params: { id: 'nope-0000' }, body: { name: 'X' } },
    notFound,
  );
  await notFound.done;
  expect(notFound.statusCode).toBe(404);

  const bad = createResMock();
  router.putHandlers.get('/collections/:id')!(
    { ...AUTH, params: { id: '../x' }, body: { name: 'X' } },
    bad,
  );
  await bad.done;
  expect(bad.statusCode).toBe(400);

  const anon = createResMock();
  router.putHandlers.get('/collections/:id')!(
    { skIsAuthenticated: false, params: { id }, body: { name: 'X' } },
    anon,
  );
  await anon.done;
  expect(anon.statusCode).toBe(401);
});

test('DELETE collection + remove-image — success, 404, and auth', async () => {
  const { store, router } = setup();
  const img = await store.ingest(await png(), 'a.png');
  const created = createResMock();
  router.postHandlers.get('/collections')!({ ...AUTH, body: { name: 'Deck' } }, created);
  await created.done;
  const id = (created.jsonBody as { id: string }).id;
  store.addImageToCollection(id, img.id);

  const rm = createResMock();
  router.deleteHandlers.get('/collections/:id/images/:imageId')!(
    { ...AUTH, params: { id, imageId: img.id } },
    rm,
  );
  await rm.done;
  expect(rm.statusCode).toBe(200);

  const rmMissing = createResMock();
  router.deleteHandlers.get('/collections/:id/images/:imageId')!(
    { ...AUTH, params: { id, imageId: img.id } },
    rmMissing,
  );
  await rmMissing.done;
  expect(rmMissing.statusCode).toBe(404);

  const del = createResMock();
  router.deleteHandlers.get('/collections/:id')!({ ...AUTH, params: { id } }, del);
  await del.done;
  expect(del.statusCode).toBe(200);
  expect(store.getCollection(id)).toBeNull();

  const delMissing = createResMock();
  router.deleteHandlers.get('/collections/:id')!(
    { ...AUTH, params: { id: 'nope-0000' } },
    delMissing,
  );
  await delMissing.done;
  expect(delMissing.statusCode).toBe(404);

  const anon = createResMock();
  router.deleteHandlers.get('/collections/:id')!(
    { skIsAuthenticated: false, params: { id: 'x' } },
    anon,
  );
  await anon.done;
  expect(anon.statusCode).toBe(401);
});

test('POST add-to-collection — 400 bad id, 404 missing, 401 anon', async () => {
  const { router } = setup();
  const bad = createResMock();
  router.postHandlers.get('/collections/:id/images/:imageId')!(
    { ...AUTH, params: { id: '../x', imageId: 'y' } },
    bad,
  );
  await bad.done;
  expect(bad.statusCode).toBe(400);

  const missing = createResMock();
  router.postHandlers.get('/collections/:id/images/:imageId')!(
    { ...AUTH, params: { id: 'nope-0000', imageId: 'also-0000' } },
    missing,
  );
  await missing.done;
  expect(missing.statusCode).toBe(404);

  const anon = createResMock();
  router.postHandlers.get('/collections/:id/images/:imageId')!(
    { skIsAuthenticated: false, params: { id: 'x', imageId: 'y' } },
    anon,
  );
  await anon.done;
  expect(anon.statusCode).toBe(401);
});
