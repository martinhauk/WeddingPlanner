import type { Section } from '@weddingplanner/content';
import type { ReactNode } from 'react';
import type { Lang } from '../i18n.ts';
import { sectionTitle } from '../sections/titles.ts';

export type SectionFrameProps = {
  readonly section: Section;
  readonly lang: Lang;
  readonly children: ReactNode;
};

/** The `<section>` around every section type: anchor id, heading and shared spacing. */
export function SectionFrame({ section, lang, children }: SectionFrameProps) {
  const title = sectionTitle(section, lang);
  const headingId = `${section.id}-title`;
  return (
    <section
      id={section.id}
      className={`section section-${section.type}`}
      aria-labelledby={title === '' ? undefined : headingId}
    >
      {title !== '' && <h2 id={headingId}>{title}</h2>}
      {children}
    </section>
  );
}
