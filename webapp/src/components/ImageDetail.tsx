import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Collection, ImageAsset } from '../api';
import { CloseIcon, TrashIcon } from './icons';
import { formatBytes } from '../lib/format';

export function ImageDetail({
  image,
  collections,
  onClose,
  onDeleted,
}: {
  image: ImageAsset;
  collections: Collection[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [exif, setExif] = useState<Record<string, unknown> | null>(null);
  const [membership, setMembership] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .exif(image.id)
      .then((e) => setExif(e))
      .catch(() => setExif(null));
  }, [image.id]);

  useEffect(() => {
    // No per-image membership endpoint, so derive it by checking each collection's contents.
    let cancelled = false;
    Promise.all(
      collections.map((c) =>
        api
          .list({ collection: c.id })
          .then((imgs) => (imgs.some((i) => i.id === image.id) ? c.id : null))
          .catch(() => null),
      ),
    ).then((ids) => {
      if (!cancelled) setMembership(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [collections, image.id]);

  const toggle = async (collection: Collection) => {
    setBusy(true);
    try {
      if (membership.has(collection.id)) await api.removeFromCollection(collection.id, image.id);
      else await api.addToCollection(collection.id, image.id);
      setMembership((prev) => {
        const next = new Set(prev);
        if (next.has(collection.id)) next.delete(collection.id);
        else next.add(collection.id);
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!window.confirm(`Delete "${image.name}"? This removes it for everyone on the boat.`))
      return;
    setBusy(true);
    try {
      await api.remove(image.id);
      onDeleted();
    } finally {
      setBusy(false);
    }
  };

  const camera = [image.cameraMake, image.cameraModel].filter(Boolean).join(' ');

  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer__panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer__head">
          <strong className="row__grow tile__name">{image.name}</strong>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <img className="detail__preview" src={api.imageUrl(image.id, 1280)} alt={image.name} />

        <dl className="kv">
          <dt>Format</dt>
          <dd>
            {image.format.toUpperCase()}
            {image.animated ? ' (animated)' : ''}
          </dd>
          {image.width && image.height ? (
            <>
              <dt>Dimensions</dt>
              <dd>
                {image.width} × {image.height}
              </dd>
            </>
          ) : null}
          <dt>Size</dt>
          <dd>{formatBytes(image.bytes)}</dd>
          <dt>Uploaded</dt>
          <dd>{new Date(image.createdAt).toLocaleString()}</dd>
          {image.captureDate ? (
            <>
              <dt>Captured</dt>
              <dd>{new Date(image.captureDate).toLocaleString()}</dd>
            </>
          ) : null}
          {camera ? (
            <>
              <dt>Camera</dt>
              <dd>{camera}</dd>
            </>
          ) : null}
          {image.lat != null && image.lon != null ? (
            <>
              <dt>Location</dt>
              <dd>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${image.lat}&mlon=${image.lon}#map=13/${image.lat}/${image.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {image.lat.toFixed(5)}, {image.lon.toFixed(5)}
                </a>
              </dd>
            </>
          ) : null}
        </dl>

        {collections.length > 0 && (
          <div>
            <div className="panel__title">Collections</div>
            <div className="toolbar">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  className={`chip${membership.has(c.id) ? ' chip--on' : ''}`}
                  onClick={() => void toggle(c)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {exif && Object.keys(exif).length > 0 && (
          <details>
            <summary className="muted">Raw EXIF</summary>
            <pre className="exif mono">{JSON.stringify(exif, null, 2)}</pre>
          </details>
        )}

        <div className="page-head__spacer" />
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={() => void doDelete()}
        >
          <TrashIcon width={18} height={18} /> Delete image
        </button>
      </div>
    </div>
  );
}
