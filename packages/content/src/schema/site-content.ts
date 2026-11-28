import { z } from 'zod';
import { LINK_URL_PATTERN } from '../inline-text.ts';
import { coded, dateTimeWithOffsetSchema, nonEmptyStringSchema, timeZoneSchema } from './common.ts';
import { localizedTextSchema } from './localizable.ts';

/**
 * `site-content.json`: everything the one-pager shows, per instance. The web app reads it at build
 * time (a Vite plugin validates it with this schema) and renders `sections` in order.
 *
 * Every user-visible text is a `LocalizedText` (`{ de, en?, es? }`; English and Spanish fall back to
 * German). Names, addresses and times are plain strings. Media are paths inside the instance's
 * `media/` folder (e.g. `hero.webp`), published under `/media/`. Extend fields, never rename them
 * without a `schemaVersion` bump; `pnpm --filter @weddingplanner/content schema` regenerates
 * `schema/site-content.schema.json` after a change.
 */

/**
 * Self-hosted fonts a theme may use (one `@fontsource/<id>` package each in `apps/web`). `weights`
 * lists the stylesheets the build imports; every font also gets its 400 italic. Browsers download
 * only the files a page uses. `bodyWeight` and `bodySize` set body text in the font so that it
 * reads well, also as light text on a dark background: Cormorant has a small x-height and thin
 * strokes, so it gets a larger size and a heavier weight than a sans-serif.
 */
export const SITE_FONTS = {
  'cormorant-garamond': {
    family: 'Cormorant Garamond',
    fallback: 'Georgia, serif',
    weights: [300, 400, 500, 600],
    bodyWeight: 500,
    bodySize: '1.2rem',
  },
  'eb-garamond': {
    family: 'EB Garamond',
    fallback: 'Georgia, serif',
    weights: [400, 500, 600],
    bodyWeight: 400,
    bodySize: '1.12rem',
  },
  'playfair-display': {
    family: 'Playfair Display',
    fallback: 'Georgia, serif',
    weights: [400, 500, 600],
    bodyWeight: 400,
    bodySize: '1.02rem',
  },
  jost: {
    family: 'Jost',
    fallback: 'system-ui, sans-serif',
    weights: [300, 400, 500, 600],
    bodyWeight: 300,
    bodySize: '1.05rem',
  },
  lato: {
    family: 'Lato',
    fallback: 'system-ui, sans-serif',
    weights: [300, 400, 700],
    bodyWeight: 400,
    bodySize: '1.02rem',
  },
  montserrat: {
    family: 'Montserrat',
    fallback: 'system-ui, sans-serif',
    weights: [300, 400, 500, 600],
    bodyWeight: 300,
    bodySize: '1rem',
  },
} as const satisfies Record<
  string,
  {
    family: string;
    fallback: string;
    weights: readonly number[];
    bodyWeight: number;
    bodySize: string;
  }
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

