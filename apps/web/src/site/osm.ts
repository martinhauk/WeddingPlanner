/** OpenStreetMap raster tiles: the map is drawn from tile images, no iframe and no script. */

export const TILE_SIZE = 256;
export const MAP_ZOOM = 15;

/** Position of a point in tile units at `zoom` (Web Mercator, the slippy map scheme). */
export function tilePoint(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export type MapTile = {
  readonly key: string;
  readonly src: string;
  /** Pixel offset of the tile's top-left corner from the map's center point. */
  readonly left: number;
  readonly top: number;
};

/**
 * The 3 × 3 tiles around a point, positioned so the point sits at the center of the map. They cover
 * at least one tile size in every direction, enough for a map up to 512 px wide.
 */
export function tilesAround(lat: number, lng: number, zoom = MAP_ZOOM): MapTile[] {
  const n = 2 ** zoom;
  const { x, y } = tilePoint(lat, lng, zoom);
  const tiles: MapTile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = Math.floor(x) + dx;
      const ty = Math.floor(y) + dy;
      if (ty < 0 || ty >= n) {
        continue;
      }
      const wrapped = ((tx % n) + n) % n;
      tiles.push({
        key: `${tx}/${ty}`,
        src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
        left: Math.round((tx - x) * TILE_SIZE),
        top: Math.round((ty - y) * TILE_SIZE),
      });
    }
  }
  return tiles;
}

/** Link to the point on openstreetmap.org. */
export function osmUrl(lat: number, lng: number, zoom = 17): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}
