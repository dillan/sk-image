import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MetadataStore } from './metadata-store';
import type { ImageMeta } from './image-store';

const dirs: string[] = [];
function freshDb(): MetadataStore {
  const dir = join(tmpdir(), `sk-image-meta-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return new MetadataStore(join(dir, 'metadata.db'));
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function meta(over: Partial<ImageMeta> = {}): ImageMeta {
  return {
    id: randomUUID(),
    name: 'x.png',
    format: 'png',
    width: 10,
    height: 8,
    bytes: 100,
    animated: false,
    createdAt: new Date().toISOString(),
    uploadedBy: null,
    captureDate: null,
    lat: null,
    lon: null,
    cameraMake: null,
    cameraModel: null,
    orientation: null,
    ...over,
  };
}

describe('MetadataStore', () => {
  test('insert + get round-trips an image row', () => {
    const db = freshDb();
    const m = meta({ name: 'a.png', uploadedBy: 'u1' });
    db.insert(m);
    expect(db.get(m.id)).toEqual(m);
    db.close();
  });

  test('get returns null for a missing id', () => {
    const db = freshDb();
    expect(db.get('nope')).toBeNull();
    db.close();
  });

  test('list returns rows oldest-first', () => {
    const db = freshDb();
    const a = meta({ createdAt: '2020-01-01T00:00:00.000Z' });
    const b = meta({ createdAt: '2021-01-01T00:00:00.000Z' });
    db.insert(b);
    db.insert(a);
    expect(db.list().map((r) => r.id)).toEqual([a.id, b.id]);
    db.close();
  });

  test('remove deletes and reports whether a row existed', () => {
    const db = freshDb();
    const m = meta();
    db.insert(m);
    expect(db.remove(m.id)).toBe(true);
    expect(db.get(m.id)).toBeNull();
    expect(db.remove(m.id)).toBe(false);
    db.close();
  });

  test('count + totalBytes aggregate the library', () => {
    const db = freshDb();
    expect(db.count()).toBe(0);
    expect(db.totalBytes()).toBe(0);
    db.insert(meta({ bytes: 100 }));
    db.insert(meta({ bytes: 250 }));
    expect(db.count()).toBe(2);
    expect(db.totalBytes()).toBe(350);
    db.close();
  });

  test('animated + null dimensions persist correctly', () => {
    const db = freshDb();
    const m = meta({ format: 'svg', width: null, height: null, animated: true });
    db.insert(m);
    const got = db.get(m.id);
    expect(got?.width).toBeNull();
    expect(got?.height).toBeNull();
    expect(got?.animated).toBe(true);
    db.close();
  });

  test('recovers from a corrupt metadata.db by quarantining it and starting fresh', () => {
    const dir = join(tmpdir(), `sk-image-corrupt-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    const dbPath = join(dir, 'metadata.db');
    writeFileSync(dbPath, Buffer.from('this is definitely not a sqlite database'));

    // Must NOT throw: the corrupt file is quarantined and a fresh DB is created instead.
    const db = new MetadataStore(dbPath);
    expect(db.count()).toBe(0);
    db.insert(meta());
    expect(db.count()).toBe(1);
    db.close();

    expect(readdirSync(dir).some((f) => f.startsWith('metadata.db.corrupt-'))).toBe(true);
  });
});

