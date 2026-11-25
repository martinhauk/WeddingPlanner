import { z } from 'zod';
import { coded, dateTimeWithOffsetSchema, nonEmptyStringSchema, timeZoneSchema } from './common.ts';
import { localizedTextSchema } from './localizable.ts';

/**
 * `site-content.json`: everything the one-pager shows, per instance. The web app reads it at build
 * time (a Vite plugin validates it with this schema) and renders `sections` in order.
 *
 * Every user-visible text is a `LocalizedText` (`{ de, en?, es? }`; English and Spanish fall back to
 * German). Names, addresses and times are plain strings. Media are paths inside the instance's
 * `media/` folder (e.g. `hero.png`), published under `/media/`. Extend fields, never rename them
 * without a `schemaVersion` bump; `pnpm --filter @weddingplanner/content schema` regenerates
 * `schema/site-content.schema.json` after a change.
 */

/**
 * Self-hosted fonts a theme may use (one `@fontsource/<id>` package each in `apps/web`). `weights`
 * lists the stylesheets the build imports; every font also gets its 400 italic. Browsers download
 * only the files a page uses.
 */
export const SITE_FONTS = {
  'cormorant-garamond': {
    family: 'Cormorant Garamond',
    fallback: 'Georgia, serif',
    weights: [300, 400, 500, 600],
  },
  'eb-garamond': { family: 'EB Garamond', fallback: 'Georgia, serif', weights: [400, 500, 600] },
  'playfair-display': {
    family: 'Playfair Display',
    fallback: 'Georgia, serif',
    weights: [400, 500, 600],
  },
  jost: { family: 'Jost', fallback: 'system-ui, sans-serif', weights: [300, 400, 500, 600] },
  lato: { family: 'Lato', fallback: 'system-ui, sans-serif', weights: [300, 400, 700] },
  montserrat: {
    family: 'Montserrat',
    fallback: 'system-ui, sans-serif',
    weights: [300, 400, 500, 600],
  },
} as const satisfies Record<
  string,
  { family: string; fallback: string; weights: readonly number[] }
>;

export type SiteFontId = keyof typeof SITE_FONTS;
export const SITE_FONT_IDS = Object.keys(SITE_FONTS) as [SiteFontId, ...SiteFontId[]];

/** A file in the instance's `media/` folder: POSIX path segments, no dot files, an image type. */
export const MEDIA_PATH_PATTERN =
  /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;

/** Section ids are HTML ids and URL fragments (`#our-story`). */
export const SECTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** Ids the page itself uses; a section must not take them. */
export const RESERVED_SECTION_IDS = ['top', 'root', 'site-nav'] as const;

const idSchema = z.string().regex(SECTION_ID_PATTERN, {
  error: coded('E_ID', 'must be a lowercase id of letters, digits and hyphens, e.g. our-story'),
});

export const mediaPathSchema = z.string().regex(MEDIA_PATH_PATTERN, {
  error: coded('E_MEDIA_PATH', 'must be a .png, .jpg or .webp file inside media/, e.g. hero.png'),
});

const colorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  error: coded('E_COLOR', 'must be a hex color, e.g. #8a9a7e'),
});

const fontSchema = z.enum(SITE_FONT_IDS, {
  error: coded('E_FONT', `must be one of ${SITE_FONT_IDS.join(', ')}`),
});

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, {
  error: coded('E_TIME', 'must be a 24-hour time, e.g. 14:30'),
});

const httpsUrlSchema = z.url({
  protocol: /^https$/,
  hostname: z.regexes.domain,
  error: coded('E_URL', 'must be an https URL'),
});

const phoneSchema = z.string().regex(/^\+?[0-9][0-9 ()/-]{3,}[0-9]$/, {
  error: coded('E_PHONE', 'must be a phone number, e.g. +49 151 00000000'),
});

const whatsappSchema = z.string().regex(/^\+[1-9][0-9 ]{5,}[0-9]$/, {
  error: coded('E_WHATSAPP', 'must be a phone number in international format, e.g. +49 151 0000'),
});

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

/** An image with optional alternative text (decorative when absent). */
export const imageSchema = z.strictObject({
  src: mediaPathSchema,
  alt: localizedTextSchema.optional(),
});

export const themeSchema = z.strictObject({
  colors: z.strictObject({
    /** Page background. */
    bg: colorSchema,
    /** Cards, form fields and the open mobile menu. */
    paper: colorSchema,
    /** Body text. */
    ink: colorSchema,
    /** Secondary text. */
    muted: colorSchema,
    /** Buttons and decorative lines (white text sits on it). */
    accent: colorSchema,
    /** Links, hover states and small accent text. */
    accentDark: colorSchema,
    /** Hairlines and borders. */
    line: colorSchema,
  }),
  fonts: z.strictObject({
    heading: fontSchema,
    body: fontSchema,
  }),
});

