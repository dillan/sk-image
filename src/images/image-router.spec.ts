import { afterAll, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { IRouter } from 'express';
import { ImageStore } from './image-store';
import { registerImageRoutes, isAuthenticatedRequest } from './image-router';

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

function setup(): { store: ImageStore; router: RouterMock } {
  const store = new ImageStore(join(TMP_ROOT, randomUUID()));
  const router = createRouterMock();
  registerImageRoutes(router as unknown as IRouter, { resolveStore: () => store });
  return { store, router };
}

// isAuthenticatedRequest takes an SK-augmented express Request; feed it small partials.
type SkReq = Parameters<typeof isAuthenticatedRequest>[0];
const asReq = (r: object): SkReq => r as unknown as SkReq;

afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

test('isAuthenticatedRequest: open when no security, requires a principal when security is on', () => {
  expect(isAuthenticatedRequest(asReq({}))).toBe(true);
  expect(isAuthenticatedRequest(asReq({ skPrincipal: { identifier: 'u1' } }))).toBe(true);
  expect(isAuthenticatedRequest(asReq({ skIsAuthenticated: true }))).toBe(true);
  expect(isAuthenticatedRequest(asReq({ skIsAuthenticated: false }))).toBe(false);
  expect(isAuthenticatedRequest(asReq({ skPrincipal: null, skIsAuthenticated: false }))).toBe(
    false,
  );
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
  const store = new ImageStore(join(TMP_ROOT, randomUUID()));
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
  router.deleteHandlers.get('/images/:id')!(
    { skIsAuthenticated: true, params: { id: meta.id } },
    res,
  );
  await res.done;
  expect(res.statusCode).toBe(200);
  expect((res.jsonBody as { ok: boolean }).ok).toBe(true);
  expect(await store.getMeta(meta.id)).toBeNull();
});

test('DELETE /images/:id 404s an unknown id (authenticated)', async () => {
  const { router } = setup();
  const res = createResMock();
  router.deleteHandlers.get('/images/:id')!(
    { skIsAuthenticated: true, params: { id: 'nope-0000' } },
    res,
  );
  await res.done;
  expect(res.statusCode).toBe(404);
});

test('DELETE /images/cache purges the variant cache (authenticated)', async () => {
  const { store, router } = setup();
  const meta = await store.ingest(await png(), 'm.png');
  await store.getServable(meta.id, 320);
  expect((await store.cacheStats()).files).toBe(1);
  const res = createResMock();
  router.deleteHandlers.get('/images/cache')!({ skIsAuthenticated: true }, res);
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
