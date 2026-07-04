import { describe, it, expect } from 'vitest';
import { aggregate, smoothSpeed, type UploadItem } from './uploads';

const item = (over: Partial<UploadItem>): UploadItem => ({
  id: 'x',
  name: 'f',
  size: 100,
  loaded: 0,
  status: 'queued',
  ...over,
});

describe('aggregate', () => {
  it('sums transferred bytes and computes percent + counts', () => {
    const s = aggregate(
      [
        item({ size: 100, loaded: 100, status: 'done' }),
        item({ size: 100, loaded: 50, status: 'uploading' }),
        item({ size: 100, status: 'queued' }),
      ],
      0,
    );
    expect(s.total).toBe(300);
    expect(s.loaded).toBe(150);
    expect(s.percent).toBe(50);
    expect(s.done).toBe(1);
    expect(s.queued).toBe(1);
    expect(s.active).toBe(true);
  });

  it('excludes failed bytes from the target so the bar can still reach 100%', () => {
    const s = aggregate(
      [item({ size: 100, loaded: 100, status: 'done' }), item({ size: 100, status: 'error' })],
      10,
    );
    expect(s.percent).toBe(100); // target = 200 - 100 failed = 100; loaded 100
    expect(s.failed).toBe(1);
    expect(s.etaSeconds).toBe(0);
    expect(s.active).toBe(false);
  });

  it('computes eta as remaining / speed', () => {
    const s = aggregate([item({ size: 1000, loaded: 400, status: 'uploading' })], 200);
    expect(s.etaSeconds).toBe(3); // (1000 - 400) / 200
  });

  it('reports Infinity eta when speed is unknown', () => {
    expect(aggregate([item({ size: 100, loaded: 10, status: 'uploading' })], 0).etaSeconds).toBe(
      Infinity,
    );
  });

  it('reads 0% (not 100%) when every file fails', () => {
    const s = aggregate([item({ status: 'error' }), item({ status: 'error' })], 5);
    expect(s.percent).toBe(0);
    expect(s.failed).toBe(2);
    expect(s.active).toBe(false);
    expect(s.effectiveTotal).toBe(0);
  });

  it('excludes cancelled files from the target and byte totals', () => {
    const s = aggregate(
      [item({ size: 100, loaded: 100, status: 'done' }), item({ size: 100, status: 'cancelled' })],
      5,
    );
    expect(s.cancelled).toBe(1);
    expect(s.effectiveTotal).toBe(100); // 200 total - 100 cancelled
    expect(s.percent).toBe(100);
  });

  it('clamps an over-counted uploading file to its size', () => {
    // XHR loaded includes multipart overhead and can exceed file size; loaded must not exceed total.
    const s = aggregate([item({ size: 100, loaded: 150, status: 'uploading' })], 0);
    expect(s.loaded).toBe(100);
    expect(s.percent).toBe(100);
  });

  it('handles an empty batch', () => {
    const s = aggregate([], 0);
    expect(s.percent).toBe(0);
    expect(s.active).toBe(false);
    expect(s.total).toBe(0);
  });
});

describe('smoothSpeed', () => {
  it('returns the instantaneous rate on the first sample', () => {
    expect(smoothSpeed(0, 1000, 2)).toBe(500);
  });

  it('exponentially blends later samples', () => {
    // 0.5 * (2000/2) + 0.5 * 500 = 750
    expect(smoothSpeed(500, 2000, 2, 0.5)).toBe(750);
  });

  it('ignores non-positive time deltas', () => {
    expect(smoothSpeed(500, 100, 0)).toBe(500);
    expect(smoothSpeed(500, 100, -1)).toBe(500);
  });

  it('floors a negative byte delta to zero (file-boundary count drop)', () => {
    // instant = max(0, -1000)/2 = 0 → 0.3*0 + 0.7*500 = 350
    expect(smoothSpeed(500, -1000, 2)).toBeCloseTo(350);
    expect(smoothSpeed(0, -1000, 2)).toBe(0);
  });
});
