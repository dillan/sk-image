import { describe, it, expect } from 'vitest';
import { formatBytes, formatSpeed, formatDuration } from './format';

describe('formatBytes', () => {
  it('formats bytes / KB / MB / GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1073741824)).toBe('1.0 GB');
  });
});

describe('formatSpeed', () => {
  it('appends /s and handles unknown speeds', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s');
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(Infinity)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
  it('returns an em dash for infinite/negative', () => {
    expect(formatDuration(Infinity)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});
