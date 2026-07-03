import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { WorkerPoolImageProcessor } from './worker-pool';
import type { ProcessRequest } from './image-processing';

// A plain-JS fake worker (no sharp) drives the pool's dispatch / crash / timeout paths.
const FAKE_WORKER = fileURLToPath(new URL('./__fixtures__/fake-worker.cjs', import.meta.url));

function req(width: number): ProcessRequest {
  return { buffer: Buffer.alloc(16), format: 'png', width, animated: false };
}

describe('WorkerPoolImageProcessor', () => {
  test('size clamps to at least 1 and reports the pool size', async () => {
    const single = new WorkerPoolImageProcessor(1, FAKE_WORKER);
    expect(single.size).toBe(1);
    await single.destroy();

    const two = new WorkerPoolImageProcessor(2, FAKE_WORKER);
    expect(two.size).toBe(2);
    await two.destroy();
  });

  test('coalesces duplicate concurrent jobs and dispatches distinct ones', async () => {
    const pool = new WorkerPoolImageProcessor(2, FAKE_WORKER);
    try {
      const [a, b] = await Promise.all([pool.process(req(320), 'k'), pool.process(req(320), 'k')]);
      expect(pool.dispatchedCount).toBe(1);
      expect(a.buffer).toEqual(b.buffer);
      await pool.process(req(640), 'k2');
      expect(pool.dispatchedCount).toBe(2);
    } finally {
      await pool.destroy();
    }
  });

  test('recovers after a worker hard-crashes (exit, no error event)', async () => {
    const pool = new WorkerPoolImageProcessor(1, FAKE_WORKER, 2000);
    try {
      await expect(pool.process(req(666))).rejects.toThrow();
      const r = await pool.process(req(320));
      expect(Buffer.isBuffer(r.buffer)).toBe(true);
      expect(pool.size).toBe(1);
    } finally {
      await pool.destroy();
    }
  });

  test('times out a hung worker and recovers', async () => {
    const pool = new WorkerPoolImageProcessor(1, FAKE_WORKER, 300);
    try {
      await expect(pool.process(req(777))).rejects.toThrow(/timed out/i);
      const r = await pool.process(req(320));
      expect(Buffer.isBuffer(r.buffer)).toBe(true);
      expect(pool.size).toBe(1);
    } finally {
      await pool.destroy();
    }
  });

  test('rejects new work after shutdown', async () => {
    const pool = new WorkerPoolImageProcessor(1, FAKE_WORKER);
    await pool.destroy();
    await expect(pool.process(req(320))).rejects.toThrow(/shut down/i);
  });
});
