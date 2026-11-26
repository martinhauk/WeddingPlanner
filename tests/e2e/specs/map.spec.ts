import { sectionOfType } from '../fixtures/sample.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

const travel = sectionOfType('locations');

test.describe('locations map', () => {
  test('loads no OpenStreetMap tiles until a guest asks for the map', async ({
    page,
    osmTiles,
  }) => {
    await page.goto(`/#${travel.id}`);
    const card = page.locator(`#${travel.id} article.card`).first();
    const show = card.getByRole('button', { name: /Karte anzeigen/ });
    await expect(show).toBeVisible();
    await expect(card.getByRole('link', { name: 'Route planen' })).toHaveAttribute(
      'href',
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
    );
    await snap(page, 'map-placeholder', { lang: 'de', target: card });
    expect(osmTiles.requested(), 'tiles before the click').toEqual([]);

    await show.click();
    const map = card.getByRole('img', { name: /^Karte: / });
    await expect(map).toBeVisible();
    // A 3 × 3 grid of tiles around the venue, all answered by the tile mock.
    await expect.poll(() => osmTiles.requested().length).toBe(9);
    await expect(map.locator('img')).toHaveCount(9);
    for (const tile of await map.locator('img').all()) {
      await expect.poll(() => tile.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);
    }
    await expect(card.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    await snap(page, 'map-loaded', { lang: 'de', target: card });
  });
});
