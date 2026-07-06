import { useEffect, useRef } from 'react';
import { api } from '../api';

/**
 * Polls the library's cheap change token (`GET /revision`) and calls `onChange` when it moves — so an
 * upload, delete, or collection edit made in another browser/device shows up here without a manual
 * refresh. The first poll only primes the baseline (no `onChange`). Polling pauses while the tab is
 * hidden and catches up the moment it's shown again. Transient/offline errors are ignored and retried
 * on the next tick.
 */
export function useRevisionPolling(onChange: () => void, intervalMs: number): void {
  // Keep the latest onChange in a ref so the polling effect never re-subscribes when the caller
  // passes a fresh closure each render. Updated in an effect (not during render) per react-hooks/refs.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let stopped = false;
    let seen: number | null = null;
    const poll = async () => {
      try {
        const r = await api.revision(); // null on a non-OK response (e.g. 401) — skip this tick
        if (stopped || !r) return;
        if (seen !== null && r.revision !== seen) onChangeRef.current();
        seen = r.revision;
      } catch {
        /* offline or transient network error — retry on the next tick */
      }
    };
    void poll(); // prime `seen` without firing onChange
    const id = setInterval(() => {
      if (!document.hidden) void poll();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}
