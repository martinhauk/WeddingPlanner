import { crc32, deflateSync } from 'node:zlib';

export type Rgb = readonly [red: number, green: number, blue: number];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encodes a truecolor PNG (8 bit RGB, no interlace) from a pixel function. Node built-ins only;
 * used for the mocked map tiles and for test images, so no binary fixtures are committed.
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('PNG width and height must be positive integers');
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: truecolor
  // Bytes 10-12 (compression, filter, interlace) stay 0.

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride; // raw[row] = 0: filter type "none"
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      raw.writeUInt8(red, row + 1 + x * 3);
      raw.writeUInt8(green, row + 2 + x * 3);
      raw.writeUInt8(blue, row + 3 + x * 3);
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
