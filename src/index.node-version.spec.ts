import { expect, test, vi } from 'vitest';
import type { ServerAPI } from '@signalk/server-api';

// Force the "Node too old for node:sqlite" branch regardless of the runner's actual Node version.
// vitest hoists vi.mock above the imports, so ./index picks up the mocked module.
vi.mock('./images/sqlite-support', () => ({
  MIN_NODE_FOR_SQLITE: '22.13.0',
  checkSqliteSupport: () => ({
    ok: false,
    detail:
      'SK Image needs Node 22.13.0 or newer for its built-in SQLite (node:sqlite). This server runs Node 20.19.0.',
  }),
}));

import skImagePlugin from './index';

function appMock() {
  return {
    getDataDirPath: () => '.tmp-sk-image-nodever',
    debug: () => {},
    error: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    notifications: { raise: vi.fn() },
    registerResourceProvider: vi.fn(),
  } as unknown as ServerAPI &
    Record<'setPluginStatus' | 'setPluginError' | 'error', ReturnType<typeof vi.fn>>;
}

test('start() disables the plugin with a clear, visible error when node:sqlite is unavailable', () => {
  const app = appMock();
  const plugin = skImagePlugin(app);

  // It must degrade gracefully, not crash the server.
  expect(() => plugin.start?.({}, () => {})).not.toThrow();

  // User-visible: the Admin UI plugin error names the requirement and the fix.
  expect(app.setPluginError).toHaveBeenCalledTimes(1);
  const msg = app.setPluginError.mock.calls[0][0] as string;
  expect(msg).toContain('Node 22.13.0');
  expect(msg).toContain('disabled');
  // And the server log gets it too.
  expect(app.error).toHaveBeenCalled();

  // It bails out before claiming "Started" or registering providers.
  expect(app.setPluginStatus).not.toHaveBeenCalled();
  expect(
    (app as unknown as { registerResourceProvider: ReturnType<typeof vi.fn> })
      .registerResourceProvider,
  ).not.toHaveBeenCalled();

  // The status line advertises the disabled state with the required version.
  expect(plugin.statusMessage?.()).toContain('Disabled: needs Node 22.13.0+');
});
