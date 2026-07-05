import { expect, test } from 'vitest';
import type { ImageMeta } from './image-store';
import { createImageResourceProvider, type ResourceStore } from './image-resources';
import { SIGNALK_V1_IMAGE_BASE } from './image-router';

// A stub store — the provider only needs list() + getMeta(). Two images, one carrying capture GPS.
const WITH_GPS: ImageMeta = {
  id: 'gps1',
  name: 'harbour.jpg',
  format: 'jpeg',
  width: 4000,
  height: 3000,
  bytes: 1_200_000,
  animated: false,
  createdAt: '2026-01-02T03:04:05.000Z',
  captureDate: '2025-12-24T10:00:00.000Z',
  lat: 12.3456,
  lon: -65.4321,
  cameraMake: 'ACME',
  cameraModel: 'SeaCam 1',
  orientation: 1,
  uploadedBy: 'skipper',
};
const PLAIN: ImageMeta = {
  id: 'plain2',
  name: 'diagram.png',
  format: 'png',
  width: 800,
  height: 600,
  bytes: 40_000,
  animated: false,
  createdAt: '2026-02-02T02:02:02.000Z',
};

function stubStore(items: ImageMeta[]): ResourceStore {
  return {
    list: async () => items,
    getMeta: async (id: string) => items.find((m) => m.id === id) ?? null,
  };
}
const provider = (items: ImageMeta[] = [WITH_GPS, PLAIN]) =>
  createImageResourceProvider({ resolveStore: () => stubStore(items) });

test('registers as the custom "images" resource type', () => {
  expect(provider().type).toBe('images');
});

test('listResources returns a byte URL and NEVER leaks capture GPS (no principal here)', async () => {
  const map = (await provider().methods.listResources({})) as Record<
    string,
    Record<string, unknown>
  >;
  const doc = map['gps1'];
  expect(doc).toBeDefined();
  // The v2 resource layer has no request principal, so per-user-sensitive fields must never appear:
  // capture location, and the uploader's username (an audit field — anonymous clients must not see it).
  expect('lat' in doc).toBe(false);
  expect('lon' in doc).toBe(false);
  expect('uploadedBy' in doc).toBe(false);
  // A discoverable byte URL points at the crew-reachable /signalk/v1/api mount.
  expect(doc.url).toBe(`${SIGNALK_V1_IMAGE_BASE}/images/gps1`);
  // Non-sensitive metadata is still exposed.
  expect(doc.name).toBe('harbour.jpg');
  expect(doc.cameraModel).toBe('SeaCam 1');
});

test('getResource returns one stripped doc, and rejects for an unknown id', async () => {
  const doc = (await provider().methods.getResource('gps1')) as Record<string, unknown>;
  expect('lat' in doc).toBe(false);
  expect('lon' in doc).toBe(false);
  expect('uploadedBy' in doc).toBe(false);
  expect(doc.url).toBe(`${SIGNALK_V1_IMAGE_BASE}/images/gps1`);
  await expect(provider().methods.getResource('nope')).rejects.toThrow();
});

test('getResource supports dot-path property extraction', async () => {
  const res = (await provider().methods.getResource('plain2', 'format')) as { value: unknown };
  expect(res.value).toBe('png');
});

test('getResource rejects a request for a property that does not exist', async () => {
  await expect(provider().methods.getResource('plain2', 'nope.deep')).rejects.toThrow();
});

test('the resource is read-only: setResource and deleteResource reject', async () => {
  await expect(provider().methods.setResource('x', {})).rejects.toThrow();
  await expect(provider().methods.deleteResource('x')).rejects.toThrow();
});

test('listResources is empty when the store is not ready', async () => {
  const p = createImageResourceProvider({ resolveStore: () => null });
  expect(await p.methods.listResources({})).toEqual({});
});
