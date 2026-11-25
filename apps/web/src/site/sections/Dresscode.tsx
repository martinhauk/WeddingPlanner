import { Gallery } from '../components/Gallery.tsx';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

export function Dresscode({ section, ctx }: SectionProps<'dresscode'>) {
  return (
    <SectionFrame section={section} lang={ctx.lang}>
      <Paragraphs className="lead" text={t(section.data.text, ctx.lang)} />
      <Gallery images={section.data.images} lang={ctx.lang} />
    </SectionFrame>
  );
}
