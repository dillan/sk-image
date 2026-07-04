import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { api } from '../api';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

export interface UploadStats {
  total: number; // total bytes across all items
  effectiveTotal: number; // bytes that can actually transfer (excludes failed/cancelled)
  loaded: number; // bytes transferred so far
  percent: number; // 0..100 of the effective target
  speed: number; // bytes/sec (smoothed)
  etaSeconds: number; // remaining / speed (Infinity when unknown)
  done: number;
  failed: number;
  cancelled: number;
  queued: number;
  active: boolean; // any file queued or uploading
}

/**
 * Aggregate byte totals and progress across the batch. Pure — the smoothed `speed` is supplied by
 * the caller. Failed/cancelled files are excluded from the target so they don't peg the bar below
 * 100% or inflate the ETA; a batch where nothing succeeded reads 0%, not 100%.
 */
export function aggregate(items: UploadItem[], speed: number): UploadStats {
  let total = 0;
  let loaded = 0;
  let excludedBytes = 0;
  let done = 0;
  let failed = 0;
  let cancelled = 0;
  let queued = 0;
  let uploading = 0;
  for (const it of items) {
    total += it.size;
    if (it.status === 'done') {
      loaded += it.size;
      done += 1;
    } else if (it.status === 'error') {
      excludedBytes += it.size;
      failed += 1;
    } else if (it.status === 'cancelled') {
      excludedBytes += it.size;
      cancelled += 1;
    } else if (it.status === 'queued') {
      queued += 1;
    } else {
      loaded += Math.min(it.loaded, it.size);
      uploading += 1;
    }
  }
  const effectiveTotal = total - excludedBytes;
  const remaining = Math.max(0, effectiveTotal - loaded);
  const percent =
    effectiveTotal > 0 ? Math.min(100, (loaded / effectiveTotal) * 100) : done > 0 ? 100 : 0;
  const etaSeconds = speed > 0 ? remaining / speed : Infinity;
  return {
    total,
    effectiveTotal,
    loaded,
    percent,
    speed,
    etaSeconds,
    done,
    failed,
    cancelled,
    queued,
    active: queued > 0 || uploading > 0,
  };
}

/** Exponential moving average of transfer speed (bytes/sec). Pure — negative deltas floor to 0. */
export function smoothSpeed(
  prev: number,
  deltaBytes: number,
  deltaSeconds: number,
  alpha = 0.3,
): number {
  if (deltaSeconds <= 0) return prev;
  const instant = Math.max(0, deltaBytes) / deltaSeconds;
  return prev <= 0 ? instant : alpha * instant + (1 - alpha) * prev;
}

let nextId = 0;

/**
 * Drives a multi-file upload: files are uploaded one at a time (clean per-transfer speed/ETA and
 * gentle on a boat's server), each as its own `POST /images`. Adding files while a batch runs
 * appends them. `cancel()` aborts the in-flight transfer and drops the rest. `onEach` fires after
 * every successful upload so the caller can refresh the library.
 *
 * Intended to live above the router so uploads survive tab changes.
 */
export function useUploadQueue(maxBytes: number, onEach: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [speed, setSpeed] = useState(0);
  const itemsRef = useRef<UploadItem[]>([]);
  const filesRef = useRef(new Map<string, File>());
  const pumping = useRef(false);
  const cancelledRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sample = useRef({ t: 0, loaded: 0 });
  const onEachRef = useRef(onEach);
  onEachRef.current = onEach;

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, changes: Partial<UploadItem>) =>
      commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...changes } : it))),
    [commit],
  );
  const transferred = useCallback(
    () =>
      itemsRef.current.reduce(
        (a, it) => a + (it.status === 'done' ? it.size : Math.min(it.loaded, it.size)),
        0,
      ),
    [],
  );

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    cancelledRef.current = false;
    for (;;) {
      const current = itemsRef.current.find((it) => it.status === 'queued');
      if (!current) break;
      const file = filesRef.current.get(current.id);
      if (!file) {
        patch(current.id, { status: 'error', error: 'File is no longer available' });
        continue;
      }
      patch(current.id, { status: 'uploading' });
      // Reset the speed sample per file so idle time between files isn't blamed on the next one.
      sample.current = { t: performance.now(), loaded: transferred() };
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        await api.upload(file, {
          signal: controller.signal,
          onProgress: (loaded) => {
            patch(current.id, { loaded: Math.min(loaded, current.size) });
            const now = performance.now();
            const dt = (now - sample.current.t) / 1000;
            if (dt >= 0.25) {
              const tl = transferred();
              setSpeed((prev) => smoothSpeed(prev, tl - sample.current.loaded, dt));
              sample.current = { t: now, loaded: tl };
            }
          },
        });
        patch(current.id, { status: 'done', loaded: current.size });
        onEachRef.current();
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError' || cancelledRef.current;
        patch(
          current.id,
          aborted
            ? { status: 'cancelled' }
            : { status: 'error', error: (e as Error).message || 'Upload failed' },
        );
      } finally {
        filesRef.current.delete(current.id);
        controllerRef.current = null;
      }
    }
    setSpeed(0);
    pumping.current = false;
  }, [patch, transferred]);

  const enqueue = useCallback(
    (files: File[]) => {
      const limitMb = Math.round(maxBytes / 1024 / 1024);
      const additions: UploadItem[] = files.map((f) => {
        const id = `u${nextId++}`;
        const tooBig = f.size > maxBytes;
        if (!tooBig) filesRef.current.set(id, f);
        return {
          id,
          name: f.name,
          size: f.size,
          loaded: 0,
          status: tooBig ? 'error' : 'queued',
          error: tooBig ? `Larger than ${limitMb} MB` : undefined,
        };
      });
      commit([...itemsRef.current, ...additions]);
      void pump();
    },
    [maxBytes, pump, commit],
  );

  /** Abort the in-flight upload and drop everything still queued/uploading. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    controllerRef.current?.abort();
    commit(
      itemsRef.current.map((it) =>
        it.status === 'queued' || it.status === 'uploading'
          ? { ...it, status: 'cancelled' as const }
          : it,
      ),
    );
  }, [commit]);

  /** Drop finished items (done/failed/cancelled) — leaves any still queued/uploading in place. */
  const clear = useCallback(() => {
    commit(itemsRef.current.filter((it) => it.status === 'queued' || it.status === 'uploading'));
  }, [commit]);

  return { items, stats: aggregate(items, speed), enqueue, cancel, clear };
}

/** Pull real files out of a drop, skipping directories (which browsers surface as bogus "files"). */
function droppedFiles(dt: DataTransfer): File[] {
  const items = dt.items;
  if (items && items.length) {
    const out: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = (
        item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }
      ).webkitGetAsEntry?.();
      if (entry && entry.isDirectory) continue;
      const file = item.getAsFile();
      if (file) out.push(file);
    }
    if (out.length) return out;
  }
  return Array.from(dt.files);
}

/**
 * Drag-and-drop upload support. Returns whether files are being dragged over the target and the DOM
 * handlers to spread onto it. A depth counter keeps the overlay steady while the pointer moves over
 * nested children (each fires its own dragenter/dragleave).
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  }, []);
  const onDragOver = useCallback((e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault(); // allow the drop
  }, []);
  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setDragging(false);
    }
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = droppedFiles(e.dataTransfer);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return { dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
