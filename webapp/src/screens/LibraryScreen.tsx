import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Collection, ImageAsset, SortKey, SortOrder } from '../api';
import { ImageDetail } from '../components/ImageDetail';
import { UploadButton } from '../components/UploadButton';
import { useFileDrop } from '../lib/uploads';
import { formatBytes } from '../lib/format';

function meta(image: ImageAsset): string {
  const dims =
    image.width && image.height ? `${image.width}×${image.height}` : image.format.toUpperCase();
  return `${dims} · ${formatBytes(image.bytes)}`;
}

export function LibraryScreen({
  collections,
  enqueue,
  uploadTick,
}: {
  collections: Collection[];
  enqueue: (files: File[]) => void;
  uploadTick: number;
}) {
  const [images, setImages] = useState<ImageAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('date');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [collection, setCollection] = useState<string>('');
  const [selected, setSelected] = useState<ImageAsset | null>(null);
  const reqToken = useRef(0);

  const refresh = useCallback(() => {
    const token = ++reqToken.current; // latest-wins: ignore out-of-order list responses
    api
      .list({ sort, order, collection: collection || undefined })
      .then((imgs) => {
        if (token !== reqToken.current) return;
        setImages(imgs);
        setError(null);
      })
      .catch((e: Error) => {
        if (token !== reqToken.current) return;
        setImages([]);
        setError(e.message);
      });
  }, [sort, order, collection]);

  // Refresh on mount, on sort/filter change, and whenever an upload completes (uploadTick bumps).
  useEffect(() => refresh(), [refresh, uploadTick]);

  const drop = useFileDrop(enqueue);

  return (
    <div className="library" {...drop.handlers}>
      {drop.dragging && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone__inner">Drop images to upload</div>
        </div>
      )}
      <div className="page-head">
        <h1>Image library</h1>
        <div className="page-head__spacer" />
        <UploadButton onFiles={enqueue} />
      </div>

      <div className="toolbar">
        <span className="toolbar__label">Sort</span>
        <div className="seg">
          <button
            type="button"
            className={`iconbtn${sort === 'name' ? ' iconbtn--on' : ''}`}
            onClick={() => setSort('name')}
          >
            Name
          </button>
          <button
            type="button"
            className={`iconbtn${sort === 'date' ? ' iconbtn--on' : ''}`}
            onClick={() => setSort('date')}
          >
            Date
          </button>
        </div>
        <button
          type="button"
          className="iconbtn"
          onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
        >
          {order === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
        </button>

        {collections.length > 0 && (
          <>
            <div className="page-head__spacer" />
            <button
              type="button"
              className={`chip${collection === '' ? ' chip--on' : ''}`}
              onClick={() => setCollection('')}
            >
              All
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${collection === c.id ? ' chip--on' : ''}`}
                onClick={() => setCollection(c.id)}
              >
                {c.name} <span className="muted">{c.imageCount}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {error && <div className="chip chip--caution">Couldn&apos;t load images ({error})</div>}

      {images && images.length === 0 && !error && (
        <div className="empty">
          <p>No images{collection ? ' in this collection' : ''} yet.</p>
          <p className="muted">Upload a diagram, safety card, or photo to get started.</p>
        </div>
      )}

      {images && images.length > 0 && (
        <div className="grid">
          {images.map((image) => (
            <button
              key={image.id}
              type="button"
              className="tile"
              onClick={() => setSelected(image)}
            >
              <img
                className="tile__thumb"
                loading="lazy"
                src={api.imageUrl(image.id, 320)}
                alt={image.name}
              />
              <div className="tile__body">
                <div className="tile__name">{image.name}</div>
                <div className="tile__meta">{meta(image)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ImageDetail
          image={selected}
          collections={collections}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
