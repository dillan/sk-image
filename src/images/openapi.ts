/**
 * OpenAPI definition for the image API served under `/plugins/sk-image`.
 *
 * The plugin returns this from `Plugin.getOpenApi()` so the Signal K admin UI lists it under
 * Documentation -> OpenAPI, the same way the server's own v2 APIs are described. Paths are relative
 * to the plugin mount (declared via `servers`). It is a static document — there is no runtime state.
 */

// Reused pieces so the many routes stay consistent and readable.
const SECURED = [{ cookieAuth: [] as string[] }];
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const jsonResponse = (description: string, schemaRef: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: schemaRef } } },
});
const okResponse = {
  description: 'Success',
  content: {
    'application/json': {
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    },
  },
};
const nameBody = {
  required: true,
  content: {
    'application/json': {
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
};
const idParam = (name: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9-]+$' },
});

/** The OpenAPI 3.0.3 description of the `/plugins/sk-image` HTTP API. */
export function imageOpenApi(): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'SK Image',
      // Cosmetic doc version; the npm package version is the source of truth for releases.
      version: '1.0.0',
      description:
        'Secure image library for Signal K: upload, on-demand resize/re-encode to WebP, a ' +
        'size-capped disk cache, EXIF, and collections. Read routes are open; writes require a ' +
        'read-write or admin principal.',
    },
    servers: [{ url: '/plugins/sk-image' }],
    components: {
      securitySchemes: {
        // Signal K authenticates browser clients with a session cookie.
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'JAUTHENTICATION' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
        },
        ImageMeta: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            format: { type: 'string', enum: ['svg', 'jpeg', 'png', 'webp', 'gif', 'heic'] },
            width: { type: 'integer', nullable: true },
            height: { type: 'integer', nullable: true },
            bytes: { type: 'integer' },
            animated: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            uploadedBy: { type: 'string', nullable: true },
            captureDate: { type: 'string', format: 'date-time', nullable: true },
            lat: { type: 'number', nullable: true },
            lon: { type: 'number', nullable: true },
            cameraMake: { type: 'string', nullable: true },
            cameraModel: { type: 'string', nullable: true },
            orientation: { type: 'integer', nullable: true },
          },
          required: ['id', 'name', 'format', 'bytes', 'animated', 'createdAt'],
        },
        Collection: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            imageCount: { type: 'integer' },
          },
          required: ['id', 'name', 'createdAt'],
        },
        CacheStats: {
          type: 'object',
          properties: { bytes: { type: 'integer' }, files: { type: 'integer' } },
          required: ['bytes', 'files'],
        },
        Config: {
          type: 'object',
          properties: {
            widthAllowlist: { type: 'array', items: { type: 'integer' } },
            supportedFormats: { type: 'array', items: { type: 'string' } },
            maxUploadBytes: { type: 'integer' },
            maxImageCount: { type: 'integer' },
            maxTotalOriginalBytes: { type: 'integer' },
            maxCacheBytes: { type: 'integer' },
          },
        },
      },
    },
    // Read routes are unauthenticated; write routes override `security` below and document 401.
    security: [],
    paths: {
      '/config': {
        get: {
          summary: 'Capabilities (supported widths, formats, size limits).',
          responses: { '200': jsonResponse('Capabilities', '#/components/schemas/Config') },
        },
      },
      '/images': {
        get: {
          summary:
            'List the image library (capture GPS omitted for anonymous clients on a secured server).',
          parameters: [
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['name', 'date'] } },
            { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
            { name: 'collection', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Image metadata',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/ImageMeta' } },
                },
              },
            },
          },
        },
        post: {
          summary: 'Upload an image (write access required).',
          security: SECURED,
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { file: { type: 'string', format: 'binary' } },
                  required: ['file'],
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Stored image metadata', '#/components/schemas/ImageMeta'),
            '400': errorResponse('No file provided'),
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '413': errorResponse('File exceeds the size limit'),
            '415': errorResponse('Unsupported or unsafe content'),
          },
        },
      },
      '/images/{id}': {
        get: {
          summary: 'Serve a resized WebP variant (or sanitized SVG).',
          parameters: [idParam('id'), { name: 'w', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'Image bytes',
              content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
            },
            '400': errorResponse('Invalid image id'),
            '404': errorResponse('Image not found'),
          },
        },
        delete: {
          summary: 'Delete an image (write access required).',
          security: SECURED,
          parameters: [idParam('id')],
          responses: {
            '200': okResponse,
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '404': errorResponse('Image not found'),
          },
        },
      },
      '/images/{id}/exif': {
        get: {
          summary:
            'Full raw EXIF for one image (login required on a secured server; may contain GPS).',
          parameters: [idParam('id')],
          responses: {
            '200': { description: 'Raw EXIF, or null', content: { 'application/json': {} } },
            '401': errorResponse('Login required to view EXIF (secured server, anonymous request)'),
            '404': errorResponse('Image not found'),
          },
        },
      },
      '/images/cache': {
        get: {
          summary: 'Cache size and file count.',
          responses: { '200': jsonResponse('Cache stats', '#/components/schemas/CacheStats') },
        },
        delete: {
          summary: 'Purge generated variants (write access required).',
          security: SECURED,
          responses: {
            '200': okResponse,
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
          },
        },
      },
      '/collections': {
        get: {
          summary: 'List collections with image counts.',
          responses: {
            '200': {
              description: 'Collections',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Collection' } },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create a collection (write access required).',
          security: SECURED,
          requestBody: nameBody,
          responses: {
            '201': jsonResponse('Created collection', '#/components/schemas/Collection'),
            '400': errorResponse('A collection name is required'),
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
          },
        },
      },
      '/collections/{id}': {
        put: {
          summary: 'Rename a collection (write access required).',
          security: SECURED,
          parameters: [idParam('id')],
          requestBody: nameBody,
          responses: {
            '200': okResponse,
            '400': errorResponse('A collection name is required'),
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '404': errorResponse('Collection not found'),
          },
        },
        delete: {
          summary: 'Delete a collection; images are kept (write access required).',
          security: SECURED,
          parameters: [idParam('id')],
          responses: {
            '200': okResponse,
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '404': errorResponse('Collection not found'),
          },
        },
      },
      '/collections/{id}/images/{imageId}': {
        post: {
          summary: 'Add an image to a collection (write access required).',
          security: SECURED,
          parameters: [idParam('id'), idParam('imageId')],
          responses: {
            '200': okResponse,
            '400': errorResponse('Invalid id'),
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '404': errorResponse('Collection or image not found'),
          },
        },
        delete: {
          summary: 'Remove an image from a collection (write access required).',
          security: SECURED,
          parameters: [idParam('id'), idParam('imageId')],
          responses: {
            '200': okResponse,
            '400': errorResponse('Invalid id'),
            '401': errorResponse('Login required (anonymous request)'),
            '403': errorResponse('Insufficient permission (read-only account)'),
            '404': errorResponse('Image not in collection'),
          },
        },
      },
    },
  };
}
