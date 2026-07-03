import { describe, expect, test } from 'vitest';
import sharp from 'sharp';
import { extractExif, serializeExif } from './exif';

describe('extractExif', () => {
  test('returns null camera/GPS/date fields for an image without that EXIF', async () => {
    const png = await sharp({
      create: { width: 8, height: 6, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const exif = await extractExif(png);
    expect(exif.captureDate).toBeNull();
    expect(exif.cameraMake).toBeNull();
    expect(exif.cameraModel).toBeNull();
    expect(exif.lat).toBeNull();
    expect(exif.lon).toBeNull();
  });

  test('returns all-null (never throws) for non-image bytes', async () => {
    const exif = await extractExif(Buffer.from('definitely not an image'));
    expect(exif).toEqual({
      captureDate: null,
      lat: null,
      lon: null,
      cameraMake: null,
      cameraModel: null,
      orientation: null,
      raw: null,
    });
  });

  test('extracts camera make/model from a JPEG with EXIF', async () => {
    const jpeg = await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Make: 'TestCam', Model: 'X100' } })
      .jpeg()
      .toBuffer();
    const exif = await extractExif(jpeg);
    expect(exif.cameraMake).toBe('TestCam');
    expect(exif.cameraModel).toBe('X100');
    expect(exif.raw).not.toBeNull();
  });
});

describe('serializeExif', () => {
  test('returns null for null input', () => {
    expect(serializeExif(null)).toBeNull();
  });

  test('drops binary blobs and keeps scalar tags', () => {
    const json = serializeExif({ Make: 'X', thumbnail: Buffer.from([1, 2, 3]), ISO: 200 });
    expect(json).not.toBeNull();
    expect(JSON.parse(json as string)).toEqual({ Make: 'X', ISO: 200 });
  });
});
