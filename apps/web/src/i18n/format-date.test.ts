import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateRange, formatDateTime, formatTime } from './format-date.ts';

const BERLIN = 'Europe/Berlin';

/** Intl uses narrow and thin no-break spaces (`2:00 PM`, `June 20 – 21`); compare plain spaces. */
function plain(text: string): string {
  return text.replace(/[   ]/g, ' ');
}

// The host zones are far from the event zone and switch to summer time on other dates (the US
// on the second Sunday of March, Berlin on the last), so a helper that used the host zone would
// show other days and hours. 2099: Berlin springs forward on 29 March at 01:00 UTC
// (02:00 → 03:00) and falls back on 25 October at 01:00 UTC (03:00 → 02:00).
describe.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC'])(
  'on a host in %s',
  (hostZone) => {
    beforeAll(() => {
      vi.stubEnv('TZ', hostZone);
    });

    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it('really runs in that host time zone', () => {
      const expectedHour = { 'America/Los_Angeles': 5, 'Pacific/Kiritimati': 2, UTC: 12 }[hostZone];
      // 2099-06-20T12:00Z: 05:00 in Los Angeles (PDT), 02:00 the next day on Kiritimati (UTC+14).
      expect(new Date('2099-06-20T12:00:00Z').getHours()).toBe(expectedHour);
    });

    it('formats dates per language in the event time zone', () => {
      const start = '2099-06-20T14:00:00+02:00';
      expect(formatDate(start, 'de', BERLIN, 'full')).toBe('Samstag, 20. Juni 2099');
      expect(formatDate(start, 'en', BERLIN, 'full')).toBe('Saturday, June 20, 2099');
      expect(formatDate(start, 'es', BERLIN, 'full')).toBe('sábado, 20 de junio de 2099');
      expect(formatDate(start, 'de', BERLIN)).toBe('20. Juni 2099');
      // 22:30 UTC on 20 June is already 21 June in Berlin (and still 20 June in Los Angeles).
      expect(formatDate('2099-06-20T22:30:00Z', 'en', BERLIN)).toBe('June 21, 2099');
      expect(formatDate(Date.UTC(2099, 5, 20, 22, 30), 'en', BERLIN)).toBe('June 21, 2099');
      expect(formatDate(new Date('2099-06-20T22:30:00Z'), 'en', BERLIN)).toBe('June 21, 2099');
    });

    it('formats times per language in the event time zone', () => {
      const start = '2099-06-20T14:00:00+02:00';
      expect(formatTime(start, 'de', BERLIN)).toBe('14:00');
      expect(plain(formatTime(start, 'en', BERLIN))).toBe('2:00 PM');
      expect(formatTime(start, 'es', BERLIN)).toBe('14:00');
      expect(formatTime(start, 'de', 'America/Mexico_City')).toBe('06:00');
    });

    it('formats a date with a time', () => {
      const start = '2099-06-20T14:00:00+02:00';
      expect(formatDateTime(start, 'de', BERLIN)).toBe('20. Juni 2099 um 14:00');
      expect(plain(formatDateTime(start, 'en', BERLIN))).toBe('June 20, 2099 at 2:00 PM');
      expect(formatDateTime(start, 'es', BERLIN)).toBe('20 de junio de 2099 a las 14:00');
      expect(formatDateTime(start, 'de', BERLIN, { dateStyle: 'full', timeStyle: 'short' })).toBe(
        'Samstag, 20. Juni 2099 um 14:00',
      );
    });

    it('formats date ranges per language', () => {
      const start = '2099-06-20T14:00:00+02:00';
      const end = '2099-06-21T01:00:00+02:00';
      expect(plain(formatDateRange(start, end, 'de', BERLIN))).toBe('20.–21. Juni 2099');
      expect(plain(formatDateRange(start, end, 'en', BERLIN))).toBe('June 20 – 21, 2099');
      expect(plain(formatDateRange(start, end, 'es', BERLIN))).toBe('20–21 de junio de 2099');
      expect(formatDateRange(start, '2099-06-20T18:00:00+02:00', 'de', BERLIN)).toBe(
        '20. Juni 2099',
      );
    });

    it('formats time ranges and date-time ranges per language', () => {
      const start = '2099-06-20T14:00:00+02:00';
      const end = '2099-06-20T18:00:00+02:00';
      const times = { timeStyle: 'short' } as const;
      expect(plain(formatDateRange(start, end, 'de', BERLIN, times))).toBe('14:00–18:00 Uhr');
      expect(plain(formatDateRange(start, end, 'en', BERLIN, times))).toBe('2:00 – 6:00 PM');
      expect(plain(formatDateRange(start, end, 'es', BERLIN, times))).toBe('14:00–18:00');
      expect(
        plain(
          formatDateRange(start, '2099-06-21T01:00:00+02:00', 'en', BERLIN, {
            dateStyle: 'long',
            timeStyle: 'short',
          }),
        ),
      ).toBe('June 20, 2099 at 2:00 PM – June 21, 2099 at 1:00 AM');
    });

    it('handles the spring-forward DST boundary in the event time zone', () => {
      expect(formatTime('2099-03-29T00:59:00Z', 'de', BERLIN)).toBe('01:59');
      expect(formatTime('2099-03-29T01:00:00Z', 'de', BERLIN)).toBe('03:00');
      // One hour apart, but the wall clock jumps two.
      expect(
        plain(
          formatDateRange('2099-03-29T00:30:00Z', '2099-03-29T01:30:00Z', 'de', BERLIN, {
            timeStyle: 'short',
          }),
        ),
      ).toBe('01:30–03:30 Uhr');
      // 23:30 UTC on 28 March is already 29 March in Berlin.
      expect(formatDate('2099-03-28T23:30:00Z', 'de', BERLIN)).toBe('29. März 2099');
    });

    it('handles the fall-back DST boundary in the event time zone', () => {
      // 02:30 happens twice: first in summer time (+02:00), then in standard time (+01:00).
      expect(formatTime('2099-10-25T02:30:00+02:00', 'de', BERLIN)).toBe('02:30');
      expect(formatTime('2099-10-25T02:30:00+01:00', 'de', BERLIN)).toBe('02:30');
      expect(
        plain(formatDateTime('2099-10-25T00:59:00Z', 'en', BERLIN, { timeStyle: 'short' })),
      ).toBe('2:59 AM');
      expect(plain(formatTime('2099-10-25T01:00:00Z', 'en', BERLIN))).toBe('2:00 AM');
    });

    it('throws a RangeError for an invalid date', () => {
      expect(() => formatDate('not a date', 'de', BERLIN)).toThrow(RangeError);
    });
  },
);
