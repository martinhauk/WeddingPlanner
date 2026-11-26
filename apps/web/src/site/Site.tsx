import type { SiteContent } from '@weddingplanner/content';
import { useEffect, useMemo, useState } from 'react';
import { useApiKeepWarm } from './api/keep-warm.ts';
import { Header } from './components/Header.tsx';
import { Hero, heroImages } from './components/Hero.tsx';
import { formatDate } from './format.ts';
import { initialLang, type Lang, rememberLang, t } from './i18n.ts';
import { PrivacyPage } from './privacy/PrivacyPage.tsx';
import { privacyText } from './privacy/privacy-text.ts';
import { IMPRINT_ID, isPrivacyPath, PRIVACY_PATH } from './privacy/route.ts';
import { renderSection } from './sections/registry.tsx';
import { isShown, navItems } from './sections/titles.ts';
import type { SectionContext, SiteBuild } from './sections/types.ts';
import { ui } from './ui.ts';

export type SiteProps = {
  /** The instance's validated `site-content.json`. */
  readonly content: SiteContent;
  /** Feature flags and RSVP deadline from the baked `build.json`. */
  readonly build: SiteBuild;
  /** Starting language; by default the remembered or browser language. */
  readonly initialLanguage?: Lang;
};

/**
 * The one-pager: header, hero, then the content's sections in order. At `/datenschutz` (alias
 * `/privacy`) it shows the privacy notice instead; every page links to it in the footer.
 */
export function Site({ content, build, initialLanguage }: SiteProps) {
  const [lang, setLang] = useState<Lang>(() => initialLanguage ?? initialLang());
  const [privacyPage] = useState(() => isPrivacyPath(window.location.pathname));
  const couple = t(content.couple, lang);
  const title = privacyPage ? `${t(privacyText.title, lang)} · ${couple}` : couple;

  useEffect(() => {
    document.documentElement.lang = lang;
    rememberLang(lang);
  }, [lang]);

  useEffect(() => {
    document.title = title;
  }, [title]);

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

  // Keeps the API warm for the RSVP form; without the feature (or on the privacy page, which has no
  // form) the page calls no API at all.
  useApiKeepWarm(build.features.rsvp && !privacyPage);

  const ctx: SectionContext = { lang, content, build };
  const nav = useMemo(() => navItems(content, lang), [content, lang]);
  // The hero button and the highlighted nav entry only while replies can be sent.
  const rsvpId = build.features.rsvp
    ? content.sections.find((section) => section.type === 'rsvp' && isShown(section))?.id
    : undefined;

  // The header spans the full width; the page itself is a column when the theme sets a frame.
  return (
    <>
      <Header
        brand={couple}
        brandHref={privacyPage ? '/' : '#top'}
        nav={privacyPage ? [] : nav}
        rsvpId={privacyPage ? undefined : rsvpId}
        lang={lang}
        onLangChange={setLang}
        overHero={!privacyPage && heroImages(content).length > 0}
      />
      <div className="site">
        <main id="top">
          {privacyPage ? (
            <PrivacyPage content={content} regions={build.regions} lang={lang} />
          ) : (
            <>
              <Hero content={content} lang={lang} rsvpId={rsvpId} />
              {content.sections.map((section) => renderSection(section, ctx))}
            </>
          )}
        </main>
        <footer>
          <p className="footer-names">{couple}</p>
          <p className="footer-date">
            {formatDate(content.event.start, lang, content.event.timeZone, 'long')}
          </p>
          <p className="footer-links">
            <a href={PRIVACY_PATH}>{t(ui.privacy, lang)}</a>
            {content.privacy?.imprint !== undefined && (
              <>
                {' · '}
                <a href={`${PRIVACY_PATH}#${IMPRINT_ID}`}>{t(privacyText.imprintTitle, lang)}</a>
              </>
            )}
          </p>
        </footer>
      </div>
    </>
  );
}
