import type { IRouter, Request, Response } from 'express';
import multer from 'multer';
import { ImageStore, ImageValidationError, MAX_UPLOAD_BYTES } from './image-store';
import {
  type SkRequest,
  isAuthorizedWriter,
  isAuthenticatedUser,
  canReadSensitiveMetadata,
  principalId,
} from './sk-request';

const ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Namespace under which the image API is mounted on the server's shared `/signalk/v1/api` router
 * (via the plugin's `signalKApiRoutes` hook). Unlike `/plugins/sk-image`, this path is NOT
 * admin-gated on a secured server, so ordinary crew can reach it — the plugin's own auth
 * (`isAuthorizedWriter` / `canReadSensitiveMetadata`) is the effective gate there.
 */
export const SK_IMAGE_MOUNT = '/sk-image';
/** Absolute, from-root base for the crew-reachable image API (used to build byte URLs). */
export const SIGNALK_V1_IMAGE_BASE = `/signalk/v1/api${SK_IMAGE_MOUNT}`;

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}
function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/**
 * Remove per-user-sensitive fields from image metadata for clients not allowed to see them:
 * capture GPS (where the photo was taken) and the uploader's username (an audit field). Applied to
 * anonymous callers on a secured server; logged-in users get the full record.
 */
function stripSensitive<
  T extends { lat?: number | null; lon?: number | null; uploadedBy?: string | null },
>(meta: T): T {
  return { ...meta, lat: null, lon: null, uploadedBy: null };
}

/** Normalize a client-supplied collection name (trim, strip control chars, cap length). */
function sanitizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = Array.from(value.trim())
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join('')
    .slice(0, 100);
  return name.length ? name : null;
}

export interface ImageRouterDeps {
  /** Lazily resolve the store (the data dir is only known after the plugin initializes). */
  resolveStore: () => ImageStore | null;
  isAuthenticated?: (req: Request) => boolean;
  log?: (msg: string) => void;
  /** Capabilities payload for GET /config (width allow-list, limits) so clients don't hard-code them. */
  getConfig?: () => unknown;
}

/**
 * Register the image-asset routes on an Express router.
 *
 * The same routes are published on two mounts: the server's per-plugin router at
 * `/plugins/sk-image` (admin-gated under security — a backward-compatible alias) and, with
 * `basePath = '/sk-image'`, the shared `/signalk/v1/api` router where ordinary crew can reach them.
 * `basePath` prefixes every route so the routes never collide in the shared `/signalk/v1/api`
 * namespace; it is empty for the per-plugin mount.
 */
