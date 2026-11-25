/**
 * Date and time formatting for the event. Every helper takes the event's IANA time zone
 * (`site.event.timeZone`) explicitly, so a guest abroad sees the times of the venue, not of their
 * own device. Inputs are instants: a `Date`, epoch milliseconds or an ISO 8601 string with offset
 * (as in content and `build.json`). An invalid date throws a `RangeError`.
 */

export type DateInput = Date | number | string;
export type DateStyle = 'full' | 'long' | 'medium' | 'short';
/** `long` and `full` would add the time zone name, which the page shows elsewhere if at all. */
export type TimeStyle = 'medium' | 'short';

export type DateTimeStyles = {
  readonly dateStyle?: DateStyle | undefined;
  readonly timeStyle?: TimeStyle | undefined;
};

/** A date, e.g. `long`: de "20. Juni 2099", en "June 20, 2099"; `full` adds the weekday. */
export function formatDate(
  value: DateInput,
  language: string,
  timeZone: string,
  dateStyle: DateStyle = 'long',
): string {
  return formatter(language, timeZone, { dateStyle }).format(toDate(value));
}

/** A time of day, e.g. de "14:00", en "2:00 PM". */
export function formatTime(
  value: DateInput,
  language: string,
  timeZone: string,
  timeStyle: TimeStyle = 'short',
): string {
  return formatter(language, timeZone, { timeStyle }).format(toDate(value));
}

/** A date with a time, e.g. de "20. Juni 2099 um 14:00", en "June 20, 2099 at 2:00 PM". */
export function formatDateTime(
  value: DateInput,
  language: string,
  timeZone: string,
  styles: DateTimeStyles = { dateStyle: 'long', timeStyle: 'short' },
): string {
  return formatter(language, timeZone, styles).format(toDate(value));
}

/**
 * A range with the shared parts written once, per the language's conventions:
 * - dates (default): de "20.–21. Juni 2099", en "June 20 – 21, 2099"
 * - `{ timeStyle: 'short' }`: de "14:00–18:00 Uhr", en "2:00 – 6:00 PM"
 * - both styles: de "20. Juni 2099 um 14:00 – 21. Juni 2099 um 01:00"
 *
 * A range within one day with only `dateStyle` collapses to that single date.
 */
export function formatDateRange(
  start: DateInput,
  end: DateInput,
  language: string,
  timeZone: string,
  styles: DateTimeStyles = { dateStyle: 'long' },
): string {
  return formatter(language, timeZone, styles).formatRange(toDate(start), toDate(end));
}

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  language: string,
  timeZone: string,
  { dateStyle, timeStyle }: DateTimeStyles,
): Intl.DateTimeFormat {
  const key = `${language}|${timeZone}|${dateStyle ?? ''}|${timeStyle ?? ''}`;
  let format = formatterCache.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(language, { dateStyle, timeStyle, timeZone });
    formatterCache.set(key, format);
  }
  return format;
}
