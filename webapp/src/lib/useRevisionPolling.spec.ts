import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { api } from '../api';
import { useRevisionPolling } from './useRevisionPolling';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useRevisionPolling', () => {
  it('fires onChange when the revision moves, but not on the first poll', async () => {
    let revision = 5;
    vi.spyOn(api, 'revision').mockImplementation(async () => ({ revision }));
    const onChange = vi.fn();
    vi.useFakeTimers();
    renderHook(() => useRevisionPolling(onChange, 1000));

    await vi.advanceTimersByTimeAsync(0); // flush the priming poll
    expect(onChange).not.toHaveBeenCalled(); // baseline only

    revision = 6;
    await vi.advanceTimersByTimeAsync(1000); // next tick sees the change (another browser uploaded)
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // unchanged since → no extra refresh
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores a failed poll and recovers without a spurious refresh', async () => {
    const spy = vi.spyOn(api, 'revision').mockRejectedValueOnce(new Error('offline'));
    const onChange = vi.fn();
    vi.useFakeTimers();
    renderHook(() => useRevisionPolling(onChange, 1000));

    await vi.advanceTimersByTimeAsync(0); // failed prime — swallowed, no throw, no change
    expect(onChange).not.toHaveBeenCalled();

    spy.mockResolvedValue({ revision: 1 });
    await vi.advanceTimersByTimeAsync(1000); // first success primes the baseline
    await vi.advanceTimersByTimeAsync(1000); // still 1 → no change
    expect(onChange).not.toHaveBeenCalled();
  });
});
