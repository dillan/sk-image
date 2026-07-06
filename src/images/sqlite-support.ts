/**
 * Runtime capability probe for Node's built-in `node:sqlite`.
 *
 * The metadata store is backed by `node:sqlite` (`DatabaseSync`). That module is only usable WITHOUT
 * the `--experimental-sqlite` flag from Node v22.13.0 onward (it was un-flagged on the 22 LTS line in
 * PR #55890). Signal K launches node without that flag, so on an older runtime `require('node:sqlite')`
 * throws. This module has NO static `node:sqlite` import — importing it is always safe — so the plugin
 * can probe first and report a clear message instead of crashing at load with an opaque stack trace.
 */

/** First Node release exposing `node:sqlite` without the `--experimental-sqlite` flag (v22.13.0). */
export const MIN_NODE_FOR_SQLITE = '22.13.0';

export interface SqliteSupport {
  ok: boolean;
  detail: string;
}

/** Compare dotted numeric versions (`major.minor.patch`). True when `actual` is >= `min`. */
export function meetsMinimum(actual: string, min: string): boolean {
  const parts = (v: string): number[] => v.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(actual);
  const m = parts(min);
  for (let i = 0; i < m.length; i += 1) {
    const av = a[i] ?? 0;
    if (av > m[i]) return true;
    if (av < m[i]) return false;
  }
  return true; // equal
}

/**
 * Probe whether `node:sqlite` is usable on this runtime. Checks the Node version first (so the message
 * names the real requirement), then actually loads the module and opens an in-memory database to catch
 * flag-gated or otherwise stripped builds. Never throws.
 */
export function checkSqliteSupport(nodeVersion: string = process.versions.node): SqliteSupport {
  if (!meetsMinimum(nodeVersion, MIN_NODE_FOR_SQLITE)) {
    return {
      ok: false,
      detail: `SK Image needs Node ${MIN_NODE_FOR_SQLITE} or newer for its built-in SQLite (node:sqlite). This server runs Node ${nodeVersion}.`,
    };
  }
  try {
    // Load lazily: a static import would throw at module load on a Node without node:sqlite, before
    // this check could report anything.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    new DatabaseSync(':memory:').close();
    return { ok: true, detail: `node:sqlite is available on Node ${nodeVersion}.` };
  } catch (e) {
    return {
      ok: false,
      detail: `node:sqlite is not available on Node ${nodeVersion}: ${(e as Error).message}`,
    };
  }
}
