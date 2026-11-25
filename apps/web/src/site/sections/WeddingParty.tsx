import { useRef, useState } from 'react';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { type PartyMember, PersonDialog } from '../components/PersonDialog.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { mediaUrl } from '../format.ts';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

/** A grid of people; a click opens a dialog with their role and text. */
export function WeddingParty({ section, ctx }: SectionProps<'weddingParty'>) {
  const { lang } = ctx;
  const [selected, setSelected] = useState<PartyMember | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const open = (person: PartyMember, button: HTMLButtonElement) => {
    trigger.current = button;
    setSelected(person);
  };
  const closed = () => {
    setSelected(null);
    trigger.current?.focus();
  };

  return (
    <SectionFrame section={section} lang={lang}>
      {section.data.intro !== undefined && (
        <Paragraphs className="lead" text={t(section.data.intro, lang)} />
      )}
      <ul className="party">
        {section.data.people.map((person, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order; names may repeat
          <li key={index}>
            <button
              type="button"
              className="party-person"
              aria-haspopup="dialog"
              onClick={(event) => open(person, event.currentTarget)}
            >
              {person.photo !== undefined ? (
                <img src={mediaUrl(person.photo)} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="party-initial" aria-hidden="true">
                  {person.name.charAt(0)}
                </span>
              )}
              <span className="party-name">{person.name}</span>
              <span className="party-role">{t(person.role, lang)}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected !== null && <PersonDialog person={selected} lang={lang} onClose={closed} />}
    </SectionFrame>
  );
}
