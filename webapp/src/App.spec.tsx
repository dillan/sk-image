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

  it('lists images sorted by name ascending on first load', async () => {
    mockApi();
    render(<App />);
    await screen.findByText(/Drag and drop images here/);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/images?sort=name&order=asc'))).toBe(true);
  });

  it('offers the OS photo picker: a multi-file image input inside a label', () => {
    mockApi();
    const { container } = render(<App />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.accept).toBe('image/*');
    expect(input?.multiple).toBe(true);
    expect(input?.closest('label')).toBeTruthy(); // native tap → picker, robust on iOS
  });

  it('shows a persistent drop zone (label-based, so it opens the picker) with upload limits', async () => {
    mockApi();
    const { container } = render(<App />);
    const zone = (await screen.findByText(/Drag and drop images here/)).closest('label');
    expect(zone).toBeTruthy(); // a <label> → tap/click opens the picker on touch
    expect(zone?.querySelector('input[type=file]')).toBeTruthy();
    expect(screen.getByText(/images max/)).toBeTruthy(); // limits hint from /config
    // two pickers on the page now (header button + drop zone), both multi-image
    expect(container.querySelectorAll('input[type=file][multiple]').length).toBe(2);
  });
});
