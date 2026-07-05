import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

// What this pins: on a SECURED signalk-server (>= 2.30.0) the server registers
// `app.use('/plugins', adminAuthenticationMiddleware)` in setupApp, which requires `admin` and 401s
// read-write / read-only / anonymous requests BEFORE any plugin router runs. So the sk-image REST
// API is effectively ADMIN-ONLY under security — the plugin's own read-only/GPS/403 gates never get
// a chance to run. This spec asserts that reality (not the plugin's intended fine-grained matrix).
//
// The secured server has three baked users (see e2e/signalk-config-secured/security.json):
//   admin/adminpw (admin), writer/writerpw (readwrite), reader/readerpw (readonly),
// and allow_readonly:true — to show that even an anonymous "readonly" visitor is still 401'd.

// A 1x1 PNG (valid magic bytes) so the plugin accepts the admin upload.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const IMAGES = '/plugins/sk-image/images';

async function login(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const res = await request.post('/signalk/v1/auth/login', { data: { username, password } });
  expect(res.status(), `login as ${username}`).toBe(200);
  const body = (await res.json()) as { token: string };
  expect(body.token, `token for ${username}`).toBeTruthy();
  return body.token;
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('secured server: sk-image REST API is admin-only (the server admin-gates /plugins)', () => {
  test('anonymous GET is rejected (401) even with allow_readonly on', async ({ request }) => {
    const res = await request.get(IMAGES);
    expect(res.status()).toBe(401);
  });

  test('a read-only user GET is rejected (401)', async ({ request }) => {
    const res = await request.get(IMAGES, {
      headers: bearer(await login(request, 'reader', 'readerpw')),
    });
    expect(res.status()).toBe(401);
  });

  test('a read-write user GET is rejected (401)', async ({ request }) => {
    const res = await request.get(IMAGES, {
      headers: bearer(await login(request, 'writer', 'writerpw')),
    });
    expect(res.status()).toBe(401);
  });

  test('anonymous POST (write) is rejected by the server (401)', async ({ request }) => {
    const res = await request.post(IMAGES, {
      multipart: { file: { name: 'e2e.png', mimeType: 'image/png', buffer: PNG_1x1 } },
    });
    expect(res.status()).toBe(401);
  });

  test('an admin user can list (200) and upload (201)', async ({ request }) => {
    const token = await login(request, 'admin', 'adminpw');

    const list = await request.get(IMAGES, { headers: bearer(token) });
    expect(list.status()).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);

    const upload = await request.post(IMAGES, {
      headers: bearer(token),
      multipart: { file: { name: 'e2e.png', mimeType: 'image/png', buffer: PNG_1x1 } },
    });
    expect(upload.status()).toBe(201);
  });
});
