import { randomUUID } from 'node:crypto';
import { promises as fs, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import DOMPurify from 'isomorphic-dompurify';
import {
  snapWidth,
  CANONICAL_WIDTH,
  inProcessProcessor,
  type ImageProcessor,
} from './image-processing';
import { MetadataStore, type ListImagesOptions, type Collection } from './metadata-store';
import { extractExif, serializeExif } from './exif';

/**
 * ImageStore — secure, testable core for the KIP image-asset feature.
 *
 * Responsibilities (no Express here, so it is unit-testable with buffers + a temp dir):
 *  - Validate untrusted uploads by CONTENT (magic bytes), not the client extension/MIME.
 *  - Sanitize SVG (DOMPurify) and store it as vector; reject if sanitization empties it.
 *  - Validate raster decodability + dimensions via sharp, guarding decompression bombs.
 *  - Store the ORIGINAL bytes plus a sidecar JSON of metadata (id-addressed).
 *  - List / read metadata / delete.
 *
 * Serving (on-demand WebP re-encode + resize + cache) is layered on top separately; the raw
 * original raster is never served directly.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_INPUT_PIXELS = 50_000_000; // ~50 MP decompression-bomb guard
// HEIC is decoded by the pure-JS heic-convert (no streaming, full RGBA in memory), so it gets a
// much stricter budget than the sharp-decoded formats. A 24 MP cap bounds the one-time ingest
// transcode to a few hundred MB and still covers typical phone HEICs (<=12 MP). (security review)
const MAX_HEIC_PIXELS = 24_000_000;
// Bound the shared library so an authenticated-but-malicious uploader can't fill the data volume
// (which is shared with the SK server's own storage). (security review)
export const MAX_IMAGE_COUNT = 500;
export const MAX_TOTAL_ORIGINAL_BYTES = 500 * 1024 * 1024; // 500 MB of stored originals
// Default disk budget for generated (resized/re-encoded) variants. LRU-evicted when exceeded.
export const DEFAULT_MAX_CACHE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB

export type ImageFormat = 'svg' | 'jpeg' | 'png' | 'webp' | 'gif' | 'heic';

const RASTER_FORMATS: readonly ImageFormat[] = ['jpeg', 'png', 'webp', 'gif', 'heic'];

/** sharp `metadata().format` values we accept, mapped to our canonical format key. */
const SHARP_FORMAT_MAP: Record<string, ImageFormat> = {
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  heif: 'heic',
  heic: 'heic',
};

const EXT_BY_FORMAT: Record<ImageFormat, string> = {
  svg: 'svg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  heic: 'heic',
};

export interface ImageMeta {
  id: string;
  name: string; // sanitized display name (original filename, basename only)
  format: ImageFormat;
  width: number | null; // null for SVG without intrinsic size
  height: number | null;
  bytes: number; // size of the stored original
  animated: boolean;
  createdAt: string; // ISO timestamp
  uploadedBy?: string | null;
  // EXIF-derived (Milestone 2), all nullable — most images carry little or no EXIF.
  captureDate?: string | null;
  lat?: number | null;
  lon?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  orientation?: number | null;
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

/**
 * Detect the real image type from the leading bytes. Returns null for anything not allowed.
 * Magic numbers: PNG, JPEG, GIF87a/89a, RIFF/WEBP, ISO-BMFF `ftyp` HEIC/HEIF brands, or SVG/XML text.
 */
export function detectImageType(buffer: Buffer): ImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) {
    return 'gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    // HEVC-coded HEIC brands only. The generic 'heif'/'msf1' brands (also used by AVIF and other
    // non-HEVC HEIF codecs heic-convert can't decode) are excluded; decodability is additionally
    // proven by the ingest transcode below. (security review)
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevm', 'hevs', 'mif1'].includes(brand)) {
      return 'heic';
    }
  }
  if (looksLikeSvg(buffer)) {
    return 'svg';
  }
  return null;
}

function looksLikeSvg(buffer: Buffer): boolean {
  // Only sniff the head; SVG is text/XML whose document element is <svg>.
  const head = buffer
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (!head.startsWith('<')) return false;
  const withoutProlog = head
    .replace(/^<\?xml[\s\S]*?\?>\s*/, '')
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
    .trimStart();
  return /^<svg[\s>]/i.test(withoutProlog);
}