const sectionBase = {
  /** HTML id and URL fragment, unique on the page. */
  id: idSchema,
  /** Heading; defaults to the standard title of the section type. */
  title: localizedTextSchema.optional(),
  /** Label in the navigation; defaults to the heading. */
  nav: localizedTextSchema.optional(),
  /**
   * `false` hides the section and its navigation entry, and keeps it out of the published page
   * (a draft). Default `true`.
   */
  visible: z.boolean().optional(),
};

const storyData = z.strictObject({
  /** Paragraphs are separated by a blank line. */
  text: localizedTextSchema,
  images: z.array(imageSchema).max(12).optional(),
});

const scheduleItem = z.strictObject({
  time: timeSchema,
  title: localizedTextSchema,
  /** `id` of a card in a `locations` section. */
  locationId: idSchema.optional(),
  note: localizedTextSchema.optional(),
});

const locationCard = z.strictObject({
  /** Referenced by schedule items. */
  id: idSchema,
  name: nonEmptyStringSchema,
  /** What happens there, e.g. "Ceremony". */
  kind: localizedTextSchema,
  address: nonEmptyStringSchema,
  lat: latitudeSchema,
  lng: longitudeSchema,
  note: localizedTextSchema.optional(),
});

const hotel = z.strictObject({
  name: nonEmptyStringSchema,
  address: nonEmptyStringSchema,
  url: httpsUrlSchema.optional(),
  note: localizedTextSchema.optional(),
});

const partyMember = z.strictObject({
  name: nonEmptyStringSchema,
  /** E.g. "Maid of honour". */
  role: localizedTextSchema,
  photo: mediaPathSchema.optional(),
  /** Shown in a dialog when the person is clicked. */
  text: localizedTextSchema,
});

const contactPerson = z.strictObject({
  name: nonEmptyStringSchema,
  phone: phoneSchema.optional(),
  email: z.email({ error: coded('E_EMAIL', 'must be an email address') }).optional(),
  /** Number for a WhatsApp chat link (wa.me), international format. */
  whatsapp: whatsappSchema.optional(),
});

function section<const T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.strictObject({ type: z.literal(type), ...sectionBase, data });
}

export const sectionSchema = z.discriminatedUnion(
  'type',
  [
    section('story', storyData),
    section('schedule', z.strictObject({ items: z.array(scheduleItem).min(1) })),
    section(
      'locations',
      z.strictObject({
        cards: z.array(locationCard).min(1),
        hotels: z.array(hotel).optional(),
      }),
    ),
    section(
      'weddingParty',
      z.strictObject({
        intro: localizedTextSchema.optional(),
        people: z.array(partyMember).min(1),
      }),
    ),
    section(
      'dresscode',
      z.strictObject({
        text: localizedTextSchema,
        images: z.array(imageSchema).max(12).optional(),
      }),
    ),
    section(
      'music',
      z.strictObject({
        text: localizedTextSchema,
        link: z
          .strictObject({ url: httpsUrlSchema, label: localizedTextSchema.optional() })
          .optional(),
      }),
    ),
    section(
      'text',
      z.strictObject({
        text: localizedTextSchema,
        image: imageSchema.optional(),
      }),
    ),
    section(
      'faq',
      z.strictObject({
        items: z.array(z.strictObject({ q: localizedTextSchema, a: localizedTextSchema })).min(1),
      }),
    ),
    // Text only: bank details never belong on the public page.
    section('gifts', z.strictObject({ text: localizedTextSchema })),
    section(
      'contact',
      z.strictObject({
        intro: localizedTextSchema.optional(),
        people: z.array(contactPerson).min(1),
      }),
    ),
    section('rsvp', z.strictObject({ intro: localizedTextSchema.optional() })),
  ],
  { error: coded('E_SECTION_TYPE', 'must be a known section type') },
);

export const siteContentSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  /** How the couple is written, e.g. "Anna & Ben" / "Anna y Ben". */
  couple: localizedTextSchema,
  event: z.strictObject({
    start: dateTimeWithOffsetSchema,
    /** IANA zone in which dates are shown, e.g. `Europe/Berlin`. */
    timeZone: timeZoneSchema,
  }),
  /** Line above the names in the hero, e.g. "We're getting married". */
  tagline: localizedTextSchema,
  place: localizedTextSchema,
  /**
   * RSVP deadline as shown to guests (ISO date). Display only: the API enforces `instance.json`
   * `rsvp.deadline`, which the page shows when this is absent.
   */
  rsvpDeadline: z.iso
    .date({ error: coded('E_DATE', 'must be an ISO date, e.g. 2099-05-01') })
    .optional(),
  theme: themeSchema,
  hero: z.strictObject({ image: mediaPathSchema.optional() }),
  /** Rendered in this order; the navigation lists the visible ones. */
  sections: z.array(sectionSchema).min(1),
});

export type SiteContent = z.infer<typeof siteContentSchema>;
export type SiteTheme = z.infer<typeof themeSchema>;
export type ContentImage = z.infer<typeof imageSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section['type'];
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

export const SECTION_TYPES = sectionSchema.options.map(
  (option) => option.shape.type.value,
) as SectionType[];
