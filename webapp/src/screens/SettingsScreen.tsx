import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { CacheStats, PluginConfig } from '../api';
import { formatBytes } from '../lib/format';

export function SettingsScreen({ config }: { config: PluginConfig | null }) {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .cacheStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const purge = async () => {
    if (
      !window.confirm(
        'Purge the resized-image cache? Originals are kept and variants regenerate on demand.',
      )
    )
      return;
    setBusy(true);
    try {
      await api.purgeCache();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <div className="panel">
        <div className="panel__title">Image cache</div>
        <p className="muted">
          Resized copies the server keeps so images load fast. Safe to purge — your originals are
          untouched and variants regenerate on demand.
        </p>
        <dl className="kv">
          <dt>Cache size</dt>
          <dd>{stats ? formatBytes(stats.bytes) : '—'}</dd>
          <dt>Cache budget</dt>
          <dd>{config ? formatBytes(config.maxCacheBytes) : '—'}</dd>
          <dt>Cached files</dt>
          <dd>{stats ? stats.files : '—'}</dd>
        </dl>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <button type="button" className="iconbtn" onClick={refresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => void purge()}
          >
            Purge cache
          </button>
        </div>
      </div>
    </>
  );
}