/** Sanitize an SVG string, stripping scripts, event handlers and external references. */
export function sanitizeSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    // Forbid BOTH the legacy xlink:href and the modern href attribute. An external href on
    // <image>/<a>/<feImage> would otherwise survive as a phone-home beacon in the stored bytes.
    // Internal references drawings rely on (e.g. fill="url(#gradient)", filter="url(#f)") are
    // NOT href attributes, so they are preserved.
    FORBID_ATTR: ['xlink:href', 'href'],
    ADD_TAGS: [],
    // Block external resource loads and javascript: URIs.
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  return typeof clean === 'string' ? clean : String(clean);
}

export interface ServableImage {
  buffer: Buffer;
  contentType: string;
  filename: string;
  headers: Record<string, string>;
}

/** Headers applied to every served image: lock down sniffing + execution, allow long caching. */
export function safeImageHeaders(contentType: string, filename: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
}

export class ImageStore {
  private readonly originalsDir: string;
  private readonly cacheDir: string;
  private readonly meta: MetadataStore;

  private readonly maxImageCount: number;
  private readonly maxTotalBytes: number;
  private readonly maxCacheBytes: number;

  // In-memory LRU index of the variant cache, built lazily (and rebuilt on restart by scanning the
  // cache dir once). Keyed by cache file path -> { size, last-access ms }. `null` until first use.
  private cacheIndex: Map<string, { size: number; atime: number }> | null = null;
  private cacheTotalBytes = 0;
  // In-flight promise for a lazy cacheIndex build, so concurrent callers share a single walk.
  private cacheIndexBuild: Promise<void> | null = null;

  constructor(
    baseDir: string,
    private readonly processor: ImageProcessor = inProcessProcessor,
    limits: { maxImageCount?: number; maxTotalBytes?: number; maxCacheBytes?: number } = {},
  ) {
    this.originalsDir = path.join(baseDir, 'originals');
    this.cacheDir = path.join(baseDir, 'cache');
    this.maxImageCount = limits.maxImageCount ?? MAX_IMAGE_COUNT;
    this.maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_ORIGINAL_BYTES;
    this.maxCacheBytes = limits.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    // The metadata DB lives alongside the originals/cache dirs; its parent must exist first.
    mkdirSync(baseDir, { recursive: true });
    this.meta = new MetadataStore(path.join(baseDir, 'metadata.db'));
  }

