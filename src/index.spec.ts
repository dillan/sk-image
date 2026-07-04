import { afterAll, expect, test } from 'vitest';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IRouter } from 'express';
import type { ServerAPI } from '@signalk/server-api';
import skImagePlugin from './index';

type Handler = (req: unknown, res: unknown) => void;

function createRouterMock(): { getHandlers: Map<string, Handler> } & Pick<IRouter, never> {
  const getHandlers = new Map<string, Handler>();
  return {
    getHandlers,
    get(p: string, h: Handler) {
      getHandlers.set(p, h);
    },
    post() {},
    put() {},
    delete() {},
    param() {},
  } as unknown as { getHandlers: Map<string, Handler> };
}

interface ResMock {
  statusCode: number;
  jsonBody: unknown;
  status(c: number): ResMock;
  json(b: unknown): ResMock;
}
function createResMock(): ResMock {
  const res: ResMock = {
    statusCode: 200,
    jsonBody: undefined,
    status(c) {
      res.statusCode = c;
      return res;
    },
    json(b) {
      res.jsonBody = b;
      return res;
    },
  };
  return res;
}

function createAppMock(dataDir: string): ServerAPI {
  return {
    getDataDirPath: () => dataDir,
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {},
    notifications: { raise: () => 'id' },
  } as unknown as ServerAPI;
}

const TMP = resolve('.tmp-sk-image-index-test');
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

test('plugin factory exposes the Signal K plugin contract', () => {
  const plugin = skImagePlugin(createAppMock(TMP));
  expect(plugin.id).toBe('sk-image');
  expect(plugin.name).toBe('SK Image');
  expect(typeof plugin.start).toBe('function');
  expect(typeof plugin.stop).toBe('function');
  expect(typeof plugin.registerWithRouter).toBe('function');

  const schema = plugin.schema as () => { properties: { maxCacheBytes: { default: number } } };
  expect(schema().properties.maxCacheBytes.default).toBe(1 * 1024 * 1024 * 1024);
});

test('GET /config advertises the width allow-list + limits (single source of truth for clients)', () => {
  const plugin = skImagePlugin(createAppMock(TMP));
  const router = createRouterMock();
  plugin.registerWithRouter?.(router as unknown as IRouter);

  const handler = router.getHandlers.get('/config');
  expect(typeof handler).toBe('function');

  const res = createResMock();
  handler?.({}, res);
  const body = res.jsonBody as {
    widthAllowlist: number[];
    maxUploadBytes: number;
    maxImageCount: number;
    maxTotalOriginalBytes: number;
    maxCacheBytes: number;
    supportedFormats: string[];
  };
  expect(body.widthAllowlist).toEqual([160, 320, 640, 960, 1280, 1920, 2560]);
  expect(body.maxUploadBytes).toBe(10 * 1024 * 1024);
  expect(body.maxImageCount).toBe(500);
  expect(body.maxTotalOriginalBytes).toBe(500 * 1024 * 1024);
  expect(body.maxCacheBytes).toBe(1 * 1024 * 1024 * 1024);
  expect(body.supportedFormats).toContain('heic');
  expect(body.supportedFormats).toContain('svg');
});

test('statusMessage reports readiness before the store is built', () => {
  const plugin = skImagePlugin(createAppMock(TMP));
  expect(typeof plugin.statusMessage).toBe('function');
  expect(plugin.statusMessage?.()).toBe('Ready');
});
