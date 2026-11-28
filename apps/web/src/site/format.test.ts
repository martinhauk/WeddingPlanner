import { describe, expect, it } from 'vitest';
import { formatDate, formatDeadline, mediaUrl, telUrl, whatsappUrl } from './format.ts';
import { t } from './i18n.ts';
import { tilePoint, tilesAround } from './osm.ts';

describe('t', () => {
  it('returns the requested language and falls back to German for missing or blank text', () => {
    const text = { de: 'Hallo', en: 'Hello', es: ' ' };
    expect(t(text, 'en')).toBe('Hello');
    expect(t(text, 'es')).toBe('Hallo');
    expect(t({ de: 'Nur Deutsch' }, 'en')).toBe('Nur Deutsch');
    expect(t(undefined, 'de')).toBe('');
  });
});

describe('dates', () => {
  it('formats in the event time zone, not the visitor’s', () => {
    // 23:30 UTC is already the next day in Berlin.
    expect(formatDate('2099-09-11T23:30:00Z', 'de', 'Europe/Berlin', 'long')).toBe(
      '12. September 2099',
    );
    expect(formatDate('2099-09-11T23:30:00Z', 'en', 'UTC', 'long')).toBe('September 11, 2099');
  });

  it('shows the content deadline as a calendar date, else the enforced deadline', () => {
    const build = { rsvpDeadline: '2099-02-28T23:30:00.000Z', rsvpTimeZone: 'Europe/Berlin' };
    expect(formatDeadline({ rsvpDeadline: '2099-03-01' }, build, 'es')).toBe('1 de marzo de 2099');
    expect(formatDeadline({}, build, 'de')).toBe('1. März 2099');
  });
});

describe('links', () => {
  it('encodes media paths segment by segment', () => {
    expect(mediaUrl('party/anna smith.png')).toBe('/media/party/anna%20smith.png');
  });

  it('normalizes phone numbers for tel: and wa.me', () => {
    expect(telUrl('+49 (151) 000-000 00')).toBe('tel:+4915100000000');
    expect(whatsappUrl('+49 151 000 000 00')).toBe('https://wa.me/4915100000000');
  });
});

describe('osm tiles', () => {
  it('computes slippy-map tile coordinates', () => {
    expect(tilePoint(0, 0, 1)).toEqual({ x: 1, y: 1 });
    const { x, y } = tilePoint(52.4894, 13.4712, 15);
    expect(Math.floor(x)).toBe(17610);
    expect(Math.floor(y)).toBe(10751); // cross-checked with asinh(tan(lat))
  });

  it('centers 3 × 3 tiles on the point', () => {
    const tiles = tilesAround(52.4894, 13.4712);
    expect(tiles).toHaveLength(9);
    const center = tiles[4];
    expect(center?.left).toBeLessThanOrEqual(0);
    expect(center?.left).toBeGreaterThan(-256);
    expect(center?.src).toBe('https://tile.openstreetmap.org/15/17610/10751.png');
  });
});
