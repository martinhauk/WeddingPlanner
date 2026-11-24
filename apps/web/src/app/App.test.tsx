import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Site } from '@weddingplanner/content';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { formatEventDate } from './format.ts';

const site: Site = {
  schemaVersion: 1,
  i18n: { languages: ['de', 'en', 'es'], defaultLanguage: 'de' },
  couple: {
    names: ['Anna', 'Ben'],
    displayName: { de: 'Anna & Ben', en: 'Anna & Ben', es: 'Anna y Ben' },
  },
  event: {
    start: '2099-06-20T14:00:00+02:00',
    timeZone: 'Europe/Berlin',
    title: { de: 'Wir heiraten', en: "We're getting married", es: 'Nos casamos' },
  },
};

describe('App', () => {
  it('shows the names and the date in the default language', () => {
    render(<App site={site} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeInTheDocument();
    expect(screen.getByText('Samstag, 20. Juni 2099')).toBeInTheDocument();
    expect(screen.getByText('Wir heiraten')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deutsch' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('de');
  });

  it('switches between de, en and es', async () => {
    const user = userEvent.setup();
    render(<App site={site} />);
    expect(screen.getByRole('navigation', { name: 'Sprache' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByText('Saturday, June 20, 2099')).toBeInTheDocument();
    expect(screen.getByText("We're getting married")).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('en');

    await user.click(screen.getByRole('button', { name: 'Español' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Anna y Ben' })).toBeInTheDocument();
    expect(screen.getByText('sábado, 20 de junio de 2099')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe('Anna y Ben');
  });

  it('falls back to the first names when there is no display name', () => {
    render(<App site={{ ...site, couple: { names: ['Anna', 'Ben'] } }} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeInTheDocument();
  });
});

describe('formatEventDate', () => {
  it('uses the event time zone, not the host time zone', () => {
    // 22:30 UTC on 20 June is already 21 June in Berlin.
    expect(formatEventDate('2099-06-20T22:30:00Z', 'en', 'Europe/Berlin')).toBe(
      'Sunday, June 21, 2099',
    );
    expect(formatEventDate('2099-06-20T22:30:00Z', 'en', 'America/Mexico_City')).toBe(
      'Saturday, June 20, 2099',
    );
  });
});
