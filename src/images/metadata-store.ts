import { DatabaseSync } from 'node:sqlite';
import { renameSync } from 'node:fs';
import type { ImageFormat, ImageMeta } from './image-store';

/**
 * SQLite-backed metadata store for the image library (node:sqlite — no native deps, ships with Node).
 *
 * Image BYTES live on disk (originals + the variant cache); this owns only metadata: the image rows
 * (name, dimensions, size, timestamps and — from Milestone 2 — EXIF / GPS / capture-date) plus
 * collections. Because every row can be reconstructed from the on-disk originals, the DB is an
 * index/cache, not the source of truth for the bytes; it is safe to rebuild.
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
  -- Milestone 2 columns (nullable; populated when EXIF / collections land)
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

  insert(meta: ImageMeta): void {
    this.db
      .prepare(
        `INSERT INTO images (id, name, format, width, height, bytes, animated, created_at, uploaded_by)
         VALUES (:id, :name, :format, :width, :height, :bytes, :animated, :created_at, :uploaded_by)`,
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
      });
  }

  get(id: string): ImageMeta | null {
    const row = this.db.prepare('SELECT * FROM images WHERE id = ?').get(id) as
      ImageRow | undefined;
    return row ? rowToMeta(row) : null;
  }

  /** All images, oldest first (matches the previous sidecar list ordering). */
  list(): ImageMeta[] {
    const rows = this.db
      .prepare('SELECT * FROM images ORDER BY created_at ASC, id ASC')
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

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed / mid-operation — best effort on shutdown
    }
  }
}
