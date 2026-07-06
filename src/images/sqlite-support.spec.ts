import { describe, expect, test } from 'vitest';
import { checkSqliteSupport, meetsMinimum, MIN_NODE_FOR_SQLITE } from './sqlite-support';

describe('meetsMinimum', () => {
  test('equal versions meet the minimum', () => {
    expect(meetsMinimum('22.13.0', '22.13.0')).toBe(true);
  });

  test('a lower minor fails, a higher minor passes', () => {
    expect(meetsMinimum('22.12.4', '22.13.0')).toBe(false);
    expect(meetsMinimum('22.20.0', '22.13.0')).toBe(true);
  });

  test('a lower patch fails, a higher patch passes', () => {
    expect(meetsMinimum('22.13.0', '22.13.1')).toBe(false);
    expect(meetsMinimum('22.13.1', '22.13.0')).toBe(true);
  });

  test('a lower/higher major dominates', () => {
    expect(meetsMinimum('20.19.0', '22.13.0')).toBe(false);
    expect(meetsMinimum('24.4.0', '22.13.0')).toBe(true);
  });

  test('handles versions with fewer parts than the minimum', () => {
    expect(meetsMinimum('22.13', '22.13.0')).toBe(true);
    expect(meetsMinimum('23', '22.13.0')).toBe(true);
    expect(meetsMinimum('22', '22.13.0')).toBe(false);
  });
});

describe('checkSqliteSupport', () => {
  test('rejects Node 20 with a message naming the requirement', () => {
    const r = checkSqliteSupport('20.19.0');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(MIN_NODE_FOR_SQLITE);
    expect(r.detail).toContain('20.19.0');
  });

  test('rejects a flag-gated Node 22 (< 22.13) before probing', () => {
    const r = checkSqliteSupport('22.12.4');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(MIN_NODE_FOR_SQLITE);
  });

  test('accepts a supported version and actually opens node:sqlite', () => {
    // The test runner is Node >= 22.13, so the live probe (open an in-memory DB) succeeds.
    const r = checkSqliteSupport('22.13.0');
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('available');
  });

  test('defaults to the current runtime, which is supported here', () => {
    expect(checkSqliteSupport().ok).toBe(true);
  });
});
