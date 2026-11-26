import { useEffect, useRef, useState } from 'react';
import { LANGS, type Lang, t } from '../i18n.ts';
import type { NavItem } from '../sections/titles.ts';
import { ui } from '../ui.ts';

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
  /** Id of the RSVP section, highlighted in the navigation. */
  readonly rsvpId: string | undefined;
  readonly lang: Lang;
  readonly onLangChange: (lang: Lang) => void;
};

/** Sticky header: names, section navigation (a menu on small screens) and the language switch. */
export function Header({
  brand,
  brandHref = '#top',
  nav,
  rsvpId,
  lang,
  onLangChange,
}: HeaderProps) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);

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
    <header className="nav" ref={header}>
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
      <nav id="site-nav" className={open ? 'open' : undefined} aria-label={t(ui.navigation, lang)}>
        {nav.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={item.id === rsvpId ? 'nav-rsvp' : undefined}
            onClick={() => setOpen(false)}
          >
            {item.label}
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
