export type ImageSize = { readonly width: number; readonly height: number };

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads the pixel size from a PNG, JPEG or WebP header without decoding the image. Returns
 * `undefined` when the bytes are not a well-formed file of the given type.
 */
export function readImageSize(bytes: Uint8Array, type: ImageType): ImageSize | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (type) {
      case 'image/png':
        return pngSize(bytes, view);
      case 'image/jpeg':
        return jpegSize(bytes, view);
      case 'image/webp':
        return webpSize(bytes, view);
    }
  } catch (cause) {
    if (cause instanceof RangeError) {
      return undefined; // truncated file
    }
    throw cause;
  }
}

function positive(width: number, height: number): ImageSize | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function pngSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b) || ascii(bytes, 12, 4) !== 'IHDR') {
    return undefined;
  }
  return positive(view.getUint32(16), view.getUint32(20));
}

function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return undefined;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // markers without a length
      continue;
    }
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return positive(view.getUint16(offset + 7), view.getUint16(offset + 5));
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | undefined {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return undefined;
  }
  switch (ascii(bytes, 12, 4)) {
    case 'VP8 ':
      return positive(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    case 'VP8L': {
      if (bytes[20] !== 0x2f) {
        return undefined;
      }
      const bits = view.getUint32(21, true);
      return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    case 'VP8X':
      return positive(1 + uint24(view, 24), 1 + uint24(view, 27));
    default:
      return undefined;
  }
}

function uint24(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
  );
}
