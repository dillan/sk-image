import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { App } from './App';

function mockApi() {
  const ok = (json: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: async () => json } as Response);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('/config'))
        return ok({
          widthAllowlist: [320],
          supportedFormats: [],
          maxUploadBytes: 1,
          maxImageCount: 1,
          maxTotalOriginalBytes: 1,
          maxCacheBytes: 1,
        });
      if (u.includes('/collections')) return ok([]);
      if (u.includes('/images')) return ok([]);
      return ok({});
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('App', () => {
  it('renders the primary navigation', () => {
    mockApi();
    render(<App />);
    for (const label of ['Library', 'Collections', 'Settings']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('shows the empty library state when there are no images', async () => {
    mockApi();
    render(<App />);
    expect(
      await screen.findByText('Upload a diagram, safety card, or photo to get started.'),
    ).toBeTruthy();
  });
});