/** A link target: `https://…`, `mailto:…` or `tel:…` (see `LINK_URL_PATTERN`). */
const linkUrlSchema = z.string().regex(LINK_URL_PATTERN, {
  error: coded('E_LINK_URL', 'must be an https, mailto: or tel: link'),
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
    /** Page background. A dark `bg` with a light `ink` makes the page a dark theme. */
    bg: colorSchema,
    /** Cards, form fields and the open mobile menu. */
    paper: colorSchema,
    /** Body text. */
    ink: colorSchema,
    /** Secondary text. */
    muted: colorSchema,
    /** Buttons and decorative lines. */
    accent: colorSchema,
    /**
     * Links, hover states and small accent text; must be readable on `bg` (in a dark theme this is
     * the lighter accent, despite the name).
     */
    accentDark: colorSchema,
    /** Hairlines and borders. */
    line: colorSchema,
    /** Text on `accent` buttons. Default: white or the theme's darkest color, whichever reads better. */
    onAccent: colorSchema.optional(),
    /**
     * Background around the page on wide screens. When set, the page is a centered column on this
     * color (the hero still spans the full width).
     */
    frame: colorSchema.optional(),
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

/** A part of the story under its own small heading, e.g. a question and its answer. */
const storyItem = z.strictObject({
  /** E.g. "Two raised beds", or a question. */
  heading: localizedTextSchema.optional(),
  /** Paragraphs are separated by a blank line. */
  text: localizedTextSchema,
});

const storyData = z.strictObject({
  /** The introduction; paragraphs are separated by a blank line. */
  text: localizedTextSchema,
  /** Shown after the introduction, in this order. */
  items: z.array(storyItem).max(30).optional(),
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
  /** Further links under the note, e.g. the car parks to use (a map link each). */
  links: z
    .array(z.strictObject({ label: localizedTextSchema, url: linkUrlSchema }))
    .max(10)
    .optional(),
  website: httpsUrlSchema.optional(),
  phone: phoneSchema.optional(),
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

const emailSchema = z.email({ error: coded('E_EMAIL', 'must be an email address') });

const isoDateSchema = z.iso.date({
  error: coded('E_DATE', 'must be an ISO date, e.g. 2099-05-01'),
});

const contactPerson = z.strictObject({
  name: nonEmptyStringSchema,
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  /** Number for a WhatsApp chat link (wa.me), international format. */
  whatsapp: whatsappSchema.optional(),
});

/**
 * The privacy notice (`/datenschutz`, alias `/privacy`). The page brings the generic text in every
 * site language: what is stored and why, the legal bases, the processors, cookies, how long data is
 * kept and the guests' rights. The instance adds who is responsible and how to reach them.
 */
export const privacySchema = z.strictObject({
  /** The people responsible for the guests' data (GDPR controllers), usually the couple. */
  controllers: z
    .array(
      z.strictObject({
        name: nonEmptyStringSchema,
        /** Optional postal address; a line break separates lines. */
        address: nonEmptyStringSchema.optional(),
      }),
    )
    .min(1)
    .max(4),
  /** Where guests send privacy requests (access, erasure, withdrawing consent). */
  email: emailSchema.optional(),
  /**
   * The day on which all guest data is deleted (ISO date, after the wedding). Default: the last day
   * of the third month after the wedding.
   */
  deleteBy: isoDateSchema.optional(),
  /** Extra paragraphs after the built-in text, e.g. about photos taken at the wedding. */
  extra: z
    .array(z.strictObject({ title: localizedTextSchema.optional(), text: localizedTextSchema }))
    .max(10)
    .optional(),
  /**
   * Imprint (Impressum) text. A private, non-commercial site needs none (the page says so); set it
   * to publish one anyway.
   */
  imprint: localizedTextSchema.optional(),
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
  /** Line above the names in the hero, e.g. "We're tying the knot". */
  tagline: localizedTextSchema,
  place: localizedTextSchema,
  /**
   * RSVP deadline as shown to guests (ISO date). Display only: the API enforces `instance.json`
   * `rsvp.deadline`, which the page shows when this is absent.
   */
  rsvpDeadline: isoDateSchema.optional(),
  theme: themeSchema,
  /**
   * The full-bleed background of the hero: one `image`, or up to two `images` side by side (set
   * one of the two). The names and the date sit on top, so the images are decorative.
   */
  hero: z.strictObject({
    image: mediaPathSchema.optional(),
    images: z.array(mediaPathSchema).min(1).max(2).optional(),
  }),
  /** Rendered in this order; the navigation lists the visible ones. */
  sections: z.array(sectionSchema).min(1),
  /** Controllers, contact and retention of the privacy notice; required before RSVP goes live. */
  privacy: privacySchema.optional(),
});

export type SiteContent = z.infer<typeof siteContentSchema>;
export type SiteTheme = z.infer<typeof themeSchema>;
export type SitePrivacy = z.infer<typeof privacySchema>;
export type ContentImage = z.infer<typeof imageSchema>;
export type StoryItem = z.infer<typeof storyItem>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionType = Section['type'];
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

export const SECTION_TYPES = sectionSchema.options.map(
  (option) => option.shape.type.value,
) as SectionType[];