export function registerImageRoutes(router: IRouter, deps: ImageRouterDeps, basePath = ''): void {
  const p = (route: string): string => `${basePath}${route}`;
  const isAuth = deps.isAuthenticated ?? isAuthorizedWriter;
  // Enforce write access, choosing the status that gives the client the right next step:
  //  - 401 for an anonymous request (the web app prompts a login),
  //  - 403 for a logged-in user whose account lacks write permission (no pointless login loop).
  const requireWrite = (req: Request, res: Response, action: string): boolean => {
    if (isAuth(req)) return true;
    if (isAuthenticatedUser(req as SkRequest)) {
      sendError(res, 403, `Insufficient permission to ${action}`);
    } else {
      sendError(res, 401, `Login required to ${action}`);
    }
    return false;
  };
  const getStore = (res: Response): ImageStore | null => {
    const store = deps.resolveStore();
    if (!store) sendError(res, 503, 'Image service is not ready');
    return store;
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });
  const single = upload.single('file');

  // GET /config — capabilities discovery (width allow-list + limits). Clients read this instead of
  // hard-coding a mirrored copy of the server's constants. Read-only, no auth required.
  router.get(p('/config'), (_req: Request, res: Response) => {
    res.json(deps.getConfig ? deps.getConfig() : {});
  });

  // GET /revision — a cheap change token. It changes whenever the library or collections change, so
  // clients can poll it and refresh when a change was made elsewhere (e.g. another browser). Read-only.
  router.get(p('/revision'), (_req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    res.json({ revision: store.revision() });
  });

  // POST /images — upload (auth required; auth is checked BEFORE multipart parsing).
  router.post(p('/images'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'upload images')) return;
    single(req, res, (err: unknown) => {
      void (async () => {
        if (err) {
          const code = (err as { code?: string }).code;
          if (code === 'LIMIT_FILE_SIZE')
            return sendError(res, 413, `File exceeds ${MAX_UPLOAD_BYTES} byte limit`);
          return sendError(res, 400, `Upload failed: ${(err as Error).message}`);
        }
        const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
        if (!file || !file.buffer)
          return sendError(res, 400, 'No file provided (expected form field "file")');
        const store = getStore(res);
        if (!store) return;
        try {
          const meta = await store.ingest(
            file.buffer,
            file.originalname,
            principalId(req as SkRequest),
          );
          store.bumpRevision();
          return sendJson(res, 201, { ...meta, url: `images/${meta.id}` });
        } catch (e) {
          if (e instanceof ImageValidationError) return sendError(res, 415, e.message);
          deps.log?.(`ingest error: ${(e as Error).message}`);
          return sendError(res, 500, 'Failed to store image');
        }
      })();
    });
  });

  // GET /images?sort=name|date&order=asc|desc&collection=<id> — list the library.
  router.get(p('/images'), (req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    const query = (req.query ?? {}) as { sort?: unknown; order?: unknown; collection?: unknown };
    const sort = query.sort === 'name' || query.sort === 'date' ? query.sort : undefined;
    const order = query.order === 'asc' || query.order === 'desc' ? query.order : undefined;
    const collectionRaw = typeof query.collection === 'string' ? query.collection : undefined;
    const collection = collectionRaw && ID_RE.test(collectionRaw) ? collectionRaw : undefined;
    void (async () => {
      try {
        const items = await store.list({ sort, order, collection });
        // Capture GPS and the uploader's username are only shown to logged-in users (open on an
        // unsecured server); a secured anonymous visitor gets them nulled.
        res.json(canReadSensitiveMetadata(req as SkRequest) ? items : items.map(stripSensitive));
      } catch {
        sendError(res, 500, 'Failed to list images');
      }
    })();
  });

  // Cache routes MUST be registered before /images/:id so "cache" is not matched as an id.
  router.get(p('/images/cache'), (_req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        res.json(await store.cacheStats());
      } catch {
        sendError(res, 500, 'Failed to read cache stats');
      }
    })();
  });

  router.delete(p('/images/cache'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'purge the image cache')) return;
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        await store.purgeCache();
        res.json({ ok: true });
      } catch {
        sendError(res, 500, 'Failed to purge cache');
      }
    })();
  });

  // GET /images/:id?w= — serve a variant (raster re-encoded to WebP) or sanitized SVG.
  router.get(p('/images/:id'), (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid image id');
    const rawW = req.query.w;
    const width = typeof rawW === 'string' && rawW.trim() !== '' ? Number(rawW) : undefined;
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        const servable = await store.getServable(id, Number.isFinite(width) ? width : undefined);
        if (!servable) return sendError(res, 404, 'Image not found');
        for (const [k, v] of Object.entries(servable.headers)) res.setHeader(k, v);
        res.status(200).send(servable.buffer);
      } catch (e) {
        deps.log?.(`serve error: ${(e as Error).message}`);
        sendError(res, 500, 'Failed to render image');
      }
    })();
  });

  // DELETE /images/:id — remove an image (auth required).
  router.delete(p('/images/:id'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'delete images')) return;
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid image id');
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        const removed = await store.remove(id);
        if (!removed) return sendError(res, 404, 'Image not found');
        store.bumpRevision();
        res.json({ ok: true });
      } catch {
        sendError(res, 500, 'Failed to delete image');
      }
    })();
  });

  // GET /images/:id/exif — full raw EXIF for one image (null when none was captured).
  router.get(p('/images/:id/exif'), (req: Request, res: Response) => {
    // Raw EXIF can carry capture GPS; only logged-in users may read it (open on an unsecured server).
    if (!canReadSensitiveMetadata(req as SkRequest)) {
      return sendError(res, 401, 'Login required to view image EXIF');
    }
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid image id');
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        const meta = await store.getMeta(id);
        if (!meta) return sendError(res, 404, 'Image not found');
        res.json(await store.getExif(id));
      } catch {
        sendError(res, 500, 'Failed to read EXIF');
      }
    })();
  });

  // --- collections ------------------------------------------------------------------------------

  // GET /collections — list collections with image counts.
  router.get(p('/collections'), (_req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    try {
      res.json(store.listCollections());
    } catch {
      sendError(res, 500, 'Failed to list collections');
    }
  });

  // POST /collections { name } — create a collection (auth required).
  router.post(p('/collections'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'create a collection')) return;
    const name = sanitizeName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return sendError(res, 400, 'A collection name is required');
    const store = getStore(res);
    if (!store) return;
    try {
      const created = store.createCollection(name);
      store.bumpRevision();
      return sendJson(res, 201, created);
    } catch {
      return sendError(res, 500, 'Failed to create collection');
    }
  });

  // PUT /collections/:id { name } — rename a collection (auth required).
  router.put(p('/collections/:id'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'rename a collection')) return;
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid collection id');
    const name = sanitizeName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return sendError(res, 400, 'A collection name is required');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.renameCollection(id, name)) return sendError(res, 404, 'Collection not found');
      store.bumpRevision();
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to rename collection');
    }
  });

  // DELETE /collections/:id — delete a collection (auth required). The images themselves are kept.
  router.delete(p('/collections/:id'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'delete a collection')) return;
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid collection id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.deleteCollection(id)) return sendError(res, 404, 'Collection not found');
      store.bumpRevision();
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to delete collection');
    }
  });

  // POST /collections/:id/images/:imageId — add an image to a collection (auth required).
  router.post(p('/collections/:id/images/:imageId'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'modify a collection')) return;
    const id = String(req.params.id ?? '');
    const imageId = String(req.params.imageId ?? '');
    if (!ID_RE.test(id) || !ID_RE.test(imageId)) return sendError(res, 400, 'Invalid id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.addImageToCollection(id, imageId)) {
        return sendError(res, 404, 'Collection or image not found');
      }
      store.bumpRevision();
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to add image to collection');
    }
  });

  // DELETE /collections/:id/images/:imageId — remove an image from a collection (auth required).
  router.delete(p('/collections/:id/images/:imageId'), (req: Request, res: Response) => {
    if (!requireWrite(req, res, 'modify a collection')) return;
    const id = String(req.params.id ?? '');
    const imageId = String(req.params.imageId ?? '');
    if (!ID_RE.test(id) || !ID_RE.test(imageId)) return sendError(res, 400, 'Invalid id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.removeImageFromCollection(id, imageId)) {
        return sendError(res, 404, 'Image not in collection');
      }
      store.bumpRevision();
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to remove image from collection');
    }
  });
}
