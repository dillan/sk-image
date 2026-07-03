import { useState } from 'react';
import { api } from '../api';
import type { Collection } from '../api';

export function CollectionsScreen({
  collections,
  onChange,
}: {
  collections: Collection[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await api.createCollection(trimmed);
      setName('');
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const rename = async (collection: Collection) => {
    const next = window.prompt('Rename collection', collection.name)?.trim();
    if (!next || next === collection.name) return;
    await api.renameCollection(collection.id, next);
    onChange();
  };

  const remove = async (collection: Collection) => {
    if (!window.confirm(`Delete collection "${collection.name}"? The images themselves are kept.`))
      return;
    await api.deleteCollection(collection.id);
    onChange();
  };

  return (
    <>
      <div className="page-head">
        <h1>Collections</h1>
      </div>

      <div className="panel">
        <div className="panel__title">New collection</div>
        <div className="toolbar" style={{ margin: 0 }}>
          <input
            aria-label="Collection name"
            placeholder="e.g. Deck plans"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            style={{
              minHeight: 'var(--tap-min)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-1)',
              color: 'var(--text-primary)',
              font: 'inherit',
              flex: 1,
            }}
          />
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !name.trim()}
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
      </div>

      <div className="panel">
        {collections.length === 0 ? (
          <div className="empty">
            <p>No collections yet.</p>
            <p className="muted">
              Group related images — deck plans, safety cards, reference photos.
            </p>
          </div>
        ) : (
          collections.map((collection) => (
            <div key={collection.id} className="row">
              <div className="row__grow">
                <strong>{collection.name}</strong>{' '}
                <span className="muted">
                  {collection.imageCount} image{collection.imageCount === 1 ? '' : 's'}
                </span>
              </div>
              <button type="button" className="iconbtn" onClick={() => void rename(collection)}>
                Rename
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void remove(collection)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
