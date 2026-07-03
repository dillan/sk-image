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
