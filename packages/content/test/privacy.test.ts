import { describe, expect, it } from 'vitest';
import { eventDate, privacyDeleteBy } from '../src/privacy.ts';

const event = (start: string, timeZone = 'Europe/Berlin') => ({ start, timeZone });

describe('eventDate', () => {
  it('is the calendar date in the event time zone, not in UTC', () => {
    expect(eventDate(event('2099-06-20T00:30:00+02:00'))).toBe('2099-06-20');
    expect(eventDate(event('2099-06-20T23:30:00-05:00', 'America/Bogota'))).toBe('2099-06-20');
  });
});

describe('privacyDeleteBy', () => {
  it('defaults to the last day of the third month after the wedding', () => {
    expect(privacyDeleteBy({ event: event('2099-06-20T14:00:00+02:00') })).toBe('2099-09-30');
    expect(privacyDeleteBy({ event: event('2099-11-30T14:00:00+01:00') })).toBe('2100-02-28');
    expect(privacyDeleteBy({ event: event('2099-10-01T14:00:00+02:00') })).toBe('2100-01-31');
    expect(privacyDeleteBy({ event: event('2099-06-20T14:00:00+02:00'), privacy: {} })).toBe(
      '2099-09-30',
    );
  });

  it('uses the configured date', () => {
    expect(
      privacyDeleteBy({
        event: event('2099-06-20T14:00:00+02:00'),
        privacy: { deleteBy: '2099-12-31' },
      }),
    ).toBe('2099-12-31');
  });
});
