import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import { ui } from '../ui.ts';
import type { SectionProps } from './types.ts';

export function Music({ section, ctx }: SectionProps<'music'>) {
  const { lang } = ctx;
  const { text, link } = section.data;
  return (
    <SectionFrame section={section} lang={lang}>
      <Paragraphs className="lead" text={t(text, lang)} />
      {link !== undefined && (
        <p className="actions">
          <a className="btn" href={link.url} target="_blank" rel="noreferrer">
            {t(link.label, lang) || t(ui.musicLink, lang)}
          </a>
        </p>
      )}
    </SectionFrame>
  );
}
