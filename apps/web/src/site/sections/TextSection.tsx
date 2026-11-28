import { Gallery } from '../components/Gallery.tsx';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

/** Free text with an optional image beside it (below it on phones), e.g. a section of city tips. */
export function TextSection({ section, ctx }: SectionProps<'text'>) {
  const { text, image } = section.data;
  if (image === undefined) {
    return (
      <SectionFrame section={section} lang={ctx.lang}>
        <Paragraphs className="lead" text={t(text, ctx.lang)} />
      </SectionFrame>
    );
  }
  return (
    <SectionFrame section={section} lang={ctx.lang}>
      <div className="split">
        <div className="split-text">
          <Paragraphs className="lead" text={t(text, ctx.lang)} />
        </div>
        <Gallery images={[image]} lang={ctx.lang} />
      </div>
    </SectionFrame>
  );
}
