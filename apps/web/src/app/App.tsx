import { resolveText, type Site } from '@weddingplanner/content';
import { useEffect, useState } from 'react';
import { formatEventDate } from './format.ts';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { stringsFor } from './strings.ts';

export type AppProps = {
  readonly site: Site;
};

/**
 * Placeholder page of the walking skeleton: the couple's names and the date from the baked
 * content, with a language switch. S1-05 replaces it with the section registry.
 */
export function App({ site }: AppProps) {
  const { i18n, couple, event } = site;
  const [language, setLanguage] = useState(i18n.defaultLanguage);
  const strings = stringsFor(language);
  const names = resolveText(couple.displayName, language, i18n) || couple.names.join(' & ');
  const title = resolveText(event.title, language, i18n);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    document.title = names;
  }, [names]);

  return (
    <div className="page">
      <header className="page-header">
        <LanguageSwitch
          languages={i18n.languages}
          current={language}
          label={strings.languageSwitch}
          onChange={setLanguage}
        />
      </header>
      <main className="hero">
        {title !== '' && <p className="hero-eyebrow">{title}</p>}
        <h1 className="hero-names">{names}</h1>
        <p className="hero-date">
          <time dateTime={event.start}>
            {formatEventDate(event.start, language, event.timeZone)}
          </time>
        </p>
        <p className="hero-note">{strings.moreSoon}</p>
      </main>
    </div>
  );
}
