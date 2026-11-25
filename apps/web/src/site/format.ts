import type { BuildInfo, SiteContent } from '@weddingplanner/content';
import type { Lang } from './i18n.ts';

/** Formats an instant as a date in `lang`, as seen in `timeZone` (the event's, never the visitor's). */
export function formatDate(
  iso: string,
  lang: Lang,
  timeZone: string,
  dateStyle: 'full' | 'long' = 'full',
): string {
  return new Intl.DateTimeFormat(lang, { dateStyle, timeZone }).format(new Date(iso));
}

/**
 * The RSVP deadline as guests read it: the content's display date when set, else the date of the
 * enforced deadline (`instance.json`, baked into `build.json`) in its time zone.
 */
export function formatDeadline(
  content: Pick<SiteContent, 'rsvpDeadline'>,
  build: Pick<BuildInfo, 'rsvpDeadline' | 'rsvpTimeZone'>,
  lang: Lang,
): string {
  return content.rsvpDeadline !== undefined
    ? formatDate(`${content.rsvpDeadline}T12:00:00Z`, lang, 'UTC', 'long')
    : formatDate(build.rsvpDeadline, lang, build.rsvpTimeZone, 'long');
}

/** URL of a file in the instance's `media/` folder (published under `/media/`). */
export function mediaUrl(id: string): string {
  return `/media/${id.split('/').map(encodeURIComponent).join('/')}`;
}

/** Google Maps universal link with directions to a point. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/** Google Maps universal link that searches for an address. */
export function searchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** `tel:` link: digits and a leading plus only. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** WhatsApp chat link (`wa.me` wants the international number as digits only). */
export function whatsappUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}
