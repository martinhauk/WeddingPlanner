import { useState } from 'react';
import { type Lang, t } from '../i18n.ts';
import { osmUrl, TILE_SIZE, tilesAround } from '../osm.ts';
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
 * guest asks for the map (the CSP allows tile images, no frames).
 */
export function OsmMap({ lat, lng, name, lang }: OsmMapProps) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <div className="map">
        <button type="button" className="map-load" onClick={() => setShown(true)}>
          {t(ui.showMap, lang)}
          <small>{t(ui.mapNote, lang)}</small>
        </button>
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
