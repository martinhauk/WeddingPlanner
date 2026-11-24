import { crc32, deflateSync } from 'node:zlib';

export type Rgb = readonly [red: number, green: number, blue: number];

/**
 * Encodes an 8-bit RGB PNG from a pixel function. Used to generate the placeholder images of the
 * sample instance (`scripts/generate-sample-media.ts`) and media fixtures in tests, so the repo
 * never needs third-party or real photos.
 */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): Buffer {
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      row[x * 3] = clampByte(r);
      row[x * 3 + 1] = clampByte(g);
      row[x * 3 + 2] = clampByte(b);
    }
    const start = y * (stride + 1);
    filtered[start] = 2; // filter "Up": smooth gradients compress well
    for (let i = 0; i < stride; i++) {
      filtered[start + 1 + i] = ((row[i] ?? 0) - (previous[i] ?? 0)) & 0xff;
    }
    previous = row;
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
