import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

function okResponse(status: number, json: unknown): Response {
  return { ok: status < 400, status, json: async () => json } as Response;
}

describe('api', () => {
  it('builds variant URLs at a snapped width', () => {
    expect(api.imageUrl('abc', 320)).toBe('/plugins/sk-image/images/abc?w=320');
    expect(api.imageUrl('a b', 640)).toBe('/plugins/sk-image/images/a%20b?w=640');
  });

  it('list builds a query string from sort/order/collection and sends the cookie', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(okResponse(200, [])),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.list({ sort: 'name', order: 'asc', collection: 'c1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/plugins/sk-image/images?sort=name&order=asc&collection=c1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('list omits the query string when no options are given', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(okResponse(200, [])),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api.list();
    expect(fetchMock.mock.calls[0][0]).toBe('/plugins/sk-image/images');
  });

  it('createCollection POSTs JSON', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(okResponse(201, { id: 'x', name: 'Deck', createdAt: '', imageCount: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const created = await api.createCollection('Deck');
    expect(created.id).toBe('x');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/plugins/sk-image/collections');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'Deck' }));
  });

  it('surfaces a server error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse(500, { error: 'boom' }))),
    );
    await expect(api.cacheStats()).rejects.toThrow('boom');
  });
});
