import { useEffect, useRef } from 'react';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';

const r = ui.rsvp;

/** "Anna, Ben and Pablo" in the page language (`Intl.ListFormat`, conjunction). */
export function joinNames(names: readonly string[], lang: Lang): string {
  return new Intl.ListFormat(lang, { type: 'conjunction', style: 'long' }).format(names);
}

export type RsvpWhoAreYouProps = {
  /** The names of the reply this page already holds. */
  readonly own: readonly string[];
  /** The names of the reply the opened link belongs to. */
  readonly link: readonly string[];
  readonly lang: Lang;
  readonly onOwn: () => void;
  readonly onLink: () => void;
};

/**
 * "Who are you? Are you Anna and Ben or Pablo Pérez?" with one big button per answer, shown when a
 * personal link opens another reply than the one this page holds. It speaks only of people: nothing
 * changes until a name is chosen.
 */
export function RsvpWhoAreYou({ own, link, lang, onOwn, onLink }: RsvpWhoAreYouProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const ownNames = joinNames(own, lang);
  const linkNames = joinNames(link, lang);
  const question = t(r.whoQuestion, lang)
    .replace('{own}', () => ownNames)
    .replace('{link}', () => linkNames);

  // The question replaces what the section showed: take the focus along.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="rsvp-who">
      <h3 tabIndex={-1} ref={heading}>
        {t(r.whoTitle, lang)}
      </h3>
      <p className="lead">{question}</p>
      <div className="row center">
        <button type="button" className="btn" onClick={onOwn}>
          {ownNames}
        </button>
        <button type="button" className="btn" onClick={onLink}>
          {linkNames}
        </button>
      </div>
    </div>
  );
}
