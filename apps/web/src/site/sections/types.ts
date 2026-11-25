import type { BuildInfo, SectionOf, SectionType, SiteContent } from '@weddingplanner/content';
import type { ReactNode } from 'react';
import type { Lang } from '../i18n.ts';

/** The parts of the baked `build.json` the page uses. */
export type SiteBuild = Pick<BuildInfo, 'features' | 'rsvpDeadline' | 'rsvpTimeZone'>;

/** What every section can read besides its own data. */
export type SectionContext = {
  readonly lang: Lang;
  readonly content: SiteContent;
  readonly build: SiteBuild;
};

export type SectionProps<T extends SectionType> = {
  readonly section: SectionOf<T>;
  readonly ctx: SectionContext;
};

export type SectionComponent<T extends SectionType> = (props: SectionProps<T>) => ReactNode;
