import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

export function Faq({ section, ctx }: SectionProps<'faq'>) {
  const { lang } = ctx;
  return (
    <SectionFrame section={section} lang={lang}>
      <div className="faq">
        {section.data.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order; questions may repeat
          <details key={index}>
            <summary>{t(item.q, lang)}</summary>
            <Paragraphs text={t(item.a, lang)} />
          </details>
        ))}
      </div>
    </SectionFrame>
  );
}
