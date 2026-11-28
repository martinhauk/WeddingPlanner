// Browser-safe privacy helpers (no zod, no Node built-ins): shared by the page and `validate`.

/** How many months after the wedding all guest data is deleted when `privacy.deleteBy` is unset. */
export const DEFAULT_RETENTION_MONTHS = 3;

/** The wedding's calendar date (`YYYY-MM-DD`) in the event's time zone. */
export function eventDate(event: { readonly start: string; readonly timeZone: string }): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: event.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(event.start));
}

/**
 * The day on which all guest data is deleted (`YYYY-MM-DD`): `privacy.deleteBy`, else the last day
 * of the third month after the wedding (a wedding in May: August 31).
 */
export function privacyDeleteBy(content: {
  readonly event: { readonly start: string; readonly timeZone: string };
  readonly privacy?: { readonly deleteBy?: string | undefined } | undefined;
}): string {
  const explicit = content.privacy?.deleteBy;
  if (explicit !== undefined) {
    return explicit;
  }
  const [year, month] = eventDate(content.event).split('-').map(Number);
  // Day 0 of the month after the target month is the target month's last day.
  const last = new Date(Date.UTC(year ?? 0, (month ?? 1) + DEFAULT_RETENTION_MONTHS, 0));
  return last.toISOString().slice(0, 10);
}
