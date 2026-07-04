import type { IRouter, Request, Response } from 'express';
import multer from 'multer';
import { ImageStore, ImageValidationError, MAX_UPLOAD_BYTES } from './image-store';
import { type SkRequest, isAuthorizedWriter, principalId } from './sk-request';

const ID_RE = /^[A-Za-z0-9-]+$/;

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}
function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
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

/** Register the image-asset routes on the plugin's Express router (mounted at /plugins/sk-image). */
export function registerImageRoutes(router: IRouter, deps: ImageRouterDeps): void {
  const isAuth = deps.isAuthenticated ?? isAuthorizedWriter;
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
  router.get('/config', (_req: Request, res: Response) => {
    res.json(deps.getConfig ? deps.getConfig() : {});
  });

  // POST /images — upload (auth required; auth is checked BEFORE multipart parsing).
  router.post('/images', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to upload images');
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
  router.get('/images', (req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    const query = (req.query ?? {}) as { sort?: unknown; order?: unknown; collection?: unknown };
    const sort = query.sort === 'name' || query.sort === 'date' ? query.sort : undefined;
    const order = query.order === 'asc' || query.order === 'desc' ? query.order : undefined;
    const collectionRaw = typeof query.collection === 'string' ? query.collection : undefined;
    const collection = collectionRaw && ID_RE.test(collectionRaw) ? collectionRaw : undefined;
    void (async () => {
      try {
        res.json(await store.list({ sort, order, collection }));
      } catch {
        sendError(res, 500, 'Failed to list images');
      }
    })();
  });

  // Cache routes MUST be registered before /images/:id so "cache" is not matched as an id.
  router.get('/images/cache', (_req: Request, res: Response) => {
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

  router.delete('/images/cache', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to purge the image cache');
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
  router.get('/images/:id', (req: Request, res: Response) => {
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
  router.delete('/images/:id', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to delete images');
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid image id');
    const store = getStore(res);
    if (!store) return;
    void (async () => {
      try {
        const removed = await store.remove(id);
        if (!removed) return sendError(res, 404, 'Image not found');
        res.json({ ok: true });
      } catch {
        sendError(res, 500, 'Failed to delete image');
      }
    })();
  });

  // GET /images/:id/exif — full raw EXIF for one image (null when none was captured).
  router.get('/images/:id/exif', (req: Request, res: Response) => {
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
  router.get('/collections', (_req: Request, res: Response) => {
    const store = getStore(res);
    if (!store) return;
    try {
      res.json(store.listCollections());
    } catch {
      sendError(res, 500, 'Failed to list collections');
    }
  });

  // POST /collections { name } — create a collection (auth required).
  router.post('/collections', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to create a collection');
    const name = sanitizeName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return sendError(res, 400, 'A collection name is required');
    const store = getStore(res);
    if (!store) return;
    try {
      return sendJson(res, 201, store.createCollection(name));
    } catch {
      return sendError(res, 500, 'Failed to create collection');
    }
  });

  // PUT /collections/:id { name } — rename a collection (auth required).
  router.put('/collections/:id', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to rename a collection');
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid collection id');
    const name = sanitizeName((req.body as { name?: unknown } | undefined)?.name);
    if (!name) return sendError(res, 400, 'A collection name is required');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.renameCollection(id, name)) return sendError(res, 404, 'Collection not found');
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to rename collection');
    }
  });

  // DELETE /collections/:id — delete a collection (auth required). The images themselves are kept.
  router.delete('/collections/:id', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to delete a collection');
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id)) return sendError(res, 400, 'Invalid collection id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.deleteCollection(id)) return sendError(res, 404, 'Collection not found');
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to delete collection');
    }
  });

  // POST /collections/:id/images/:imageId — add an image to a collection (auth required).
  router.post('/collections/:id/images/:imageId', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to modify a collection');
    const id = String(req.params.id ?? '');
    const imageId = String(req.params.imageId ?? '');
    if (!ID_RE.test(id) || !ID_RE.test(imageId)) return sendError(res, 400, 'Invalid id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.addImageToCollection(id, imageId)) {
        return sendError(res, 404, 'Collection or image not found');
      }
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to add image to collection');
    }
  });

  // DELETE /collections/:id/images/:imageId — remove an image from a collection (auth required).
  router.delete('/collections/:id/images/:imageId', (req: Request, res: Response) => {
    if (!isAuth(req)) return sendError(res, 401, 'Login required to modify a collection');
    const id = String(req.params.id ?? '');
    const imageId = String(req.params.imageId ?? '');
    if (!ID_RE.test(id) || !ID_RE.test(imageId)) return sendError(res, 400, 'Invalid id');
    const store = getStore(res);
    if (!store) return;
    try {
      if (!store.removeImageFromCollection(id, imageId)) {
        return sendError(res, 404, 'Image not in collection');
      }
      return res.json({ ok: true });
    } catch {
      return sendError(res, 500, 'Failed to remove image from collection');
    }
  });
}
