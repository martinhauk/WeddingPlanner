import type { SiteContent } from '@weddingplanner/content';
import { formatDate, mediaUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { Countdown } from './Countdown.tsx';

/** The hero's background photos: `hero.images` (at most two), else `hero.image`, else none. */
export function heroImages(content: Pick<SiteContent, 'hero'>): readonly string[] {
  const { image, images } = content.hero;
  return images ?? (image === undefined ? [] : [image]);
}

export type HeroProps = {
  readonly content: SiteContent;
  readonly lang: Lang;
  /** Id of the shown RSVP section; without it there is no RSVP button. */
  readonly rsvpId: string | undefined;
};

/**
 * The first screen: tagline, names, date, place, countdown and the RSVP button, on full-bleed
 * photos (side by side when there are two) under a scrim that keeps the text readable.
 */
export function Hero({ content, lang, rsvpId }: HeroProps) {
  const { event } = content;
  const images = heroImages(content);
  return (
    <section className={images.length === 0 ? 'hero' : `hero has-image images-${images.length}`}>
      {images.length > 0 && (
        <div className="hero-media">
          {images.map((image, index) => (
            <img
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, the same file may repeat
              key={index}
              src={mediaUrl(image)}
              alt=""
              fetchPriority="high"
              decoding="async"
            />
          ))}
        </div>
      )}
      <div className="hero-inner">
        <p className="eyebrow">{t(content.tagline, lang)}</p>
        <h1>{t(content.couple, lang)}</h1>
        <p className="hero-date">
          <time dateTime={event.start}>{formatDate(event.start, lang, event.timeZone)}</time>
        </p>
        <p className="hero-place">{t(content.place, lang)}</p>
        <Countdown to={event.start} lang={lang} />
        {rsvpId !== undefined && (
          <a className="btn" href={`#${rsvpId}`}>
            {t(ui.rsvpCta, lang)}
          </a>
        )}
      </div>
    </section>
  );
}
