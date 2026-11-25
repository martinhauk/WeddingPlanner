import { Gallery } from '../components/Gallery.tsx';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

/** Free text with an optional image, e.g. a "Let's Dance" section. */
export function TextSection({ section, ctx }: SectionProps<'text'>) {
  const { text, image } = section.data;
  return (
    <SectionFrame section={section} lang={ctx.lang}>
      <Paragraphs className="lead" text={t(text, ctx.lang)} />
      <Gallery images={image === undefined ? undefined : [image]} lang={ctx.lang} />
    </SectionFrame>
  );
}
