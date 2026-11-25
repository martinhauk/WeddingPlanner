import { collectLocalizedTexts, SITE_LANGUAGES } from '../schema/localizable.ts';
import {
  RESERVED_SECTION_IDS,
  type SiteContent,
  siteContentSchema,
} from '../schema/site-content.ts';
import {
  type Diagnostic,
  diagnosticsFromZod,
  error,
  hasErrors,
  jsonPath,
  warning,
} from './diagnostics.ts';
import { findLocalizedTexts } from './localized-texts.ts';
import { type MediaSource, scanMedia } from './media.ts';
import { readJson } from './read-json.ts';

export const SITE_CONTENT_FILE = 'site-content.json';

export type SiteContentCheck = {
  /** Parsed content when it matches the schema (it may still have semantic errors). */
  readonly content: SiteContent | undefined;
  readonly diagnostics: Diagnostic[];
};

/**
 * Validates the parsed JSON of `site-content.json`: the schema, then what the schema cannot express
 * (unique ids, schedule → location references, media that exist in `media/`) and translations that
 * fall back to German (warnings only: English and Spanish are optional by design).
 *
 * `mediaIds` are the ids of the instance's media (paths relative to `media/`).
 */
export function checkSiteContent(value: unknown, mediaIds: ReadonlySet<string>): SiteContentCheck {
  const { result: parsed, texts } = collectLocalizedTexts(() =>
    siteContentSchema.safeParse(value, { reportInput: true }),
  );
  if (!parsed.success) {
    return { content: undefined, diagnostics: diagnosticsFromZod(SITE_CONTENT_FILE, parsed.error) };
  }
  const content = parsed.data;
  const diagnostics = [
    ...checkIds(content),
    ...checkLocationReferences(content),
    ...checkMedia(content, mediaIds),
  ];
  for (const { path, text } of findLocalizedTexts(content, texts)) {
    for (const language of SITE_LANGUAGES) {
      const translation = text[language];
      if (translation === undefined || translation.trim() === '') {
        diagnostics.push(
          warning(
            'W_I18N_FALLBACK',
            SITE_CONTENT_FILE,
            jsonPath([...path, language]),
            'missing translation; the German text is shown instead',
          ),
        );
      }
    }
  }
  return { content, diagnostics };
}

export type SiteContentLoad = {
  /** `true` when there is no diagnostic with severity `error`. */
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
  readonly content: SiteContent | undefined;
  /** Supported, readable images in `media/`, sorted by id; published under `/media/<id>`. */
  readonly media: MediaSource[];
};

/** Reads and validates `<instanceDir>/site-content.json` and scans `<instanceDir>/media/`. */
export async function loadSiteContent(instanceDir: string): Promise<SiteContentLoad> {
  const diagnostics: Diagnostic[] = [];
  const scanned = await scanMedia(instanceDir);
  const json = await readJson(instanceDir, SITE_CONTENT_FILE, diagnostics);
  let content: SiteContent | undefined;
  if (json.ok) {
    const checked = checkSiteContent(json.value, new Set(scanned.media.map((m) => m.id)));
    diagnostics.push(...checked.diagnostics);
    content = checked.content;
  }
  diagnostics.push(...scanned.diagnostics);
  return { ok: !hasErrors(diagnostics), diagnostics, content, media: scanned.media };
}

/**
 * The content the page publishes in its public bundle: without `$schema` and without hidden
 * sections (`visible: false`), so drafts never reach guests. A schedule item that points to a card
 * of a hidden locations section is then shown without the place.
 */
export function publishedSiteContent(content: SiteContent): SiteContent {
  const { $schema: _, ...published } = content;
  return { ...published, sections: content.sections.filter((s) => s.visible !== false) };
}

/**
 * The media `content` references, in the order of `media`. Pass the published content, so images
 * that only drafts or nothing at all use are not published.
 */
export function publishedMedia(content: SiteContent, media: readonly MediaSource[]): MediaSource[] {
  const referenced = new Set(mediaReferences(content).map((ref) => ref.id));
  return media.filter((item) => referenced.has(item.id));
}

function checkIds(content: SiteContent): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const reserved: readonly string[] = RESERVED_SECTION_IDS;
  const sectionIds = new Set<string>();
  const cardIds = new Set<string>();
  content.sections.forEach((section, index) => {
    const at = jsonPath(['sections', index, 'id']);
    if (reserved.includes(section.id)) {
      diagnostics.push(error('E_ID_RESERVED', SITE_CONTENT_FILE, at, 'is used by the page itself'));
    } else if (sectionIds.has(section.id)) {
      diagnostics.push(error('E_ID_DUP', SITE_CONTENT_FILE, at, 'duplicate section id'));
    }
    sectionIds.add(section.id);
    if (section.type === 'locations') {
      section.data.cards.forEach((card, cardIndex) => {
        if (cardIds.has(card.id)) {
          diagnostics.push(
            error(
              'E_ID_DUP',
              SITE_CONTENT_FILE,
              jsonPath(['sections', index, 'data', 'cards', cardIndex, 'id']),
              'duplicate location id',
            ),
          );
        }
        cardIds.add(card.id);
      });
    }
  });
  return diagnostics;
}

function checkLocationReferences(content: SiteContent): Diagnostic[] {
  const locationIds = new Set(
    content.sections.flatMap((s) => (s.type === 'locations' ? s.data.cards.map((c) => c.id) : [])),
  );
  const diagnostics: Diagnostic[] = [];
  content.sections.forEach((section, index) => {
    if (section.type !== 'schedule') {
      return;
    }
    section.data.items.forEach((item, itemIndex) => {
      if (item.locationId !== undefined && !locationIds.has(item.locationId)) {
        diagnostics.push(
          error(
            'E_REF',
            SITE_CONTENT_FILE,
            jsonPath(['sections', index, 'data', 'items', itemIndex, 'locationId']),
            'no card of a locations section has this id',
          ),
        );
      }
    });
  });
  return diagnostics;
}

/** Every media reference of the content with its JSON path. */
export function mediaReferences(content: SiteContent): Array<{ path: PropertyKey[]; id: string }> {
  const refs: Array<{ path: PropertyKey[]; id: string }> = [];
  if (content.hero.image !== undefined) {
    refs.push({ path: ['hero', 'image'], id: content.hero.image });
  }
  content.sections.forEach((section, index) => {
    const at = ['sections', index, 'data'];
    switch (section.type) {
      case 'story':
      case 'dresscode':
        section.data.images?.forEach((image, i) => {
          refs.push({ path: [...at, 'images', i, 'src'], id: image.src });
        });
        break;
      case 'text':
        if (section.data.image !== undefined) {
          refs.push({ path: [...at, 'image', 'src'], id: section.data.image.src });
        }
        break;
      case 'weddingParty':
        section.data.people.forEach((person, i) => {
          if (person.photo !== undefined) {
            refs.push({ path: [...at, 'people', i, 'photo'], id: person.photo });
          }
        });
        break;
      default:
        break;
    }
  });
  return refs;
}

function checkMedia(content: SiteContent, mediaIds: ReadonlySet<string>): Diagnostic[] {
  return mediaReferences(content)
    .filter((ref) => !mediaIds.has(ref.id))
    .map((ref) =>
      error(
        'E_MEDIA_MISSING',
        SITE_CONTENT_FILE,
        jsonPath(ref.path),
        'no readable image with this path in media/',
      ),
    );
}
