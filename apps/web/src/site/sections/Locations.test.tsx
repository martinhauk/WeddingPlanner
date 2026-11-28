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
    expect(within(card).getByRole('heading', { name: 'Villa Lindenufer' })).toBeVisible();
    expect(within(card).getByText('Trauung')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Route planen' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=52.4894,13.4712',
    );
  });

  it('loads OpenStreetMap tiles only after a click', async () => {
    const user = userEvent.setup();
    const { container } = render(<Locations section={sections.locations} ctx={ctx} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Karte anzeigen/ }));
    const map = screen.getByRole('img', { name: 'Karte: Villa Lindenufer' });
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

  it.each([
    ['de', /Karte anzeigen/, 'Datenschutzerklärung'],
    ['en', /Show map/, 'privacy notice'],
    ['es', /Mostrar mapa/, 'política de privacidad'],
  ] as const)(
    'says before the click (%s) that the OpenStreetMap Foundation gets the IP address and links the privacy notice',
    async (lang, button, link) => {
      const user = userEvent.setup();
      render(<Locations section={sections.locations} ctx={{ ...ctx, lang }} />);
      const show = screen.getByRole('button', { name: button });
      expect(show).toHaveAccessibleName(button);
      expect(show).toHaveAccessibleDescription(/OpenStreetMap Foundation/);
      expect(show).toHaveAccessibleDescription(/\bIP\b/);
      expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', '/datenschutz');

      await user.click(show);
      expect(screen.queryByRole('link', { name: link })).not.toBeInTheDocument();
    },
  );

  it('shows the note with its inline links, further links, the website and the phone number', () => {
    const [card] = sections.locations.data.cards;
    const section = {
      ...sections.locations,
      data: {
        cards: [
          {
            ...(card as (typeof sections.locations.data.cards)[number]),
            note: { de: 'Parkt nur dort. Fragen? [Schreibt uns](mailto:anna@example.com).' },
            links: [
              {
                label: { de: 'Wo der Bus abfährt' },
                url: 'https://example.com/bus-stop',
              },
              { label: { de: 'Empfang anrufen' }, url: 'tel:+49 30 23125 333' },
            ],
            website: 'https://www.example.com/villa/',
            phone: '+49 30 23125 222',
          },
        ],
      },
    };
    render(<Locations section={section} ctx={ctx} />);
    expect(screen.getByRole('link', { name: 'Schreibt uns' })).toHaveAttribute(
      'href',
      'mailto:anna@example.com',
    );
    const bus = screen.getByRole('link', { name: 'Wo der Bus abfährt' });
    expect(bus).toHaveAttribute('href', 'https://example.com/bus-stop');
    expect(bus).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Empfang anrufen' })).toHaveAttribute(
      'href',
      'tel:+493023125333',
    );
    expect(screen.getByRole('link', { name: 'example.com/villa' })).toHaveAttribute(
      'href',
      'https://www.example.com/villa/',
    );
    expect(screen.getByRole('link', { name: '+49 30 23125 222' })).toHaveAttribute(
      'href',
      'tel:+493023125222',
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
    expect(items[0]).toHaveTextContent('11:00TrauungVilla Lindenufer');
    expect(items[1]).toHaveTextContent('18:00AbendessenIm Garten');
  });
});
