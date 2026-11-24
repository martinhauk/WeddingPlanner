import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readImageSize } from '../src/node/image.ts';
import { encodePng } from '../src/node/png.ts';

const hex = (bytes: string) => Buffer.from(bytes, 'hex');

/** SOI, an APP0 segment, then a progressive start-of-frame (SOF2) with the size. */
function jpeg(width: number, height: number): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt16BE(height, 0);
  size.writeUInt16BE(width, 2);
  return Buffer.concat([
    hex('ffd8'),
    hex('ffe000040000'),
    hex('ffc2000b08'),
    size,
    hex('01011100'),
  ]);
}

/** RIFF container with one chunk; the payload starts at byte 20. */
function webp(chunk: string, payload: string): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.alloc(4),
    Buffer.from('WEBP'),
    Buffer.from(chunk),
    Buffer.alloc(4),
    hex(payload),
  ]);
}

const black = () => [0, 0, 0] as const;

describe('readImageSize', () => {
  it('reads PNG headers', () => {
    expect(readImageSize(encodePng(7, 5, black), 'image/png')).toEqual({ width: 7, height: 5 });
  });

  it('reads JPEG start-of-frame markers after other segments', () => {
    expect(readImageSize(jpeg(1920, 1280), 'image/jpeg')).toEqual({ width: 1920, height: 1280 });
  });

  it('reads lossy, lossless and extended WebP headers', () => {
    // VP8: frame tag (3 bytes), start code 9d012a, then 14-bit width and height, little endian.
    const lossy = webp('VP8 ', '0000009d012a80073804');
    expect(readImageSize(lossy, 'image/webp')).toEqual({ width: 1920, height: 1080 });

    // VP8L: signature 2f, then (width - 1) and (height - 1) in 14 bits each, little endian.
    const bits = Buffer.alloc(4);
    bits.writeUInt32LE((640 - 1) | ((480 - 1) << 14));
    const lossless = webp('VP8L', `2f${bits.toString('hex')}`);
    expect(readImageSize(lossless, 'image/webp')).toEqual({ width: 640, height: 480 });

    // VP8X: flags + reserved (4 bytes), then (width - 1) and (height - 1) in 24 bits each.
    const extended = webp('VP8X', '000000007f02001f0100');
    expect(readImageSize(extended, 'image/webp')).toEqual({ width: 640, height: 288 });
  });

  it('returns undefined for wrong or truncated data', () => {
    expect(readImageSize(hex('010203'), 'image/png')).toBeUndefined();
    expect(readImageSize(encodePng(2, 2, black), 'image/jpeg')).toBeUndefined();
    expect(readImageSize(jpeg(10, 10).subarray(0, 12), 'image/jpeg')).toBeUndefined();
    expect(readImageSize(webp('VP8L', '0000000000'), 'image/webp')).toBeUndefined();
    expect(readImageSize(new Uint8Array(0), 'image/webp')).toBeUndefined();
  });
});

describe('encodePng', () => {
  it('writes the pixels it is given', () => {
    const png = encodePng(3, 2, (x, y) => [x * 100, y * 100, 7]);
    // IDAT data starts after signature (8), IHDR chunk (25) and the IDAT length + type (8).
    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    // Row 0 (filter Up against zeros) is the pixels themselves.
    expect([...raw.subarray(0, 10)]).toEqual([2, 0, 0, 7, 100, 0, 7, 200, 0, 7]);
    // Row 1 stores the difference to row 0.
    expect([...raw.subarray(10, 20)]).toEqual([2, 0, 100, 0, 0, 100, 0, 0, 100, 0]);
  });
});
