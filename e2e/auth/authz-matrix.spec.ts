import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

// What this pins, on a SECURED signalk-server (>= 2.30.0), is the plugin's two-mount access model:
//
//   1. `/plugins/sk-image/*` is admin-only. The server registers
//      `app.use('/plugins', adminAuthenticationMiddleware)` in setupApp, which requires `admin` and
//      401s read-write / read-only / anonymous requests BEFORE any plugin router runs. So the
//      backward-compatible alias is reachable only by admins under security.
//
//   2. `/signalk/v1/api/sk-image/*` (via `signalKApiRoutes`) is NOT admin-gated, so ordinary crew
//      reach it and the plugin's OWN fine-grained auth applies: reads are open (subject to the read
//      ACL), writes need read-write/admin (anonymous -> 401, logged-in read-only -> 403). This is the
//      mount the web app uses, and the v2 `images` resource type + the `/sk-image` web app bundle are
//      reachable by crew too.
//
// The secured server has three baked users (see e2e/signalk-config-secured/security.json):
//   admin/adminpw (admin), writer/writerpw (readwrite), reader/readerpw (readonly),
// and allow_readonly:true (so an anonymous visitor is a read-only principal).

// A 1x1 PNG (valid magic bytes) so the plugin accepts an upload.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PLUGINS_IMAGES = '/plugins/sk-image/images';
const API = '/signalk/v1/api/sk-image';
const RESOURCES = '/signalk/v2/api/resources/images';

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
const upload = (name: string) => ({
  multipart: { file: { name, mimeType: 'image/png', buffer: PNG_1x1 } },
});

test.describe('secured server: the /plugins/sk-image alias is admin-only', () => {
  test('anonymous GET is rejected (401) even with allow_readonly on', async ({ request }) => {
    expect((await request.get(PLUGINS_IMAGES)).status()).toBe(401);
  });

  test('a read-only user GET is rejected (401)', async ({ request }) => {
    const res = await request.get(PLUGINS_IMAGES, {
      headers: bearer(await login(request, 'reader', 'readerpw')),
    });
    expect(res.status()).toBe(401);
  });

  test('a read-write user GET is rejected (401)', async ({ request }) => {
    const res = await request.get(PLUGINS_IMAGES, {
      headers: bearer(await login(request, 'writer', 'writerpw')),
    });
    expect(res.status()).toBe(401);
  });

  test('an admin user can list (200) and upload (201)', async ({ request }) => {
    const token = await login(request, 'admin', 'adminpw');
    const list = await request.get(PLUGINS_IMAGES, { headers: bearer(token) });
    expect(list.status()).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);
    const up = await request.post(PLUGINS_IMAGES, { headers: bearer(token), ...upload('e2e.png') });
    expect(up.status()).toBe(201);
  });
});

test.describe('secured server: /signalk/v1/api/sk-image is crew-reachable (plugin auth applies)', () => {
  test('crew can READ the library: anon, reader, and writer all get 200', async ({ request }) => {
    expect((await request.get(`${API}/config`)).status()).toBe(200);
    expect((await request.get(`${API}/images`)).status()).toBe(200);

    const reader = await login(request, 'reader', 'readerpw');
    expect((await request.get(`${API}/images`, { headers: bearer(reader) })).status()).toBe(200);

    const writer = await login(request, 'writer', 'writerpw');
    expect((await request.get(`${API}/images`, { headers: bearer(writer) })).status()).toBe(200);
  });

  test('the write gate applies: anon 401, read-only 403, read-write 201', async ({ request }) => {
    // Anonymous (not logged in) -> 401 so the client knows to log in.
    expect((await request.post(`${API}/images`, upload('anon.png'))).status()).toBe(401);

    // Logged-in read-only -> 403 (authenticated, but lacks write permission — no login loop).
    const reader = await login(request, 'reader', 'readerpw');
    const ro = await request.post(`${API}/images`, {
      headers: bearer(reader),
      ...upload('ro.png'),
    });
    expect(ro.status()).toBe(403);

    // Logged-in read-write -> 201 (the whole point: crew with write access can manage the library).
    const writer = await login(request, 'writer', 'writerpw');
    const rw = await request.post(`${API}/images`, {
      headers: bearer(writer),
      ...upload('rw.png'),
    });
    expect(rw.status()).toBe(201);
  });

  test('the /sk-image web app bundle loads for anonymous and read-only crew', async ({
    request,
  }) => {
    expect((await request.get('/sk-image/')).status()).toBe(200);
    const reader = await login(request, 'reader', 'readerpw');
    expect((await request.get('/sk-image/', { headers: bearer(reader) })).status()).toBe(200);
  });
});

test.describe('secured server: the v2 images resource type', () => {
  test('is crew-readable and never exposes capture GPS', async ({ request }) => {
    // Seed at least one image so the resource list is non-trivial.
    const writer = await login(request, 'writer', 'writerpw');
    await request.post(`${API}/images`, { headers: bearer(writer), ...upload('res.png') });

    const res = await request.get(RESOURCES);
    expect(res.status()).toBe(200);
    const map = (await res.json()) as Record<string, Record<string, unknown>>;
    const docs = Object.values(map);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      // Byte URL points at the crew-reachable mount; location is never present.
      expect(String(doc.url)).toContain('/signalk/v1/api/sk-image/images/');
      expect('lat' in doc).toBe(false);
      expect('lon' in doc).toBe(false);
    }
  });
});
