import type { SiteContent } from '@weddingplanner/content';
import { formatDate, mediaUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { Countdown } from './Countdown.tsx';

export type HeroProps = {
  readonly content: SiteContent;
  readonly lang: Lang;
  /** Id of the shown RSVP section; without it there is no RSVP button. */
  readonly rsvpId: string | undefined;
};

export function Hero({ content, lang, rsvpId }: HeroProps) {
  const { event, hero } = content;
  return (
    <section className={hero.image === undefined ? 'hero' : 'hero has-image'}>
      {hero.image !== undefined && (
        <img className="hero-image" src={mediaUrl(hero.image)} alt="" fetchPriority="high" />
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
