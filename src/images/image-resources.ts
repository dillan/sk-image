import type { ResourceProvider } from '@signalk/server-api';
import type { ImageMeta } from './image-store';
import { SIGNALK_V1_IMAGE_BASE } from './image-router';

/**
 * A v2 Resource provider that exposes the image library as the custom `images` resource type at
 * `/signalk/v2/api/resources/images`. This is the discoverable, OpenAPI-described metadata layer:
 * generic Signal K clients can list images and follow each doc's `url` to fetch the bytes from the
 * crew-reachable `/signalk/v1/api/sk-image` mount.
 *
 * Two deliberate constraints, both because the Resource-provider methods receive NO request
 * principal (unlike the REST routes, which can gate on the logged-in user):
 *   1. Docs never carry capture GPS (`lat`/`lon`) — there is no way to authorize a location read
 *      here, so it is always withheld. Sensitive metadata stays on the authenticated REST routes
 *      (`GET /images` for logged-in users, `GET /images/:id/exif`).
 *   2. The resource is read-only. Uploads and deletes go through the REST route, which owns the
 *      binary handling, content validation, and write authorization; mirroring them here would
 *      fork the write path. `setResource` / `deleteResource` therefore reject.
 */

/** The subset of the image store the resource provider reads from (list + single lookup). */
export interface ResourceStore {
  list(opts?: {
    sort?: 'name' | 'date';
    order?: 'asc' | 'desc';
    collection?: string;
  }): Promise<ImageMeta[]>;
  getMeta(id: string): Promise<ImageMeta | null>;
}

export interface ImageResourceDeps {
  resolveStore: () => ResourceStore | null;
}

const READ_ONLY_MESSAGE =
  'The images resource is read-only; upload or delete via the SK Image API ' +
  `(POST/DELETE ${SIGNALK_V1_IMAGE_BASE}/images/:id).`;

/** Project stored metadata to a resource doc: drop sensitive fields, add a byte URL + a $source tag. */
function toResourceDoc(meta: ImageMeta): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...meta };
  // No principal is available here to authorize per-user-sensitive reads, so drop them entirely:
  // capture location, and the uploader's username (an audit field anonymous clients must not see).
  delete doc.lat;
  delete doc.lon;
  delete doc.uploadedBy;
  doc.url = `${SIGNALK_V1_IMAGE_BASE}/images/${meta.id}`;
  doc.$source = 'sk-image';
  return doc;
}

/** Resolve a dot-path (e.g. `feature.geometry.type`) against a resource doc. */
function resolveProperty(doc: Record<string, unknown>, property: string): unknown {
  return property.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, doc);
}

export function createImageResourceProvider(deps: ImageResourceDeps): ResourceProvider {
  return {
    type: 'images',
    methods: {
      async listResources(query) {
        const store = deps.resolveStore();
        if (!store) return {};
        const collection = typeof query.collection === 'string' ? query.collection : undefined;
        const items = await store.list(collection ? { collection } : undefined);
        const out: Record<string, unknown> = {};
        for (const meta of items) out[meta.id] = toResourceDoc(meta);
        return out;
      },
      async getResource(id, property) {
        const store = deps.resolveStore();
        if (!store) throw new Error('Image service is not ready');
        const meta = await store.getMeta(id);
        if (!meta) throw new Error(`No image resource with id ${id}`);
        const doc = toResourceDoc(meta);
        if (property) {
          const value = resolveProperty(doc, property);
          if (value === undefined) throw new Error(`No property ${property} on image ${id}`);
          return { value };
        }
        return doc;
      },
      setResource() {
        return Promise.reject(new Error(READ_ONLY_MESSAGE));
      },
      deleteResource() {
        return Promise.reject(new Error(READ_ONLY_MESSAGE));
      },
    },
  };
}
