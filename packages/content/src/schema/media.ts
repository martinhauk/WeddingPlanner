import { z } from 'zod';

/** Image types the bake accepts in `media/`. */
export const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
} as const;

export const mediaVariantSchema = z.strictObject({
  /** Root-relative URL with a content-hashed file name, e.g. `/content/media/3f2a….png`. */
  src: z.string().startsWith('/content/media/'),
  type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.int().positive(),
  height: z.int().positive(),
  bytes: z.int().positive(),
});

export const mediaItemSchema = z.strictObject({
  width: z.int().positive(),
  height: z.int().positive(),
  /** Available renditions, smallest first. The minimal bake writes a single variant (the original). */
  variants: z.array(mediaVariantSchema).min(1),
});

/**
 * `apps/web/src/content/generated/media.json`. `items` is keyed by the file's path relative to the
 * instance's `media/` folder (POSIX separators), which is how content refers to media.
 */
export const mediaManifestSchema = z.strictObject({
  items: z.record(z.string(), mediaItemSchema),
});

export type MediaVariant = z.infer<typeof mediaVariantSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type MediaManifest = z.infer<typeof mediaManifestSchema>;
