import { describe, expect, it } from 'vitest';
import { eventDate, privacyDeleteBy } from '../src/privacy.ts';

const event = (start: string, timeZone = 'Europe/Berlin') => ({ start, timeZone });

describe('eventDate', () => {
  it('is the calendar date in the event time zone, not in UTC', () => {
    expect(eventDate(event('2099-08-14T00:30:00+02:00'))).toBe('2099-08-14');
    expect(eventDate(event('2099-01-15T23:30:00-05:00', 'America/New_York'))).toBe('2099-01-15');
  });
});

describe('privacyDeleteBy', () => {
  it('defaults to the last day of the third month after the wedding', () => {
    expect(privacyDeleteBy({ event: event('2099-05-16T15:00:00+02:00') })).toBe('2099-08-31');
    expect(privacyDeleteBy({ event: event('2099-11-30T15:00:00+01:00') })).toBe('2100-02-28');
    expect(privacyDeleteBy({ event: event('2099-10-01T15:00:00+02:00') })).toBe('2100-01-31');
    expect(privacyDeleteBy({ event: event('2099-05-16T15:00:00+02:00'), privacy: {} })).toBe(
      '2099-08-31',
    );
  });

  it('uses the configured date', () => {
    expect(
      privacyDeleteBy({
        event: event('2099-05-16T15:00:00+02:00'),
        privacy: { deleteBy: '2099-12-31' },
      }),
    ).toBe('2099-12-31');
  });
});