  /** Create the storage directories if they don't exist. Safe to call repeatedly. */
  async init(): Promise<void> {
    await fs.mkdir(this.originalsDir, { recursive: true });
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * Validate + store an uploaded image. Throws ImageValidationError on anything unsafe/unsupported.
   * @param buffer raw uploaded bytes
   * @param originalName client-supplied filename (used only for a display name; never for the path)
   * @param uploadedBy optional principal id for audit
   */
  async ingest(
    buffer: Buffer,
    originalName: string,
    uploadedBy?: string | null,
  ): Promise<ImageMeta> {
    if (!buffer || buffer.length === 0) {
      throw new ImageValidationError('Empty upload');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new ImageValidationError(`File exceeds ${MAX_UPLOAD_BYTES} byte limit`);
    }

    const detected = detectImageType(buffer);
    if (detected === null) {
      throw new ImageValidationError('Unsupported or unrecognized image format');
    }

    await this.init();

    // Enforce the library quota before doing any expensive decode/transcode work.
    if (this.meta.count() >= this.maxImageCount) {
      throw new ImageValidationError(`Image library is full (max ${this.maxImageCount} images)`);
    }
    if (this.meta.totalBytes() + buffer.length > this.maxTotalBytes) {
      throw new ImageValidationError('Image library storage limit reached');
    }

    const id = randomUUID();
    const name = sanitizeDisplayName(originalName);
    const now = new Date().toISOString();

    let meta: ImageMeta;
    let bytesToStore: Buffer;

    if (detected === 'svg') {
      const sanitized = sanitizeSvg(buffer.toString('utf8'));
      if (!/<svg[\s>]/i.test(sanitized)) {
        throw new ImageValidationError('SVG could not be safely sanitized');
      }
      bytesToStore = Buffer.from(sanitized, 'utf8');
      const dims = readSvgDimensions(sanitized);
      meta = {
        id,
        name,
        format: 'svg',
        width: dims.width,
        height: dims.height,
        bytes: bytesToStore.length,
        animated: false,
        createdAt: now,
        uploadedBy: uploadedBy ?? null,
      };
    } else if (detected === 'heic') {
      const probed = await probeRaster(buffer);
      const pixels = (probed.width ?? 0) * (probed.height ?? 0);
      if (!pixels || pixels > MAX_HEIC_PIXELS) {
        throw new ImageValidationError('HEIC image is too large or has unreadable dimensions');
      }
      // Transcode HEIC to a canonical WebP once, at upload. HEIC can't be served to browsers and a
      // per-request heic-convert decode is a memory-DoS vector; doing it once (bounded by the strict
      // pixel cap above) also proves decodability, so a non-HEVC/AVIF file detected as HEIC is
      // rejected here instead of stored as an un-serveable "poison" asset. (security review)
      let webp: { buffer: Buffer; width: number; height: number };
      try {
        webp = await this.processor.process({
          buffer,
          format: 'heic',
          width: CANONICAL_WIDTH,
          animated: probed.animated,
        });
      } catch (e) {
        throw new ImageValidationError(`HEIC could not be decoded: ${(e as Error).message}`);
      }
      bytesToStore = webp.buffer;
      meta = {
        id,
        name,
        format: 'webp',
        width: webp.width,
        height: webp.height,
        bytes: bytesToStore.length,
        animated: probed.animated,
        createdAt: now,
        uploadedBy: uploadedBy ?? null,
      };
    } else {
      const probed = await probeRaster(buffer);
      bytesToStore = buffer;
      meta = {
        id,
        name,
        format: detected,
        width: probed.width,
        height: probed.height,
        bytes: bytesToStore.length,
        animated: probed.animated,
        createdAt: now,
        uploadedBy: uploadedBy ?? null,
      };
    }

    const ext = EXT_BY_FORMAT[meta.format];
    await fs.writeFile(path.join(this.originalsDir, `${id}.${ext}`), bytesToStore);

    // Extract EXIF from the ORIGINAL upload bytes (a transcoded HEIC->WebP would have lost it).
    const exif = await extractExif(buffer);
    meta.captureDate = exif.captureDate;
    meta.lat = exif.lat;
    meta.lon = exif.lon;
    meta.cameraMake = exif.cameraMake;
    meta.cameraModel = exif.cameraModel;
    meta.orientation = exif.orientation;
    this.meta.insert(meta, serializeExif(exif.raw));
    return meta;
  }

  /** List stored image metadata, optionally filtered to a collection and sorted. */
  async list(opts: ListImagesOptions = {}): Promise<ImageMeta[]> {
    return this.meta.list(opts);
  }

  /** Number of images in the library (synchronous — used for plugin status reporting). */
  imageCount(): number {
    return this.meta.count();
  }

  // An opaque token that changes on any library/collection mutation (add, delete, collection edit,
  // membership change). Clients poll `GET /revision` and refresh when it differs from what they last
  // saw, so a change made in one browser shows up in another. In-memory: a server restart resets it,
  // which at worst prompts one harmless refresh in a client that had an older value.
  private rev = 0;
  revision(): number {
    return this.rev;
  }
  bumpRevision(): void {
    this.rev += 1;
  }

  async getMeta(id: string): Promise<ImageMeta | null> {
    if (!isValidId(id)) return null;
    return this.meta.get(id);
  }

  /** Full raw EXIF for one image (null when none was captured). */
  async getExif(id: string): Promise<unknown | null> {
    if (!isValidId(id)) return null;
    return this.meta.getExif(id);
  }

  // --- collections (Milestone 2) ----------------------------------------------------------------

  listCollections(): Collection[] {
    return this.meta.listCollections();
  }
  getCollection(id: string): Collection | null {
    return isValidId(id) ? this.meta.getCollection(id) : null;
  }
  createCollection(name: string): Collection {
    const id = randomUUID();
    this.meta.createCollection(id, name, new Date().toISOString());
    return this.meta.getCollection(id) as Collection;
  }
  renameCollection(id: string, name: string): boolean {
    return isValidId(id) ? this.meta.renameCollection(id, name) : false;
  }
  deleteCollection(id: string): boolean {
    return isValidId(id) ? this.meta.deleteCollection(id) : false;
  }
  addImageToCollection(collectionId: string, imageId: string): boolean {
    return isValidId(collectionId) && isValidId(imageId)
      ? this.meta.addImageToCollection(collectionId, imageId)
      : false;
  }
  removeImageFromCollection(collectionId: string, imageId: string): boolean {
    return isValidId(collectionId) && isValidId(imageId)
      ? this.meta.removeImageFromCollection(collectionId, imageId)
      : false;
  }

  /** Path to the stored original (for the serving layer). */
  originalPath(meta: ImageMeta): string {
    return path.join(this.originalsDir, `${meta.id}.${EXT_BY_FORMAT[meta.format]}`);
  }

  /** Delete an image: original bytes, metadata row, and any cached variants. */
  async remove(id: string): Promise<boolean> {
    if (!isValidId(id)) return false;
    const meta = await this.getMeta(id);
    if (!meta) return false;
    await rmIfExists(this.originalPath(meta));
    this.meta.remove(id);
    const variantDir = path.join(this.cacheDir, id);
    await fs.rm(variantDir, { recursive: true, force: true });
    this.forgetCacheEntries(variantDir + path.sep);
    return true;
  }

  /**
   * Produce a servable image: sanitized SVG as-is, or an on-demand WebP variant (resized to the
   * snapped width). Raster is ALWAYS re-encoded; the raw original raster is never returned. The
   * variant is cached on disk; concurrent requests for the same variant are coalesced.
   */
  async getServable(id: string, requestedWidth?: number | null): Promise<ServableImage | null> {
    const meta = await this.getMeta(id);
    if (!meta) return null;

    if (meta.format === 'svg') {
      const buffer = await fs.readFile(this.originalPath(meta));
      return {
        buffer,
        contentType: 'image/svg+xml',
        filename: `${id}.svg`,
        headers: safeImageHeaders('image/svg+xml', `${id}.svg`),
      };
    }

    const width = snapWidth(requestedWidth);
    const cachePath = path.join(this.cacheDir, id, `${width}.webp`);
    let buffer = await readIfExists(cachePath);
    if (!buffer) {
      const original = await fs.readFile(this.originalPath(meta));
      const result = await this.processor.process(
        { buffer: original, format: meta.format, width, animated: meta.animated },
        `${id}:${width}`,
      );
      buffer = result.buffer;
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, buffer);
      await this.recordCacheWrite(cachePath, buffer.length);
      // The image may have been deleted while we were encoding/writing; drop the orphan variant so
      // a removed image can't leave an unservable file lingering in the cache.
      if (!this.meta.get(id)) {
        await fs.rm(cachePath, { force: true });
        this.forgetCacheEntries(cachePath);
        return null;
      }
    } else {
      this.touchCache(cachePath);
    }
    return {
      buffer,
      contentType: 'image/webp',
      filename: `${id}.webp`,
      headers: safeImageHeaders('image/webp', `${id}.webp`),
    };
  }

