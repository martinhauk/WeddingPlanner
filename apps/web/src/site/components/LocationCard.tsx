import type { SectionOf } from '@weddingplanner/content';
import { directionsUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { OsmMap } from './OsmMap.tsx';

export type Location = SectionOf<'locations'>['data']['cards'][number];

export type LocationCardProps = {
  readonly location: Location;
  readonly lang: Lang;
};

/** One venue: what happens there, the address, a click-to-load map and a directions link. */
export function LocationCard({ location, lang }: LocationCardProps) {
  return (
    <article className="card">
      <p className="eyebrow">{t(location.kind, lang)}</p>
      <h3>{location.name}</h3>
      <p>{location.address}</p>
      {location.note !== undefined && <p className="muted">{t(location.note, lang)}</p>}
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
