import { Gallery } from '../components/Gallery.tsx';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

/** The introduction, the photos, then the story's parts, each under its own heading. */
export function Story({ section, ctx }: SectionProps<'story'>) {
  const { lang } = ctx;
  const { text, items = [], images } = section.data;
  return (
    <SectionFrame section={section} lang={lang}>
      <Paragraphs className="lead" text={t(text, lang)} />
      <Gallery images={images} lang={lang} />
      {items.length > 0 && (
        <div className="story-items">
          {items.map((item, index) => {
            const heading = t(item.heading, lang);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order
              <article className="story-item" key={index}>
                {heading !== '' && <h3>{heading}</h3>}
                <Paragraphs text={t(item.text, lang)} />
              </article>
            );
          })}
        </div>
      )}
    </SectionFrame>
  );
}