describe('MetadataStore — EXIF, sort, filter', () => {
  test('persists and reads back EXIF-derived fields', () => {
    const db = freshDb();
    const m = meta({
      captureDate: '2021-06-01T10:00:00.000Z',
      lat: 47.6,
      lon: -122.3,
      cameraMake: 'TestCam',
      cameraModel: 'X100',
      orientation: 6,
    });
    db.insert(m);
    expect(db.get(m.id)).toEqual(m);
    db.close();
  });

  test('getExif round-trips the raw JSON blob', () => {
    const db = freshDb();
    const m = meta();
    db.insert(m, JSON.stringify({ Make: 'TestCam', ISO: 200 }));
    expect(db.getExif(m.id)).toEqual({ Make: 'TestCam', ISO: 200 });
    expect(db.getExif('missing')).toBeNull();
    db.close();
  });

  test('sorts by name and by capture date (falling back to created_at), both directions', () => {
    const db = freshDb();
    const a = meta({
      name: 'alpha.png',
      createdAt: '2020-01-01T00:00:00.000Z',
      captureDate: '2022-01-01T00:00:00.000Z',
    });
    const b = meta({ name: 'bravo.png', createdAt: '2021-01-01T00:00:00.000Z', captureDate: null });
    const c = meta({
      name: 'charlie.png',
      createdAt: '2019-01-01T00:00:00.000Z',
      captureDate: '2018-01-01T00:00:00.000Z',
    });
    db.insert(a);
    db.insert(b);
    db.insert(c);

    expect(db.list({ sort: 'name', order: 'asc' }).map((x) => x.name)).toEqual([
      'alpha.png',
      'bravo.png',
      'charlie.png',
    ]);
    expect(db.list({ sort: 'name', order: 'desc' }).map((x) => x.name)).toEqual([
      'charlie.png',
      'bravo.png',
      'alpha.png',
    ]);
    // date sort uses capture_date, falling back to created_at: c(2018) < b(created 2021) < a(2022)
    expect(db.list({ sort: 'date', order: 'asc' }).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    db.close();
  });

  test('filters images by collection', () => {
    const db = freshDb();
    const a = meta();
    const b = meta();
    db.insert(a);
    db.insert(b);
    db.createCollection('col-1', 'Deck', '2020-01-01T00:00:00.000Z');
    db.addImageToCollection('col-1', a.id);
    expect(db.list({ collection: 'col-1' }).map((x) => x.id)).toEqual([a.id]);
    db.close();
  });
});

describe('MetadataStore — collections', () => {
  test('create, list with counts, rename, delete', () => {
    const db = freshDb();
    db.createCollection('c1', 'Deck plans', '2020-01-01T00:00:00.000Z');
    db.createCollection('c2', 'Safety', '2020-01-02T00:00:00.000Z');
    const cols = db.listCollections();
    expect(cols.map((c) => c.name)).toEqual(['Deck plans', 'Safety']); // ordered by name
    expect(cols.every((c) => c.imageCount === 0)).toBe(true);

    expect(db.renameCollection('c1', 'Deck')).toBe(true);
    expect(db.renameCollection('nope', 'x')).toBe(false);
    expect(db.getCollection('c1')?.name).toBe('Deck');

    expect(db.deleteCollection('c2')).toBe(true);
    expect(db.listCollections().map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  test('add/remove membership updates counts and reports missing entities', () => {
    const db = freshDb();
    const img = meta();
    db.insert(img);
    db.createCollection('c1', 'Deck', '2020-01-01T00:00:00.000Z');

    expect(db.addImageToCollection('c1', img.id)).toBe(true);
    expect(db.addImageToCollection('c1', img.id)).toBe(true); // idempotent
    expect(db.getCollection('c1')?.imageCount).toBe(1);

    expect(db.addImageToCollection('missing', img.id)).toBe(false);
    expect(db.addImageToCollection('c1', 'missing')).toBe(false);

    expect(db.removeImageFromCollection('c1', img.id)).toBe(true);
    expect(db.removeImageFromCollection('c1', img.id)).toBe(false);
    expect(db.getCollection('c1')?.imageCount).toBe(0);
    db.close();
  });

  test('deleting an image cascades its collection membership', () => {
    const db = freshDb();
    const img = meta();
    db.insert(img);
    db.createCollection('c1', 'Deck', '2020-01-01T00:00:00.000Z');
    db.addImageToCollection('c1', img.id);
    expect(db.getCollection('c1')?.imageCount).toBe(1);
    db.remove(img.id); // FK ON DELETE CASCADE removes the membership row
    expect(db.getCollection('c1')?.imageCount).toBe(0);
    db.close();
  });
});
