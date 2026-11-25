import { Paragraphs } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { telUrl, whatsappUrl } from '../format.ts';
import { t } from '../i18n.ts';
import { ui } from '../ui.ts';
import type { SectionProps } from './types.ts';

export function Contact({ section, ctx }: SectionProps<'contact'>) {
  const { lang } = ctx;
  return (
    <SectionFrame section={section} lang={lang}>
      {section.data.intro !== undefined && (
        <Paragraphs className="lead" text={t(section.data.intro, lang)} />
      )}
      <div className="cards">
        {section.data.people.map((person, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order; names may repeat
          <article className="card" key={index}>
            <h3>{person.name}</h3>
            <p className="contact-links">
              {person.phone !== undefined && (
                <a
                  className="btn small"
                  href={telUrl(person.phone)}
                  aria-label={`${t(ui.call, lang)}: ${person.name}`}
                >
                  {t(ui.call, lang)}
                </a>
              )}
              {person.whatsapp !== undefined && (
                <a
                  className="btn small ghost"
                  href={whatsappUrl(person.whatsapp)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${t(ui.whatsapp, lang)}: ${person.name}`}
                >
                  {t(ui.whatsapp, lang)}
                </a>
              )}
              {person.email !== undefined && (
                <a
                  className="btn small ghost"
                  href={`mailto:${person.email}`}
                  aria-label={`${t(ui.mail, lang)}: ${person.name}`}
                >
                  {t(ui.mail, lang)}
                </a>
              )}
            </p>
          </article>
        ))}
      </div>
    </SectionFrame>
  );
}
