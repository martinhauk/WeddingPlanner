import { linkHref, type SectionOf } from '@weddingplanner/content';
import { directionsUrl, telUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { OsmMap } from './OsmMap.tsx';
import { Paragraphs } from './Paragraphs.tsx';

export type Location = SectionOf<'locations'>['data']['cards'][number];

export type LocationCardProps = {
  readonly location: Location;
  readonly lang: Lang;
};

/** `https://www.example.com/path` → `example.com/path`, the way a website is usually written. */
function displayUrl(url: string): string {
  return url
    .replace(/^https:\/\/(?:www\.)?/, '')
    .replace(/\/$/, '')
    .replace(/[?#].*$/, '');
}

/**
 * One venue: what happens there, the address, notes and links (e.g. car parks, website, phone), a
 * click-to-load map and a directions link.
 */
export function LocationCard({ location, lang }: LocationCardProps) {
  const links = location.links ?? [];
  const hasLinks =
    links.length > 0 || location.website !== undefined || location.phone !== undefined;
  return (
    <article className="card location">
      <p className="eyebrow">{t(location.kind, lang)}</p>
      <h3>{location.name}</h3>
      <p className="address">{location.address}</p>
      {location.note !== undefined && (
        <Paragraphs className="card-note" text={t(location.note, lang)} />
      )}
      {hasLinks && (
        <ul className="card-links">
          {links.map((link, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order
            <li key={index}>
              <a
                href={linkHref(link.url)}
                {...(link.url.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {t(link.label, lang)}
              </a>
            </li>
          ))}
          {location.website !== undefined && (
            <li>
              <a href={location.website} target="_blank" rel="noreferrer">
                {displayUrl(location.website)}
              </a>
            </li>
          )}
          {location.phone !== undefined && (
            <li>
              <a href={telUrl(location.phone)}>{location.phone}</a>
            </li>
          )}
        </ul>
      )}
      <OsmMap lat={location.lat} lng={location.lng} name={location.name} lang={lang} />
      <a
        className="btn small"
        href={directionsUrl(location.lat, location.lng)}
        target="_blank"
        rel="noreferrer"
      >
        {t(ui.route, lang)}
      </a>
    </article>
  );
}
