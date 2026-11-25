import type { SiteContent } from '@weddingplanner/content';
import { useEffect, useState } from 'react';
import { Header } from './components/Header.tsx';
import { Hero } from './components/Hero.tsx';
import { formatDate } from './format.ts';
import { initialLang, type Lang, rememberLang, t } from './i18n.ts';
import { renderSection } from './sections/registry.tsx';
import { isShown, navItems } from './sections/titles.ts';
import type { SectionContext, SiteBuild } from './sections/types.ts';

export type SiteProps = {
  /** The instance's validated `site-content.json`. */
  readonly content: SiteContent;
  /** Feature flags and RSVP deadline from the baked `build.json`. */
  readonly build: SiteBuild;
  /** Starting language; by default the remembered or browser language. */
  readonly initialLanguage?: Lang;
};

/** The one-pager: header, hero, then the content's sections in order. */
export function Site({ content, build, initialLanguage }: SiteProps) {
  const [lang, setLang] = useState<Lang>(() => initialLanguage ?? initialLang());
  const couple = t(content.couple, lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    rememberLang(lang);
  }, [lang]);

  useEffect(() => {
    document.title = couple;
  }, [couple]);

  // The sections render after the browser has handled the URL fragment, so a deep link such as
  // /#rsvp is scrolled to once here. Section ids are [a-z0-9-], so the raw fragment is looked up
  // as is: decoding could throw on a malformed fragment (/#%) and unmount the page.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const target = id === '' ? null : document.getElementById(id);
    if (target !== null && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView();
    }
  }, []);

  const ctx: SectionContext = { lang, content, build };
  const rsvpId = content.sections.find(
    (section) => section.type === 'rsvp' && isShown(section, build.features),
  )?.id;

  return (
    <>
      <Header
        brand={couple}
        nav={navItems(content, build.features, lang)}
        rsvpId={rsvpId}
        lang={lang}
        onLangChange={setLang}
      />
      <main id="top">
        <Hero content={content} lang={lang} rsvpId={rsvpId} />
        {content.sections.map((section) => renderSection(section, ctx))}
      </main>
      <footer>
        {couple} · {formatDate(content.event.start, lang, content.event.timeZone, 'long')}
      </footer>
    </>
  );
}
