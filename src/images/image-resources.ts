import type { ImageMeta } from './image-store';

// RED skeleton — intentionally incomplete. The resource docs still carry capture GPS and the
// write methods resolve instead of rejecting; image-resources.spec.ts fails on that behavior and
// the GREEN step (strip GPS, add the byte URL, reject writes) makes it pass.

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

export function createImageResourceProvider(deps: ImageResourceDeps): {
  type: string;
  methods: {
    listResources(query: Record<string, unknown>): Promise<Record<string, unknown>>;
    getResource(id: string, property?: string): Promise<object>;
    setResource(id: string, value: Record<string, unknown>): Promise<void>;
    deleteResource(id: string): Promise<void>;
  };
} {
  const toDoc = (meta: ImageMeta): Record<string, unknown> => ({ ...meta });

  return {
    type: 'images',
    methods: {
      async listResources() {
        const store = deps.resolveStore();
        if (!store) return {};
        const items = await store.list();
        const out: Record<string, unknown> = {};
        for (const meta of items) out[meta.id] = toDoc(meta);
        return out;
      },
      async getResource(id) {
        const store = deps.resolveStore();
        if (!store) throw new Error('Image service is not ready');
        const meta = await store.getMeta(id);
        if (!meta) throw new Error(`No image resource with id ${id}`);
        return toDoc(meta);
      },
      async setResource() {
        return;
      },
      async deleteResource() {
        return;
      },
    },
  };
}
