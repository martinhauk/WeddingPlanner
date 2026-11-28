import { z } from 'zod';

/**
 * Builds a schema error message that carries a stable diagnostic code (`E_SLUG: must match …`).
 * `validate` turns it into a diagnostic with that code. Messages must never contain input values:
 * deploy logs are public.
 */
export function coded(code: string, message: string): string {
  return `${code}: ${message}`;
}

const CODED_MESSAGE = /^([EW]_[A-Z0-9_]+): (.+)$/s;

/** Splits a message built with `coded` into its code and text; `undefined` for other messages. */
export function decodeCoded(message: string): { code: string; message: string } | undefined {
  const match = CODED_MESSAGE.exec(message);
  if (match?.[1] === undefined || match[2] === undefined) {
    return undefined;
  }
  return { code: match[1], message: match[2] };
}

/**
 * A canonical BCP 47 language tag: language, optional script and optional region, in canonical
 * case (`de`, `en-GB`, `es-419`, `zh-Hant-TW`). Localized texts use these tags as keys, so the
 * exact spelling matters.
 */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;

export const languageTagSchema = z.string().regex(LANGUAGE_TAG_PATTERN, {
  error: coded('E_LANG', 'must be a canonical BCP 47 language tag, e.g. de, en-GB or es-419'),
});

const TIME_ZONE_PATTERN = /^(?:UTC|[A-Z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/;

/** True for an IANA time zone name the runtime knows (`Europe/Berlin`, `America/Mexico_City`). */
export function isIanaTimeZone(value: string): boolean {
  if (!TIME_ZONE_PATTERN.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().refine(isIanaTimeZone, {
  error: coded('E_TZ', 'must be an IANA time zone name, e.g. Europe/Berlin'),
});

/** An ISO 8601 date-time with a UTC offset (`2099-07-01T23:59:00+02:00` or `…Z`). */
export const dateTimeWithOffsetSchema = z.iso.datetime({
  offset: true,
  error: coded(
    'E_DATETIME',
    'must be an ISO 8601 date-time with a UTC offset, e.g. 2099-05-01T23:59:00+02:00',
  ),
});

export const nonEmptyStringSchema = z.string().trim().min(1);
