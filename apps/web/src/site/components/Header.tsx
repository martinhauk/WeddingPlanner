import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGS, type Lang, t } from '../i18n.ts';
import type { NavItem } from '../sections/titles.ts';
import { ui } from '../ui.ts';
import { useRsvpState } from '../use-rsvp.ts';
import { useActiveSection, useNavFit, useScrolled } from '../use-scroll.ts';

const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
};

export type HeaderProps = {
  readonly brand: string;
  /** Where the names link to: the top of the page (default), or `/` from another page. */
  readonly brandHref?: string;
  readonly nav: readonly NavItem[];
  /**
   * Id of the RSVP section, highlighted in the navigation; only while RSVP is on. The entry then
   * shows "you said yes/no" when this browser has a reply (`wp_rsvp_state`, no API call).
   */
  readonly rsvpId: string | undefined;
  /** The RSVP deadline has passed: the own reply can only be viewed, not changed. */
  readonly rsvpClosed?: boolean;
  readonly lang: Lang;
  readonly onLangChange: (lang: Lang) => void;
  /** The hero has a photo: at the top of the page the header lies transparent on top of it. */
  readonly overHero?: boolean;
};

/**
 * Sticky header: names, section navigation and the language switch. The navigation is inline when
 * it fits and a menu otherwise; the entry of the section in view is marked as the current one.
 */
export function Header({
  brand,
  brandHref = '#top',
  nav,
  rsvpId,
  rsvpClosed = false,
  lang,
  onLangChange,
  overHero = false,
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const ids = useMemo(() => nav.map((item) => item.id), [nav]);
  const active = useActiveSection(ids);
  const scrolled = useScrolled();
  const cookieState = useRsvpState();
  const answered = rsvpId === undefined ? null : cookieState;
  // The answered entry has another label: measure again whether the navigation fits.
  const fit = useNavFit(header, navRef, `${lang} ${answered} ${ids.join(' ')}`);
  const inline = fit !== 'overflows';
  const transparent = overHero && !scrolled && !open;

  // A menu left open when the window grows wide enough for the inline navigation closes.
  useEffect(() => {
    if (fit === 'fits') {
      setOpen(false);
    }
  }, [fit]);

  // The open menu closes on Escape and on a tap or click outside the header.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (header.current !== null && !header.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <header
      className={['nav', inline ? 'inline' : 'collapsed', transparent ? 'over-hero' : '']
        .join(' ')
        .trim()}
      ref={header}
    >
      <a className="brand" href={brandHref}>
        {brand}
      </a>
      {nav.length > 0 && (
        <button
          type="button"
          className="burger"
          aria-expanded={open}
          aria-controls="site-nav"
          aria-label={t(ui.menu, lang)}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
          <span />
        </button>
      )}
      <nav
        id="site-nav"
        ref={navRef}
        className={open ? 'open' : undefined}
        aria-label={t(ui.navigation, lang)}
      >
        {nav.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={item.id === rsvpId ? 'nav-rsvp' : undefined}
            aria-current={item.id === active ? 'location' : undefined}
            onClick={() => setOpen(false)}
          >
            {item.id === rsvpId && answered !== null ? (
              <>
                {t(answered === 'yes' ? ui.navSaidYes : ui.navSaidNo, lang)}
                <span className="sr-only">
                  {`, ${t(rsvpClosed ? ui.rsvp.viewReply : ui.rsvp.change, lang)}`}
                </span>
              </>
            ) : (
              item.label
            )}
          </a>
        ))}
      </nav>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset */}
      <div className="langs" role="group" aria-label={t(ui.language, lang)}>
        {LANGS.map((code) => (
          <button
            type="button"
            key={code}
            lang={code}
            aria-pressed={code === lang}
            onClick={() => onLangChange(code)}
          >
            {/* The name starts with the visible code (WCAG 2.5.3 label in name): "DE Deutsch". */}
            {code.toUpperCase()} <span className="sr-only">{LANGUAGE_NAMES[code]}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