  // --- variant cache LRU bookkeeping ------------------------------------------------------------

  /**
   * Build the cache index once (recovers size + access times after a restart). Promise-memoized so
   * concurrent first-time writers share a single directory walk instead of clobbering each other's
   * snapshot.
   */
  private ensureCacheIndex(): Promise<void> {
    if (this.cacheIndex) return Promise.resolve();
    if (!this.cacheIndexBuild) {
      this.cacheIndexBuild = (async () => {
        const index = new Map<string, { size: number; atime: number }>();
        let total = 0;
        const walk = async (dir: string): Promise<void> => {
          let entries: import('node:fs').Dirent[];
          try {
            entries = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(p);
            } else {
              try {
                const stat = await fs.stat(p);
                index.set(p, { size: stat.size, atime: stat.mtimeMs });
                total += stat.size;
              } catch {
                // skip unreadable entries
              }
            }
          }
        };
        await walk(this.cacheDir);
        this.cacheIndex = index;
        this.cacheTotalBytes = total;
      })().finally(() => {
        this.cacheIndexBuild = null;
      });
    }
    return this.cacheIndexBuild;
  }

  /** Record a freshly written variant, then evict LRU entries if we're over budget. */
  private async recordCacheWrite(cachePath: string, size: number): Promise<void> {
    await this.ensureCacheIndex();
    const index = this.cacheIndex!;
    const prev = index.get(cachePath);
    if (prev) this.cacheTotalBytes -= prev.size;
    index.set(cachePath, { size, atime: Date.now() });
    this.cacheTotalBytes += size;
    await this.enforceCacheBudget(cachePath);
  }

  /** Bump a variant's last-access time on a cache hit (no-op until the index is built). */
  private touchCache(cachePath: string): void {
    const entry = this.cacheIndex?.get(cachePath);
    if (entry) entry.atime = Date.now();
  }

  /** Evict least-recently-used variants until within budget (never the just-written one). */
  private async enforceCacheBudget(protectPath: string): Promise<void> {
    if (!this.cacheIndex || this.cacheTotalBytes <= this.maxCacheBytes) return;
    const victims = [...this.cacheIndex.entries()]
      .filter(([p]) => p !== protectPath)
      .sort((a, b) => a[1].atime - b[1].atime); // oldest first
    for (const [p, entry] of victims) {
      if (this.cacheTotalBytes <= this.maxCacheBytes) break;
      // A concurrent eviction pass may already have removed p; skip so we don't double-count.
      if (!this.cacheIndex.has(p)) continue;
      try {
        await fs.rm(p, { force: true });
      } catch {
        // ignore
      }
      // Map.delete is atomic + synchronous; only the pass that actually removes the entry
      // decrements the byte total, so overlapping passes can't double-subtract.
      if (this.cacheIndex.delete(p)) {
        this.cacheTotalBytes -= entry.size;
      }
    }
  }

  /** Drop cache-index entries under a removed image's variant directory. */
  private forgetCacheEntries(prefix: string): void {
    if (!this.cacheIndex) return;
    for (const [p, entry] of this.cacheIndex) {
      if (p.startsWith(prefix)) {
        this.cacheIndex.delete(p);
        this.cacheTotalBytes -= entry.size;
      }
    }
  }

  /** Total bytes + file count of the generated-variant cache (for the settings UI). */
  async cacheStats(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(p);
        } else {
          try {
            const stat = await fs.stat(p);
            bytes += stat.size;
            files += 1;
          } catch {
            // skip
          }
        }
      }
    };
    await walk(this.cacheDir);
    return { bytes, files };
  }

  /** Delete every generated variant. Originals + metadata are untouched (they regenerate on demand). */
  async purgeCache(): Promise<void> {
    await fs.rm(this.cacheDir, { recursive: true, force: true });
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.cacheIndex = new Map();
    this.cacheTotalBytes = 0;
    this.cacheIndexBuild = null;
  }

  /** Release the metadata DB handle. Call on plugin stop. */
  close(): void {
    this.meta.close();
  }
}

