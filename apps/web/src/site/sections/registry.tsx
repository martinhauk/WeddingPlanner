import type { Section, SectionType } from '@weddingplanner/content';
import type { ReactNode } from 'react';
import { Contact } from './Contact.tsx';
import { Dresscode } from './Dresscode.tsx';
import { Faq } from './Faq.tsx';
import { Gifts } from './Gifts.tsx';
import { Locations } from './Locations.tsx';
import { Music } from './Music.tsx';
import { Rsvp } from './Rsvp.tsx';
import { Schedule } from './Schedule.tsx';
import { Story } from './Story.tsx';
import { TextSection } from './TextSection.tsx';
import { isShown } from './titles.ts';
import type { SectionComponent, SectionContext } from './types.ts';
import { WeddingParty } from './WeddingParty.tsx';

/**
 * One component per section type. The mapped type makes a new type in the content schema a
 * compile error here until it has a component.
 */
export const SECTION_COMPONENTS: { readonly [T in SectionType]: SectionComponent<T> } = {
  story: Story,
  schedule: Schedule,
  locations: Locations,
  weddingParty: WeddingParty,
  dresscode: Dresscode,
  music: Music,
  text: TextSection,
  faq: Faq,
  gifts: Gifts,
  contact: Contact,
  rsvp: Rsvp,
};

/** Renders one section with the component of its type, or nothing when it is not shown. */
export function renderSection(section: Section, ctx: SectionContext): ReactNode {
  if (!isShown(section, ctx.build.features)) {
    return null;
  }
  // TypeScript cannot correlate `section.type` with the component's props across the union.
  const Component = SECTION_COMPONENTS[section.type] as SectionComponent<SectionType>;
  return <Component key={section.id} section={section} ctx={ctx} />;
}
