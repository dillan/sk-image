// heic-convert ships no type declarations. This ambient module covers the small surface we use
// (a single default-exported async function that decodes HEIC/HEIF bytes to JPEG/PNG).
declare module 'heic-convert' {
  function heicConvert(options: {
    buffer: ArrayBufferLike;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer>;
  export = heicConvert;
}
