// API client for the SK Image plugin. The web app is served same-origin by the Signal K server, so
// it always calls the plugin's absolute path and authenticates with the SK session cookie.

const BASE = '/plugins/sk-image';

export interface ImageAsset {
  id: string;
  name: string;
  format: string;
  width: number | null;
  height: number | null;
  bytes: number;
  animated: boolean;
  createdAt: string;
  captureDate?: string | null;
  lat?: number | null;
  lon?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  orientation?: number | null;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  imageCount: number;
}

export interface CacheStats {
  bytes: number;
  files: number;
}

export interface PluginConfig {
  widthAllowlist: number[];
  supportedFormats: string[];
  maxUploadBytes: number;
  maxImageCount: number;
  maxTotalOriginalBytes: number;
  maxCacheBytes: number;
}

export type SortKey = 'name' | 'date';
export type SortOrder = 'asc' | 'desc';

function loginUrl(): string {
  return `/admin/#/login?redirect=${encodeURIComponent(window.location.pathname)}`;
}
function loginRedirect(): never {
  window.location.href = loginUrl();
  throw new Error('Login required');
}

/** Abort an upload if no progress event fires for this long — catches a stalled connection. */
const STALL_MS = 45000;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  if (res.status === 401) loginRedirect();
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface UploadOptions {
  /** Called on transfer progress with bytes sent so far and the total to send. */
  onProgress?: (loaded: number, total: number) => void;
  /** Abort the upload (e.g. the user cancelled the batch). */
  signal?: AbortSignal;
}

/**
 * Upload one image — fetch can't report upload progress, so use XHR. Each file is its own
 * `POST /images` (create-one-resource); the web app uploads several by calling this per file.
 */
function uploadWithProgress(file: File, opts: UploadOptions = {}): Promise<ImageAsset> {
  return new Promise<ImageAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/images`, true);
    xhr.withCredentials = true;

    // Watchdog: if progress stops for STALL_MS the connection is wedged — abort so the queue can move
    // on (rejected as a normal error, not a user cancel). It resets on every progress event, so a
    // slow-but-moving upload is never killed.
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_MS);
    };
    const done = () => {
      if (stallTimer) clearTimeout(stallTimer);
    };

    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    // Once the body is fully sent, the server is processing (transcode/EXIF/store) — stop the stall
    // watchdog so a slow server response isn't mistaken for a dead connection.
    xhr.upload.onload = () => done();
    xhr.onload = () => {
      done();
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as ImageAsset);
        } catch {
          reject(new Error('Unexpected upload response'));
        }
      } else if (xhr.status === 401) {
        // Settle the promise BEFORE navigating — a throw here would never reach the awaiting caller.
        reject(new Error('Login required'));
        window.location.href = loginUrl();
      } else {
        let message = xhr.statusText;
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
        } catch {
          /* non-JSON error body */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => {
      done();
      reject(new Error('Network error during upload'));
    };
    xhr.onabort = () => {
      done();
      // A stall abort is a normal (retryable) failure; an opts.signal abort is a user cancel.
      reject(
        stalled
          ? new Error('Upload stalled (no progress) — connection may be down')
          : new DOMException('Upload cancelled', 'AbortError'),
      );
    };
    if (opts.signal) {
      if (opts.signal.aborted) xhr.abort();
      else opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    const form = new FormData();
    form.append('file', file);
    armStall();
    xhr.send(form);
  });
}

export const api = {
  config: () => req<PluginConfig>('/config'),

  list: (opts: { sort?: SortKey; order?: SortOrder; collection?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.order) q.set('order', opts.order);
    if (opts.collection) q.set('collection', opts.collection);
    const qs = q.toString();
    return req<ImageAsset[]>(`/images${qs ? `?${qs}` : ''}`);
  },

  // EXIF may require login on a secured server; treat "not allowed" as "no EXIF" so an anonymous
  // viewer just doesn't see details rather than being bounced to the login page.
  exif: async (id: string): Promise<Record<string, unknown> | null> => {
    const res = await fetch(`${BASE}/images/${encodeURIComponent(id)}/exif`, {
      credentials: 'include',
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(message);
    }
    return (await res.json()) as Record<string, unknown> | null;
  },
  upload: uploadWithProgress,
  remove: (id: string) =>
    req<{ ok: boolean }>(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  cacheStats: () => req<CacheStats>('/images/cache'),
  purgeCache: () => req<{ ok: boolean }>('/images/cache', { method: 'DELETE' }),

  listCollections: () => req<Collection[]>('/collections'),
  createCollection: (name: string) =>
    req<Collection>('/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  renameCollection: (id: string, name: string) =>
    req<{ ok: boolean }>(`/collections/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteCollection: (id: string) =>
    req<{ ok: boolean }>(`/collections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addToCollection: (collectionId: string, imageId: string) =>
    req<{ ok: boolean }>(
      `/collections/${encodeURIComponent(collectionId)}/images/${encodeURIComponent(imageId)}`,
      { method: 'POST' },
    ),
  removeFromCollection: (collectionId: string, imageId: string) =>
    req<{ ok: boolean }>(
      `/collections/${encodeURIComponent(collectionId)}/images/${encodeURIComponent(imageId)}`,
      { method: 'DELETE' },
    ),

  /** URL for a resized variant at a snapped width. */
  imageUrl: (id: string, width: number) => `${BASE}/images/${encodeURIComponent(id)}?w=${width}`,
};
