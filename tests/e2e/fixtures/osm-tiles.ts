import type { BrowserContext } from '@playwright/test';
import { encodePng, type Rgb } from './png.ts';

/** OpenStreetMap tile URLs (the CSP allows `https://tile.openstreetmap.org`; a-c are legacy). */
export const OSM_TILE_URL = /^https:\/\/(?:[a-c]\.)?tile\.openstreetmap\.org\//;

const TILE_SIZE = 256;
const LAND: Rgb = [242, 239, 233];
const GRID: Rgb = [221, 216, 207];
const ROAD: Rgb = [255, 255, 255];

let tile: Buffer | undefined;

/**
 * A neutral 256×256 placeholder tile: land colour, a faint grid and one diagonal "road", so a mocked
 * map is recognisable as a map in screenshots without loading real tiles.
 */
export function placeholderTile(): Buffer {
  tile ??= encodePng(TILE_SIZE, TILE_SIZE, (x, y) => {
    if (Math.abs(x - y) <= 2) return ROAD;
    if (x % 64 === 0 || y % 64 === 0) return GRID;
    return LAND;
  });
  return tile;
}

export type OsmTiles = {
  /** Paths (`z/x/y.png`) of the tiles the page requested so far, in order. */
  readonly requested: () => readonly string[];
};

/**
 * Answers every OpenStreetMap tile request with the placeholder tile, so map specs never reach the
 * real tile server (whose usage policy forbids automated traffic) and screenshots are stable.
 */
export async function installOsmTileMock(context: BrowserContext): Promise<OsmTiles> {
  const requested: string[] = [];
  await context.route(OSM_TILE_URL, async (route) => {
    requested.push(new URL(route.request().url()).pathname.slice(1));
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
      body: placeholderTile(),
    });
  });
  return { requested: () => [...requested] };
}
