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

function loginRedirect(): never {
  window.location.href = `/admin/#/login?redirect=${encodeURIComponent(window.location.pathname)}`;
  throw new Error('Login required');
}

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

/** Upload with progress — fetch can't report upload progress, so use XHR. */
function uploadWithProgress(file: File, onProgress?: (pct: number) => void): Promise<ImageAsset> {
  return new Promise<ImageAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/images`, true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as ImageAsset);
        } catch {
          reject(new Error('Unexpected upload response'));
        }
      } else if (xhr.status === 401) {
        loginRedirect();
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
    xhr.onerror = () => reject(new Error('Network error during upload'));
    const form = new FormData();
    form.append('file', file);
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
