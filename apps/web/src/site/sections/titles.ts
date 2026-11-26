import type { Section, SiteContent } from '@weddingplanner/content';
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
 * Whether the page shows the section: not hidden by the content. The RSVP section is shown with
 * `features.rsvp` off too, with an "opens soon" note instead of the form (the API enforces the flag).
 */
export function isShown(section: Section): boolean {
  return section.visible !== false;
}

export type NavItem = { readonly id: string; readonly label: string };

/** Navigation entries: every shown section that has a label, in content order. */
export function navItems(content: SiteContent, lang: Lang): NavItem[] {
  return content.sections
    .filter(isShown)
    .map((section) => ({ id: section.id, label: navLabel(section, lang) }))
    .filter((item) => item.label !== '');
}
