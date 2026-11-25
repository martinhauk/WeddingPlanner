import type { ContentImage } from '@weddingplanner/content';
import { mediaUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';

export type GalleryProps = {
  readonly images: readonly ContentImage[] | undefined;
  readonly lang: Lang;
};

/** Content images in a responsive grid; an image without alt text is decorative. */
export function Gallery({ images, lang }: GalleryProps) {
  if (images === undefined || images.length === 0) {
    return null;
  }
  return (
    <div className={`gallery gallery-${Math.min(images.length, 3)}`}>
      {images.map((image, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static content, the same file may repeat
        <figure key={index}>
          <img src={mediaUrl(image.src)} alt={t(image.alt, lang)} loading="lazy" decoding="async" />
        </figure>
      ))}
    </div>
  );
}
