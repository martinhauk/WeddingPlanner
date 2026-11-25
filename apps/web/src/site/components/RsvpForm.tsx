import type { FormEvent } from 'react';
import { type Lang, t } from '../i18n.ts';
import {
  DIETS,
  type Diet,
  emptyPerson,
  MAX_PEOPLE,
  type Reply,
  type ReplyPerson,
} from '../rsvp-reply.ts';
import { ui } from '../ui.ts';

const r = ui.rsvp;

export type RsvpFormProps = {
  readonly draft: Reply;
  readonly lang: Lang;
  readonly onChange: (draft: Reply) => void;
  readonly onCancel: () => void;
  readonly onSubmit: (event: FormEvent) => void;
};

/** Reply form: up to six people, dietary needs per attending guest, a message to the couple. */
export function RsvpForm({ draft, lang, onChange, onCancel, onSubmit }: RsvpFormProps) {
  const setPerson = (index: number, patch: Partial<ReplyPerson>) =>
    onChange({
      ...draft,
      people: draft.people.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });
  const toggleDiet = (index: number, diet: Diet, on: boolean) => {
    const current = draft.people[index]?.diet ?? [];
    setPerson(index, {
      diet: on ? [...current.filter((d) => d !== diet), diet] : current.filter((d) => d !== diet),
    });
  };

  return (
    <form onSubmit={onSubmit}>
      {!draft.attending && <p className="eyebrow">{t(r.who, lang)}</p>}
      {draft.people.map((person, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; removal re-keys them
        <fieldset key={index}>
          <legend>{index === 0 ? t(r.you, lang) : `${t(r.companion, lang)} ${index}`}</legend>
          <label>
            {t(r.name, lang)}
            <input
              required={index === 0}
              value={person.name}
              autoComplete={index === 0 ? 'name' : 'off'}
              onChange={(e) => setPerson(index, { name: e.target.value })}
            />
          </label>
          {draft.attending && (
            <fieldset className="diet">
              <legend>{t(r.diet, lang)}</legend>
              {DIETS.map((diet) => (
                <label key={diet} className="check">
                  <input
                    type="checkbox"
                    checked={person.diet.includes(diet)}
                    onChange={(e) => toggleDiet(index, diet, e.target.checked)}
                  />
                  {t(r[diet], lang)}
                </label>
              ))}
              <label>
                {t(r.dietNote, lang)}
                <input
                  value={person.dietNote}
                  onChange={(e) => setPerson(index, { dietNote: e.target.value })}
                />
              </label>
            </fieldset>
          )}
          {index > 0 && (
            <button
              type="button"
              className="link"
              onClick={() =>
                onChange({ ...draft, people: draft.people.filter((_, i) => i !== index) })
              }
            >
              {t(r.remove, lang)}
            </button>
          )}
        </fieldset>
      ))}
      {draft.people.length < MAX_PEOPLE && (
        <button
          type="button"
          className="link"
          onClick={() => onChange({ ...draft, people: [...draft.people, emptyPerson()] })}
        >
          {t(draft.attending ? r.addCompanion : r.addPerson, lang)}
        </button>
      )}
      <label>
        {t(r.message, lang)}
        <textarea
          rows={3}
          value={draft.message}
          onChange={(e) => onChange({ ...draft, message: e.target.value })}
        />
      </label>
      <div className="row">
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t(r.back, lang)}
        </button>
        <button type="submit" className="btn">
          {t(r.save, lang)}
        </button>
      </div>
    </form>
  );
}
