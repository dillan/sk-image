import { expect, test } from 'vitest';
import { imageOpenApi } from './openapi';

type OpenApi = {
  openapi: string;
  paths: Record<string, Record<string, { security?: unknown; responses: Record<string, unknown> }>>;
  components: { securitySchemes: Record<string, unknown> };
};

test('imageOpenApi is a valid-shaped OpenAPI 3 document with a cookie security scheme', () => {
  const doc = imageOpenApi() as OpenApi;
  expect(doc.openapi).toBe('3.0.3');
  expect(doc.components.securitySchemes.cookieAuth).toBeDefined();
});

test('write routes are secured and document a 401; read routes are not secured', () => {
  const doc = imageOpenApi() as OpenApi;

  // Upload is a write route: it must declare security and a 401 response.
  const post = doc.paths['/images'].post;
  expect(post.security).toBeDefined();
  expect(post.responses['401']).toBeDefined();

  // Every route named "write access required" carries a 401, so the doc can't drift from the fix.
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.security) {
        expect(
          op.responses['401'],
          `${method.toUpperCase()} ${path} must document 401`,
        ).toBeDefined();
        expect(
          op.responses['403'],
          `${method.toUpperCase()} ${path} must document 403`,
        ).toBeDefined();
      }
    }
  }

  // A read route (list) is open: no per-operation security.
  expect(doc.paths['/images'].get.security).toBeUndefined();
});
