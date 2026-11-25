import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { build, content, sections } from '../test/fixture.ts';
import { Locations } from './Locations.tsx';
import { Schedule } from './Schedule.tsx';

const ctx = { lang: 'de' as const, content, build };

describe('Locations', () => {
  it('shows each venue with a directions link (Google Maps universal link)', () => {
    render(<Locations section={sections.locations} ctx={ctx} />);
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading', { name: 'Kapelle am Beispielsee' })).toBeVisible();
    expect(within(card).getByText('Trauung')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Route planen' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=51.1657,10.4515',
    );
  });

  it('loads OpenStreetMap tiles only after a click', async () => {
    const user = userEvent.setup();
    const { container } = render(<Locations section={sections.locations} ctx={ctx} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Karte anzeigen/ }));
    const map = screen.getByRole('img', { name: 'Karte: Kapelle am Beispielsee' });
    const tiles = map.querySelectorAll('img');
    expect(tiles).toHaveLength(9);
    for (const tile of tiles) {
      expect(tile.getAttribute('src')).toMatch(
        /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/,
      );
    }
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('lists hotels with website and route links', () => {
    render(<Locations section={sections.locations} ctx={ctx} />);
    expect(screen.getByRole('heading', { name: 'Übernachtung' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://example.com/hotel',
    );
  });
});

describe('Schedule', () => {
  it('shows times, titles, the referenced location and notes', () => {
    render(<Schedule section={sections.schedule} ctx={ctx} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('14:00TrauungKapelle am Beispielsee');
    expect(items[1]).toHaveTextContent('18:00AbendessenIm Garten');
  });
});
