import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_TYPES } from '../schema/media.ts';
import { type Diagnostic, error, warning } from './diagnostics.ts';
import { type ImageType, readImageSize } from './image.ts';

/** A supported image in the instance's `media/` folder. */
export type MediaSource = {
  /** Path relative to `media/` with POSIX separators; the key content uses to refer to it. */
  readonly id: string;
  /** Absolute path of the source file. */
  readonly file: string;
  readonly type: ImageType;
  /** Output file extension (`.jpeg` is written as `.jpg`). */
  readonly extension: '.png' | '.jpg' | '.webp';
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** SHA-256 of the file bytes (hex). */
  readonly sha256: string;
};

const EXTENSIONS: Record<ImageType, MediaSource['extension']> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function isSupportedExtension(ext: string): ext is keyof typeof MEDIA_TYPES {
  return Object.hasOwn(MEDIA_TYPES, ext);
}

/**
 * Lists the images in `<instanceDir>/media/` (recursively, skipping dot files) and reads their
 * size and hash. A missing folder means "no media".
 *
 * Diagnostics never name a source file, because real file names can be personal and deploy logs
 * are public: they refer to "media file #n", counting from 1 in code-point order of the relative
 * paths.
 */
export async function scanMedia(
  instanceDir: string,
): Promise<{ media: MediaSource[]; diagnostics: Diagnostic[] }> {
  const mediaDir = path.join(instanceDir, 'media');
  let entries: Awaited<ReturnType<typeof listFiles>>;
  try {
    entries = await listFiles(mediaDir);
  } catch (cause) {
    if (isNodeError(cause) && cause.code === 'ENOENT') {
      return { media: [], diagnostics: [] };
    }
    throw cause;
  }

  const media: MediaSource[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [index, entry] of entries.entries()) {
    const label = `$[${index + 1}]`;
    const ext = path.extname(entry.id).toLowerCase();
    if (!entry.isFile || !isSupportedExtension(ext)) {
      diagnostics.push(
        warning(
          'W_MEDIA_UNSUPPORTED',
          'media/',
          label,
          `media file #${index + 1} is ignored: only regular .png, .jpg, .jpeg and .webp files are baked`,
        ),
      );
      continue;
    }
    const type = MEDIA_TYPES[ext];
    const bytes = await readFile(entry.file);
    const size = readImageSize(bytes, type);
    if (size === undefined) {
      diagnostics.push(
        error(
          'E_MEDIA_INVALID',
          'media/',
          label,
          `media file #${index + 1} is not a readable ${type} image`,
        ),
      );
      continue;
    }
    media.push({
      id: entry.id,
      file: entry.file,
      type,
      extension: EXTENSIONS[type],
      width: size.width,
      height: size.height,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return { media, diagnostics };
}

async function listFiles(
  mediaDir: string,
): Promise<Array<{ id: string; file: string; isFile: boolean }>> {
  const dirents = await readdir(mediaDir, { recursive: true, withFileTypes: true });
  return dirents
    .filter((d) => !d.isDirectory())
    .map((d) => {
      const file = path.join(d.parentPath, d.name);
      const id = path.relative(mediaDir, file).split(path.sep).join('/');
      return { id, file, isFile: d.isFile() };
    })
    .filter((f) => !f.id.split('/').some((segment) => segment.startsWith('.')))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
