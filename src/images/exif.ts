import exifr from 'exifr';

/**
 * A normalized subset of EXIF extracted from an upload's raw bytes. All fields are optional because
 * most images carry little or no EXIF (and SVG/PNG/GIF usually none). `raw` is the full parsed tag
 * set, serialized separately for the detail view.
 */
export interface ExtractedExif {
  captureDate: string | null; // ISO 8601
  lat: number | null;
  lon: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  orientation: number | null; // 1-8 EXIF orientation code
  raw: Record<string, unknown> | null;
}

const EMPTY: ExtractedExif = {
  captureDate: null,
  lat: null,
  lon: null,
  cameraMake: null,
  cameraModel: null,
  orientation: null,
  raw: null,
};

function toIso(v: unknown): string | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s.slice(0, 200) : null;
}

/**
 * Extract a normalized EXIF subset from raw upload bytes. Always extract from the ORIGINAL upload
 * (HEIC/JPEG carry the useful tags); the stored/transcoded bytes may have dropped them. Never
 * throws — returns an all-null result when there is no EXIF or parsing fails.
 */
export async function extractExif(buffer: Buffer): Promise<ExtractedExif> {
  let tags: Record<string, unknown> | undefined;
  try {
    // translateValues:false keeps Orientation numeric (1-8); dates are still revived to Date objects.
    tags = (await exifr.parse(buffer, { translateValues: false })) as
      Record<string, unknown> | undefined;
  } catch {
    tags = undefined;
  }
  if (!tags) return { ...EMPTY };

  let gps: { latitude?: number; longitude?: number } | null;
  try {
    gps = (await exifr.gps(buffer)) as { latitude?: number; longitude?: number } | null;
  } catch {
    gps = null;
  }

  return {
    captureDate: toIso(tags.DateTimeOriginal) ?? toIso(tags.CreateDate) ?? toIso(tags.ModifyDate),
    lat: num(gps?.latitude),
    lon: num(gps?.longitude),
    cameraMake: str(tags.Make),
    cameraModel: str(tags.Model),
    orientation: num(tags.Orientation),
    raw: tags,
  };
}

/** Serialize the raw EXIF tags to JSON, dropping binary blobs (thumbnails, MakerNote) that don't belong in the DB. */
export function serializeExif(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  try {
    // Read the pre-toJSON value via `this[key]`: Buffer.toJSON() would otherwise turn binary blobs
    // into { type: 'Buffer', data: [...] } before a value-based check could drop them.
    return JSON.stringify(
      raw,
      function (this: Record<string, unknown>, key: string, value: unknown) {
        return this[key] instanceof Uint8Array ? undefined : value;
      },
    );
  } catch {
    return null;
  }
}
