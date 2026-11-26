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

/** How long a deep link keeps re-jumping to its section while late images and fonts load. */
const DEEP_LINK_SETTLE_MS = 5000;

/** Upper bound for the repeated deep-link jumps, so the page never fights the browser for long. */
const DEEP_LINK_MAX_JUMPS = 10;

/** Any of these means the visitor scrolls on their own: stop re-jumping to the deep link. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

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
  // /#rsvp is scrolled to here. Section ids are [a-z0-9-], so the raw fragment is looked up as is:
  // decoding could throw on a malformed fragment (/#%) and unmount the page.
  // The first jump is not the last word: images and fonts above the target still take their space
  // (the page grows), and Chromium may apply its own late fragment scroll with a wrong offset (on a
  // 360 px phone /#rsvp ended three sections short). Until the visitor scrolls, taps or types, or
  // DEEP_LINK_SETTLE_MS pass, the jump is repeated when the page resizes and when a scroll the
  // visitor did not cause moves the target (at most DEEP_LINK_MAX_JUMPS times).
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const target = id === '' ? null : document.getElementById(id);
    if (target === null || typeof target.scrollIntoView !== 'function') {
      return;
    }
    let jumps = 0;
    let landedTop = 0;
    const jump = () => {
      if (jumps >= DEEP_LINK_MAX_JUMPS) {
        return;
      }
      jumps += 1;
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      landedTop = target.getBoundingClientRect().top;
    };
    const moved = () => {
      if (Math.abs(target.getBoundingClientRect().top - landedTop) > 1) {
        jump();
      }
    };
    jump();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(jump) : undefined;
    resize?.observe(document.body);
    const stop = () => {
      resize?.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener('scroll', moved);
      for (const type of USER_SCROLL_EVENTS) {
        window.removeEventListener(type, stop);
      }
    };
    const timer = window.setTimeout(stop, DEEP_LINK_SETTLE_MS);
    window.addEventListener('scroll', moved, { passive: true });
    for (const type of USER_SCROLL_EVENTS) {
      window.addEventListener(type, stop, { passive: true });
    }
    return stop;
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
