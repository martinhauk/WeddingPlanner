import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_INSTANCE_DIR } from './paths.ts';

/**
 * What the device specs expect on the page, read from the fictional sample instance the preview
 * serves (`samples/instance/site-content.json`), so a content change does not break the specs.
 * Pure (no Playwright imports).
 */

/** The site languages in switcher order (the web app's `LANGS`); German is the default. */
export const LANGS = ['de', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

/** Names of the languages in the switcher (`EN English`, ...). */
export const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
};

export type SampleSection = {
  readonly id: string;
  readonly type: string;
  /** The section has a heading: a `title`, or a type with a default title (all but `text`). */
  readonly hasHeading: boolean;
  /** The navigation links it: it has a heading or a `nav` label. */
  readonly inNav: boolean;
};

type RawSection = {
  readonly id: string;
  readonly type: string;
  readonly visible?: boolean;
  readonly title?: unknown;
  readonly nav?: unknown;
};

type RawContent = {
  readonly couple: Readonly<Record<Lang, string>>;
  readonly sections: readonly RawSection[];
};

/** Parses the parts of `site-content.json` the specs use; throws on an unexpected shape. */
export function parseSample(json: unknown): {
  couple: Readonly<Record<Lang, string>>;
  sections: SampleSection[];
} {
  const content = json as Partial<RawContent>;
  if (typeof content.couple?.de !== 'string' || !Array.isArray(content.sections)) {
    throw new Error('site-content.json has no couple or sections');
  }
  const sections = content.sections
    .filter((section) => section.visible !== false)
    .map((section) => {
      if (!/^[a-z0-9-]+$/.test(section.id)) throw new Error(`invalid section id ${section.id}`);
      const hasHeading = section.title !== undefined || section.type !== 'text';
      return {
        id: section.id,
        type: section.type,
        hasHeading,
        inNav: hasHeading || section.nav !== undefined,
      };
    });
  return { couple: content.couple, sections };
}

const sample = parseSample(
  JSON.parse(readFileSync(path.join(SAMPLE_INSTANCE_DIR, 'site-content.json'), 'utf8')),
);

/** The couple's names per language (`Anna & Ben`, `Anna y Ben`). */
export const COUPLE = sample.couple;

/** The shown sections of the sample, in page order. */
export const SECTIONS: readonly SampleSection[] = sample.sections;

/** The first shown section of a type; fails when the sample has none. */
export function sectionOfType(type: string): SampleSection {
  const found = SECTIONS.find((section) => section.type === type);
  if (found === undefined) throw new Error(`The sample instance has no shown ${type} section`);
  return found;
}
