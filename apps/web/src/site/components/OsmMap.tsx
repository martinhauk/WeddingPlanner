import { useId, useState } from 'react';
import { fill } from '../fill.tsx';
import { type Lang, t } from '../i18n.ts';
import { osmUrl, TILE_SIZE, tilesAround } from '../osm.ts';
import { PRIVACY_PATH } from '../privacy/route.ts';
import { ui } from '../ui.ts';

export type OsmMapProps = {
  readonly lat: number;
  readonly lng: number;
  /** Name of the place, for the map's accessible label. */
  readonly name: string;
  readonly lang: Lang;
};

/**
 * Click-to-load map from OpenStreetMap tiles. Nothing is requested from OpenStreetMap until the
 * guest asks for the map (the CSP allows tile images, no frames). The note under the button says
 * who receives the guest's IP address then (the OpenStreetMap Foundation) and links the privacy
 * notice; it sits outside the button, because a link must not be inside one.
 */
export function OsmMap({ lat, lng, name, lang }: OsmMapProps) {
  const [shown, setShown] = useState(false);
  const noteId = useId();
  if (!shown) {
    return (
      <div className="map">
        <button
          type="button"
          className="map-load"
          aria-describedby={noteId}
          onClick={() => setShown(true)}
        >
          {t(ui.showMap, lang)}
        </button>
        <p className="map-note" id={noteId}>
          {fill(t(ui.mapNote, lang), {
            link: <a href={PRIVACY_PATH}>{t(ui.mapPrivacyLink, lang)}</a>,
          })}
        </p>
      </div>
    );
  }
  return (
    <div className="map">
      <div className="map-tiles" role="img" aria-label={`${t(ui.mapOf, lang)}: ${name}`}>
        {tilesAround(lat, lng).map((tile) => (
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)` }}
          />
        ))}
        <span className="map-pin" />
      </div>
      <p className="map-credit">
        <a href={osmUrl(lat, lng)} target="_blank" rel="noreferrer">
          {t(ui.largerMap, lang)}
        </a>
        {' · © '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </p>
    </div>
  );
}
