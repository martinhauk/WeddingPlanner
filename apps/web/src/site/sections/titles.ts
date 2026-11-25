import type { Features, Section, SiteContent } from '@weddingplanner/content';
import { type Lang, t } from '../i18n.ts';
import { sectionTitles } from '../ui.ts';

/** The section's heading: its `title`, else the default of its type (none for `text`). */
export function sectionTitle(section: Section, lang: Lang): string {
  return t(section.title, lang) || t(sectionTitles[section.type], lang);
}

/** The navigation label: `nav`, else the heading. */
export function navLabel(section: Section, lang: Lang): string {
  return t(section.nav, lang) || sectionTitle(section, lang);
}

/**
 * Whether the page shows the section: not hidden by the content, and its feature switched on for
 * this build (the RSVP section needs `features.rsvp`; the API enforces the same flag).
 */
export function isShown(section: Section, features: Features): boolean {
  return section.visible !== false && (section.type !== 'rsvp' || features.rsvp);
}

export type NavItem = { readonly id: string; readonly label: string };

/** Navigation entries: every shown section that has a label, in content order. */
export function navItems(content: SiteContent, features: Features, lang: Lang): NavItem[] {
  return content.sections
    .filter((section) => isShown(section, features))
    .map((section) => ({ id: section.id, label: navLabel(section, lang) }))
    .filter((item) => item.label !== '');
}
