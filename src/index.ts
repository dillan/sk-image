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
import { registerImageRoutes, SK_IMAGE_MOUNT } from './images/image-router';
import { createImageResourceProvider } from './images/image-resources';
import { imageOpenApi } from './images/openapi';
import { checkSqliteSupport, MIN_NODE_FOR_SQLITE } from './images/sqlite-support';

/**
 * SK Image — a standalone Signal K server plugin that owns the boat's image library:
 * secure upload + content validation, on-demand resize/re-encode to WebP, a purgeable on-disk
 * variant cache, and (from Milestone 2) EXIF, collections, sort, and an embedded web-app manager.
 *
 * The REST API is published on two mounts: `/plugins/sk-image/...` (admin-gated under a secured
 * server — a backward-compatible alias) and `/signalk/v1/api/sk-image/...` (via `signalKApiRoutes`,
 * reachable by ordinary crew, where the plugin's own read/write auth is the effective gate). Image
 * metadata is additionally published as the v2 `images` resource type at
 * `/signalk/v2/api/resources/images`. Storage lives under the plugin's data dir
 * (`app.getDataDirPath()/images`).
 */

const SUPPORTED_FORMATS: readonly ImageFormat[] = ['svg', 'jpeg', 'png', 'webp', 'gif', 'heic'];

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

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
  let sqliteUnsupported = false;
  let resourceProviderRegistered = false;

  // Built lazily on first route use — the data dir is only known once the server has initialized.
  const resolveStore = (): ImageStore | null => {
    if (!store) {
      try {
        const dir = nodePath.join(app.getDataDirPath(), 'images');
        pool = new WorkerPoolImageProcessor();
        store = new ImageStore(dir, pool, { maxCacheBytes: configuredMaxCacheBytes });
        initFailed = false;
        app.debug(`store ready at ${dir} (workers=${pool.size})`);
      } catch (e) {
        const detail = (e as Error).message;
        initFailed = true;
        app.error(`failed to initialize image store: ${detail}`);
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

  // The image route table, shared by both mounts: the admin-gated `/plugins/sk-image` alias and the
  // crew-reachable `/signalk/v1/api/sk-image` path. `getConfig` reads `configuredMaxCacheBytes`
  // lazily, so it always reflects the latest applied setting.
  const routerDeps = {
    resolveStore,
    log: (m: string) => app.debug(m),
    getConfig: () => ({
      widthAllowlist: [...WIDTH_ALLOWLIST],
      supportedFormats: [...SUPPORTED_FORMATS],
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxImageCount: MAX_IMAGE_COUNT,
      maxTotalOriginalBytes: MAX_TOTAL_ORIGINAL_BYTES,
      maxCacheBytes: configuredMaxCacheBytes,
    }),
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
          title: 'Max resized-image cache size',
          description:
            'Disk budget for generated (resized / re-encoded) image variants. Original uploads are not counted.',
          enum: [512 * MiB, 1 * GiB, 2 * GiB, 4 * GiB, 8 * GiB],
          enumNames: ['512 MiB', '1 GiB (default)', '2 GiB', '4 GiB', '8 GiB'],
          default: DEFAULT_MAX_CACHE_BYTES,
        },
      },
    }),
    uiSchema: () => ({
      maxCacheBytes: {
        'ui:help':
          'Generated image variants only — your original uploads are never counted against this budget.',
      },
    }),
    start: (settings) => {
      const value = (settings as { maxCacheBytes?: number }).maxCacheBytes;
      configuredMaxCacheBytes =
        typeof value === 'number' && value > 0 ? value : DEFAULT_MAX_CACHE_BYTES;
      initFailed = false;
      // Fail loudly-but-gracefully on a Node too old for the built-in node:sqlite (needs >= 22.13):
      // report a clear, actionable status instead of crashing the plugin at load. See sqlite-support.ts.
      sqliteUnsupported = false;
      const support = checkSqliteSupport();
      if (!support.ok) {
        sqliteUnsupported = true;
        app.error(support.detail);
        app.setPluginError(
          `${support.detail} The image library is disabled — update Node, then restart Signal K.`,
        );
        raiseStoreUnavailable(
          app,
          `needs Node ${MIN_NODE_FOR_SQLITE}+, server runs Node ${process.versions.node}`,
        );
        return;
      }
      // Publish image metadata as the v2 `images` resource type (discoverable + crew-readable).
      // Guarded: older servers lack the API, and it must register once per process.
      if (!resourceProviderRegistered && typeof app.registerResourceProvider === 'function') {
        try {
          app.registerResourceProvider(createImageResourceProvider({ resolveStore }));
          resourceProviderRegistered = true;
        } catch (e) {
          app.debug(`images resource provider not registered: ${(e as Error).message}`);
        }
      }
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
      if (sqliteUnsupported)
        return `Disabled: needs Node ${MIN_NODE_FOR_SQLITE}+ (this server runs Node ${process.versions.node})`;
      if (initFailed) return 'Image store unavailable — see server log';
      if (!store) return 'Ready';
      return `${store.imageCount()} images · cache budget ${fmtBytes(configuredMaxCacheBytes)}`;
    },
    getOpenApi: () => imageOpenApi(),
    // Admin-gated alias under a secured server; kept for backward compatibility.
    registerWithRouter: (router) => {
      registerImageRoutes(router, routerDeps);
    },
    // Crew-reachable mount: `/signalk/v1/api` is not admin-gated, so the plugin's own
    // read/write authorization is the effective gate here.
    signalKApiRoutes: (router) => {
      registerImageRoutes(router, routerDeps, SK_IMAGE_MOUNT);
      return router;
    },
  };

  return plugin;
};