async function readIfExists(p: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

function isValidId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9-]+$/.test(id);
}

/** Reduce a client filename to a safe basename for display only (no path segments). */
function sanitizeDisplayName(name: string): string {
  // Strip ASCII control characters (code points 0x00-0x1f) without a control-char regex literal.
  const base = Array.from(path.basename(String(name ?? '')))
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join('')
    .trim();
  return base.length ? base.slice(0, 200) : 'image';
}

async function probeRaster(buffer: Buffer): Promise<{
  width: number | null;
  height: number | null;
  animated: boolean;
  format: ImageFormat;
}> {
  const metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: true })
    .metadata()
    .catch((e: unknown) => {
      throw new ImageValidationError(`Image could not be decoded: ${(e as Error).message}`);
    });
  const fmt = metadata.format ? SHARP_FORMAT_MAP[metadata.format] : undefined;
  if (!fmt || !RASTER_FORMATS.includes(fmt)) {
    throw new ImageValidationError(`Unsupported raster format: ${String(metadata.format)}`);
  }
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;
  const pages = metadata.pages ?? 1;
  if (width && height && width * height * pages > MAX_INPUT_PIXELS) {
    throw new ImageValidationError('Image exceeds the maximum pixel budget');
  }
  return { width, height, animated: pages > 1, format: fmt };
}

function readSvgDimensions(svg: string): { width: number | null; height: number | null } {
  const w = /\bwidth\s*=\s*["']?\s*([\d.]+)/i.exec(svg);
  const h = /\bheight\s*=\s*["']?\s*([\d.]+)/i.exec(svg);
  const width = w ? Number(w[1]) : null;
  const height = h ? Number(h[1]) : null;
  return {
    width: Number.isFinite(width as number) ? width : null,
    height: Number.isFinite(height as number) ? height : null,
  };
}

async function rmIfExists(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    // ignore missing
  }
}
