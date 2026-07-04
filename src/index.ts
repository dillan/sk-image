import * as nodePath from 'node:path';
import type { Plugin, ServerAPI } from '@signalk/server-api';
import {
  ImageStore,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_ORIGINAL_BYTES,
  DEFAULT_MAX_CACHE_BYTES,
  type ImageFormat,
} from './images/image-store';
import { WorkerPoolImageProcessor } from './images/worker-pool';
import { WIDTH_ALLOWLIST } from './images/image-processing';
import { registerImageRoutes } from './images/image-router';
import { imageOpenApi } from './images/openapi';

/**
 * SK Image — a standalone Signal K server plugin that owns the boat's image library:
 * secure upload + content validation, on-demand resize/re-encode to WebP, a purgeable on-disk
 * variant cache, and (from Milestone 2) EXIF, collections, sort, and an embedded web-app manager.
 *
 * Routes are published by the server at `/plugins/sk-image/...`; storage lives under the plugin's
 * own data dir (`app.getDataDirPath()/images`).
 */

const SUPPORTED_FORMATS: readonly ImageFormat[] = ['svg', 'jpeg', 'png', 'webp', 'gif', 'heic'];

/** Human-readable binary size for the plugin status line (e.g. "1.0 GiB"). */
function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Surface a store-init failure on the boat's alarm surface when the server exposes notifications. */
function raiseStoreUnavailable(app: ServerAPI, detail: string): void {
  const notifications = (
    app as { notifications?: { raise?: (o: { state: string; message: string }) => unknown } }
  ).notifications;
  try {
    notifications?.raise?.({
      state: 'warn',
      message: `SK Image: image store unavailable (${detail})`,
    });
  } catch {
    // Older servers may not expose the v2 Notifications API — setPluginError still surfaces it.
  }
}

export = function skImagePlugin(app: ServerAPI): Plugin {
  let pool: WorkerPoolImageProcessor | null = null;
  let store: ImageStore | null = null;
  let configuredMaxCacheBytes = DEFAULT_MAX_CACHE_BYTES;
  let initFailed = false;

  // Built lazily on first route use — the data dir is only known once the server has initialized.
  const resolveStore = (): ImageStore | null => {
    if (!store) {
      try {
        const dir = nodePath.join(app.getDataDirPath(), 'images');
        pool = new WorkerPoolImageProcessor();
        store = new ImageStore(dir, pool, { maxCacheBytes: configuredMaxCacheBytes });
        initFailed = false;
        app.debug(`[sk-image] store ready at ${dir} (workers=${pool.size})`);
      } catch (e) {
        const detail = (e as Error).message;
        initFailed = true;
        app.error(`[sk-image] failed to initialize image store: ${detail}`);
        app.setPluginError(`Image store unavailable: ${detail}`);
        raiseStoreUnavailable(app, detail);
        // Tear down the just-spawned worker pool so its threads don't leak on a failed init.
        if (pool) {
          void pool.destroy().catch(() => undefined);
          pool = null;
        }
        store = null;
        return null;
      }
    }
    return store;
  };

  const plugin: Plugin = {
    id: 'sk-image',
    name: 'SK Image',
    description:
      'Secure image library for Signal K: upload, on-demand resize/re-encode, disk cache, and a web-app image manager.',
    schema: () => ({
      type: 'object',
      properties: {
        maxCacheBytes: {
          type: 'number',
          title: 'Max resized-image cache size (bytes)',
          description:
            'Disk budget for generated (resized / re-encoded) image variants. Original uploads are not counted. Default 1 GiB.',
          default: DEFAULT_MAX_CACHE_BYTES,
          minimum: 100 * 1024 * 1024,
        },
      },
    }),
    start: (settings) => {
      const value = (settings as { maxCacheBytes?: number }).maxCacheBytes;
      configuredMaxCacheBytes =
        typeof value === 'number' && value > 0 ? value : DEFAULT_MAX_CACHE_BYTES;
      initFailed = false;
      app.setPluginStatus('Started');
    },
    stop: () => {
      if (store) {
        store.close();
      }
      if (pool) {
        void pool.destroy().catch(() => undefined);
      }
      pool = null;
      store = null;
      app.setPluginStatus('Stopped');
    },
    statusMessage: () => {
      if (initFailed) return 'Image store unavailable — see server log';
      if (!store) return 'Ready';
      return `${store.imageCount()} images · cache budget ${fmtBytes(configuredMaxCacheBytes)}`;
    },
    getOpenApi: () => imageOpenApi(),
    registerWithRouter: (router) => {
      registerImageRoutes(router, {
        resolveStore,
        log: (m) => app.debug(m),
        getConfig: () => ({
          widthAllowlist: [...WIDTH_ALLOWLIST],
          supportedFormats: [...SUPPORTED_FORMATS],
          maxUploadBytes: MAX_UPLOAD_BYTES,
          maxImageCount: MAX_IMAGE_COUNT,
          maxTotalOriginalBytes: MAX_TOTAL_ORIGINAL_BYTES,
          maxCacheBytes: configuredMaxCacheBytes,
        }),
      });
    },
  };

  return plugin;
};
