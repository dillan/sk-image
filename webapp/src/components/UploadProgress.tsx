import type { UploadItem, UploadStats } from '../lib/uploads';
import { formatBytes, formatSpeed, formatDuration } from '../lib/format';

/** The live upload panel: overall progress (%, speed, ETA) plus a per-file list. */
export function UploadProgress({
  items,
  stats,
  onCancel,
  onClear,
}: {
  items: UploadItem[];
  stats: UploadStats;
  onCancel: () => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const total = items.length;

  return (
    <div className="panel uploads" role="status" aria-live="polite">
      <div className="uploads__head">
        <div className="panel__title" style={{ margin: 0 }}>
          {stats.active
            ? `Uploading… ${stats.done} of ${total} done`
            : `Uploaded ${stats.done} of ${total}`}
        </div>
        {stats.active ? (
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={onClear}>
            Dismiss
          </button>
        )}
      </div>

      <div className="bar">
        <div className="bar__fill" style={{ width: `${stats.percent}%` }} />
      </div>

      <div className="uploads__stats muted">
        <span>{Math.round(stats.percent)}%</span>
        <span>
          {formatBytes(stats.loaded)} / {formatBytes(stats.effectiveTotal)}
        </span>
        {stats.active && stats.speed > 0 && <span>{formatSpeed(stats.speed)}</span>}
        {stats.active && Number.isFinite(stats.etaSeconds) && (
          <span>~{formatDuration(stats.etaSeconds)} left</span>
        )}
        {stats.failed > 0 && <span className="chip chip--caution">{stats.failed} failed</span>}
        {stats.cancelled > 0 && <span className="muted">{stats.cancelled} cancelled</span>}
      </div>

      <ul className="uploads__list">
        {items.map((it) => (
          <li key={it.id} className="uploads__item">
            <span className="uploads__name">{it.name}</span>
            <span className="uploads__file-status">
              {it.status === 'done' && <span aria-label="uploaded">✓</span>}
              {it.status === 'queued' && <span className="muted">queued</span>}
              {it.status === 'uploading' && (
                <span>
                  {it.size > 0 ? Math.min(100, Math.round((it.loaded / it.size) * 100)) : 0}%
                </span>
              )}
              {it.status === 'cancelled' && <span className="muted">cancelled</span>}
              {it.status === 'error' && <span className="chip chip--caution">{it.error}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
