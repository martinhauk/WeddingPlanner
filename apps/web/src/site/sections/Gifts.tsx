import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

/** Text only: the schema has no fields for bank details. */
export function Gifts({ section, ctx }: SectionProps<'gifts'>) {
  return (
    <SectionFrame section={section} lang={ctx.lang}>
      <Paragraphs className="lead" text={t(section.data.text, ctx.lang)} />
    </SectionFrame>
  );
}
