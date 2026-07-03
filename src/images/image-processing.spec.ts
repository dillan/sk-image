import { describe, expect, test } from 'vitest';
import sharp from 'sharp';
import {
  snapWidth,
  computeWorkerCount,
  processImage,
  WIDTH_ALLOWLIST,
  CANONICAL_WIDTH,
} from './image-processing';
import { safeImageHeaders } from './image-store';

const png = (w = 200, h = 150): Promise<Buffer> =>
  sharp({
    create: { width: w, height: h, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 1 } },
  })
    .png()
    .toBuffer();

// Build a minimal multi-frame animated GIF (clear-before-every-pixel keeps all LZW codes 3-bit).
function animatedGif(W: number, H: number, frames: number[]): Buffer {
  const lzw = (indices: number[]): number[] => {
    const codes: number[] = [];
    for (const idx of indices) {
      codes.push(4);
      codes.push(idx & 3);
    }
    codes.push(5);
    const bytes: number[] = [];
    let cur = 0;
    let bits = 0;
    for (const c of codes) {
      cur |= (c & 7) << bits;
      bits += 3;
      while (bits >= 8) {
        bytes.push(cur & 0xff);
        cur >>= 8;
        bits -= 8;
      }
    }
    if (bits) bytes.push(cur & 0xff);
    const out = [2];
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
    return out;
  };
  const b: number[] = [];
  b.push(...Buffer.from('GIF89a'));
  b.push(W & 0xff, W >> 8, H & 0xff, H >> 8, 0x80, 0, 0, 0, 0, 0, 255, 255, 255);
  b.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0);
  for (const idx of frames) {
    b.push(0x21, 0xf9, 0x04, 0x04, 50, 0, 0, 0);
    b.push(0x2c, 0, 0, 0, 0, W & 0xff, W >> 8, H & 0xff, H >> 8, 0);
    b.push(...lzw(new Array(W * H).fill(idx)));
  }
  b.push(0x3b);
  return Buffer.from(b);
}

describe('image-processing', () => {
  test('snapWidth snaps up to the allow-list and uses canonical for unset/oversized', () => {
    expect(snapWidth(100)).toBe(160);
    expect(snapWidth(640)).toBe(640);
    expect(snapWidth(700)).toBe(960);
    expect(snapWidth(null)).toBe(CANONICAL_WIDTH);
    expect(snapWidth(0)).toBe(CANONICAL_WIDTH);
    expect(snapWidth(99999)).toBe(CANONICAL_WIDTH);
    expect(WIDTH_ALLOWLIST[WIDTH_ALLOWLIST.length - 1]).toBe(CANONICAL_WIDTH);
  });

  test('computeWorkerCount is n-1, clamped to at least 1', () => {
    expect(computeWorkerCount(1)).toBe(1);
    expect(computeWorkerCount(2)).toBe(1);
    expect(computeWorkerCount(4)).toBe(3);
    expect(computeWorkerCount(0)).toBe(1);
  });

  test('processImage converts a raster to WebP at the requested width', async () => {
    const out = await processImage({
      buffer: await png(800, 600),
      format: 'png',
      width: 320,
      animated: false,
    });
    const md = await sharp(out.buffer).metadata();
    expect(md.format).toBe('webp');
    expect(md.width).toBe(320);
    expect(out.width).toBe(320);
  });

  test('processImage preserves animation (GIF -> animated WebP) and resizes', async () => {
    const out = await processImage({
      buffer: animatedGif(96, 72, [0, 1, 0]),
      format: 'gif',
      width: 64,
      animated: true,
    });
    const md = await sharp(out.buffer, { animated: true }).metadata();
    expect(md.format).toBe('webp');
    expect(md.pages).toBe(3);
    expect(md.width).toBe(64);
  });

  test('safeImageHeaders locks down sniffing and execution', () => {
    const h = safeImageHeaders('image/webp', 'x.webp');
    expect(h['Content-Type']).toBe('image/webp');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Content-Disposition']).toMatch(/inline/);
    expect(h['Cache-Control']).toMatch(/immutable/);
  });
});
