import { DatabaseSync } from 'node:sqlite';
import { renameSync } from 'node:fs';
import type { ImageFormat, ImageMeta } from './image-store';

/**
 * SQLite-backed metadata store for the image library (node:sqlite — no native deps, ships with Node).
 *
 * Image BYTES live on disk (originals + the variant cache); this owns only metadata: the image rows
 * (name, dimensions, size, timestamps, EXIF / GPS / capture-date) plus collections. Because every
 * row can be reconstructed from the on-disk originals, the DB is an index/cache, not the source of
 * truth for the bytes; it is safe to rebuild.
 *
 * The driver is deliberately isolated here so it can be swapped without touching ImageStore.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS images (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  format         TEXT NOT NULL,
  width          INTEGER,
  height         INTEGER,
  bytes          INTEGER NOT NULL,
  animated       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  uploaded_by    TEXT,
  capture_date   TEXT,
  lat            REAL,
  lon            REAL,
  camera_make    TEXT,
  camera_model   TEXT,
  orientation    INTEGER,
  exif_json      TEXT,
  content_sha256 TEXT
);
CREATE INDEX IF NOT EXISTS idx_images_created_at   ON images(created_at);
CREATE INDEX IF NOT EXISTS idx_images_name         ON images(name);
CREATE INDEX IF NOT EXISTS idx_images_capture_date ON images(capture_date);

CREATE TABLE IF NOT EXISTS collections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_images (
  collection_id TEXT NOT NULL,
  image_id      TEXT NOT NULL,
  PRIMARY KEY (collection_id, image_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id)      REFERENCES images(id)      ON DELETE CASCADE
);
`;

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  imageCount: number;
}

export interface ListImagesOptions {
  sort?: 'name' | 'date';
  order?: 'asc' | 'desc';
  collection?: string;
}

interface ImageRow {
  id: string;
  name: string;
  format: string;
  width: number | null;
  height: number | null;
  bytes: number;
  animated: number;
  created_at: string;
  uploaded_by: string | null;
  capture_date: string | null;
  lat: number | null;
  lon: number | null;
  camera_make: string | null;
  camera_model: string | null;
  orientation: number | null;
}

function rowToMeta(row: ImageRow): ImageMeta {
  return {
    id: row.id,
    name: row.name,
    format: row.format as ImageFormat,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    animated: row.animated === 1,
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by ?? null,
    captureDate: row.capture_date ?? null,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    cameraMake: row.camera_make ?? null,
    cameraModel: row.camera_model ?? null,
    orientation: row.orientation ?? null,
  };
}

export class MetadataStore {
  private readonly db: DatabaseSync;

  /** Opens (creating if needed) the SQLite DB at `dbPath`. The parent directory must already exist. */
  constructor(dbPath: string) {
    this.db = MetadataStore.open(dbPath);
  }

  /**
   * Open the DB and apply the schema. If the existing file is corrupt/unreadable (truncated or not
   * a SQLite file — e.g. after an unclean shutdown or a full disk), the image originals on disk are
   * the source of truth, so quarantine the bad file and start a fresh index rather than bricking
   * every route with a 503.
   */
  private static open(dbPath: string): DatabaseSync {
    try {
      const db = new DatabaseSync(dbPath);
      db.exec(SCHEMA); // forces a header read; throws ERR_SQLITE_ERROR on a corrupt file
      return db;
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_SQLITE_ERROR') throw e;
      try {
        renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`);
      } catch {
        // best effort — if we can't move it, the retry below surfaces the real error
      }
      const db = new DatabaseSync(dbPath);
      db.exec(SCHEMA);
      return db;
    }
  }

  insert(meta: ImageMeta, exifJson: string | null = null): void {
    this.db
      .prepare(
        `INSERT INTO images
          (id, name, format, width, height, bytes, animated, created_at, uploaded_by,
           capture_date, lat, lon, camera_make, camera_model, orientation, exif_json)
         VALUES
          (:id, :name, :format, :width, :height, :bytes, :animated, :created_at, :uploaded_by,
           :capture_date, :lat, :lon, :camera_make, :camera_model, :orientation, :exif_json)`,
      )
      .run({
        id: meta.id,
        name: meta.name,
        format: meta.format,
        width: meta.width,
        height: meta.height,
        bytes: meta.bytes,
        animated: meta.animated ? 1 : 0,
        created_at: meta.createdAt,
        uploaded_by: meta.uploadedBy ?? null,
        capture_date: meta.captureDate ?? null,
        lat: meta.lat ?? null,
        lon: meta.lon ?? null,
        camera_make: meta.cameraMake ?? null,
        camera_model: meta.cameraModel ?? null,
        orientation: meta.orientation ?? null,
        exif_json: exifJson,
      });
  }

  get(id: string): ImageMeta | null {
    const row = this.db.prepare('SELECT * FROM images WHERE id = ?').get(id) as
      ImageRow | undefined;
    return row ? rowToMeta(row) : null;
  }

  /** Read the full raw EXIF tag set for one image (null when none was captured). */
  getExif(id: string): unknown | null {
    const row = this.db.prepare('SELECT exif_json FROM images WHERE id = ?').get(id) as
      { exif_json: string | null } | undefined;
    if (!row || !row.exif_json) return null;
    try {
      return JSON.parse(row.exif_json);
    } catch {
      return null;
    }
  }

  /** List images, optionally filtered to a collection and sorted. Sort/order come from a fixed whitelist. */
  list(opts: ListImagesOptions = {}): ImageMeta[] {
    const sortCol =
      opts.sort === 'name'
        ? 'name'
        : opts.sort === 'date'
          ? 'COALESCE(capture_date, created_at)'
          : 'created_at';
    const dir = opts.order === 'desc' ? 'DESC' : 'ASC';

    if (opts.collection) {
      const rows = this.db
        .prepare(
          `SELECT i.* FROM images i
           JOIN collection_images ci ON ci.image_id = i.id
           WHERE ci.collection_id = ?
           ORDER BY ${sortCol} ${dir}, i.id ASC`,
        )
        .all(opts.collection) as unknown as ImageRow[];
      return rows.map(rowToMeta);
    }

    const rows = this.db
      .prepare(`SELECT * FROM images ORDER BY ${sortCol} ${dir}, id ASC`)
      .all() as unknown as ImageRow[];
    return rows.map(rowToMeta);
  }

  remove(id: string): boolean {
    const info = this.db.prepare('DELETE FROM images WHERE id = ?').run(id);
    return Number(info.changes) > 0;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM images').get() as { n: number };
    return Number(row.n);
  }

  totalBytes(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS total FROM images').get() as {
      total: number;
    };
    return Number(row.total);
  }

  // --- collections -------------------------------------------------------------------------------

  listCollections(): Collection[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.created_at, COUNT(ci.image_id) AS image_count
         FROM collections c
         LEFT JOIN collection_images ci ON ci.collection_id = c.id
         GROUP BY c.id
         ORDER BY c.name ASC`,
      )
      .all() as unknown as {
      id: string;
      name: string;
      created_at: string;
      image_count: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      imageCount: Number(r.image_count),
    }));
  }

  getCollection(id: string): Collection | null {
    const row = this.db
      .prepare(
        `SELECT c.id, c.name, c.created_at, COUNT(ci.image_id) AS image_count
         FROM collections c
         LEFT JOIN collection_images ci ON ci.collection_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`,
      )
      .get(id) as { id: string; name: string; created_at: string; image_count: number } | undefined;
    return row
      ? {
          id: row.id,
          name: row.name,
          createdAt: row.created_at,
          imageCount: Number(row.image_count),
        }
      : null;
  }

  createCollection(id: string, name: string, createdAt: string): void {
    this.db
      .prepare('INSERT INTO collections (id, name, created_at) VALUES (:id, :name, :created_at)')
      .run({ id, name, created_at: createdAt });
  }

  renameCollection(id: string, name: string): boolean {
    const info = this.db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name, id);
    return Number(info.changes) > 0;
  }

  deleteCollection(id: string): boolean {
    const info = this.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    return Number(info.changes) > 0;
  }

  /** Add an image to a collection. Returns false if either doesn't exist. Idempotent. */
  addImageToCollection(collectionId: string, imageId: string): boolean {
    if (!this.getCollection(collectionId) || !this.get(imageId)) return false;
    this.db
      .prepare('INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)')
      .run(collectionId, imageId);
    return true;
  }

  removeImageFromCollection(collectionId: string, imageId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM collection_images WHERE collection_id = ? AND image_id = ?')
      .run(collectionId, imageId);
    return Number(info.changes) > 0;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed / mid-operation — best effort on shutdown
    }
  }
}
