import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { type FieldError, type RsvpLimits, SUBMISSION_REJECTED } from '../api/rsvp-client.ts';
import { fill } from '../fill.tsx';
import { type Lang, t } from '../i18n.ts';
import { PRIVACY_PATH } from '../privacy/route.ts';
import {
  DIETS,
  type Diet,
  emptyPerson,
  hasDietData,
  type Reply,
  type ReplyPerson,
} from '../rsvp-reply.ts';
import { type UiText, ui } from '../ui.ts';

const r = ui.rsvp;
const e = ui.rsvpError;

export type RsvpFormProps = {
  readonly draft: Reply;
  readonly lang: Lang;
  readonly limits: RsvpLimits;
  /** A request is running: the submit button is disabled. */
  readonly busy: boolean;
  /** Findings of the last attempt, from the browser or the API (`people[1].name`, `required`). */
  readonly fieldErrors: readonly FieldError[];
  /** A failure that is not about one field (offline, rate limited, …), shown above the buttons. */
  readonly alert?: ReactNode;
  readonly onChange: (draft: Reply) => void;
  readonly onCancel: () => void;
  /** Called with the honeypot's value. */
  readonly onSubmit: (website: string) => void;
};

/** Fields the form can point at; other findings only show the summary. */
const FIELD = /^people\[(\d+)\]\.(name|dietary\.note)$|^message$|^dietaryConsent$/;

/** Messages of the name findings (the API's name rules; `too_long` is shared with the other texts). */
const NAME_ERRORS: Readonly<Record<string, UiText>> = {
  required: e.nameRequired,
  too_short: e.nameTooShort,
  invalid: e.nameInvalid,
  duplicate: e.nameDuplicate,
};

function errorText(field: string, code: string): UiText {
  if (field === 'dietaryConsent') {
    return e.consentRequired;
  }
  if (code === 'too_long') {
    return e.tooLong;
  }
  return (field.endsWith('.name') ? NAME_ERRORS[code] : undefined) ?? e.validation;
}

/** The message above the buttons: a refused submission, a finding without a field, or "check the fields". */
function summaryText(fieldErrors: readonly FieldError[]): UiText {
  if (fieldErrors.some((error) => error.code === SUBMISSION_REJECTED)) {
    return e.rejected;
  }
  return fieldErrors.some((error) => !FIELD.test(error.field)) ? e.validation : e.checkFields;
}

/**
 * Reply form: up to six people, dietary needs per attending guest, a message to the couple. Once
 * dietary data is entered, an explicit consent checkbox appears (allergies can be health data); a
 * short note links to the privacy notice.
 */
export function RsvpForm(props: RsvpFormProps) {
  const { draft, lang, limits, busy, fieldErrors, alert, onChange, onCancel, onSubmit } = props;
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [focusRow, setFocusRow] = useState<number | null>(0);

  // Focus a name field after the form opens, a row is added or a row is removed.
  useEffect(() => {
    if (focusRow === null) {
      return;
    }
    form.current?.querySelector<HTMLInputElement>(`input[data-person="${focusRow}"]`)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  // After a failed attempt, focus the first field with a finding.
  useEffect(() => {
    if (fieldErrors.length > 0) {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [fieldErrors]);

  const errorOf = (field: string) => fieldErrors.find((error) => error.field === field)?.code;
  const fieldId = (field: string) => `${id}-${field.replace(/[^a-z0-9]/gi, '-')}`;

  /** `aria-invalid` and the message of one field. */
  const fieldState = (field: string) => {
    const code = errorOf(field);
    return code === undefined
      ? { invalid: {}, message: null }
      : {
          invalid: { 'aria-invalid': true, 'aria-describedby': fieldId(field) } as const,
          message: (
            <span className="field-error" id={fieldId(field)}>
              {t(errorText(field, code), lang)}
            </span>
          ),
        };
  };

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
  const legend = (index: number) =>
    index === 0
      ? t(r.you, lang)
      : draft.attending
        ? `${t(r.companion, lang)} ${index}`
        : `${t(r.person, lang)} ${index + 1}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const website = new FormData(event.currentTarget).get('website');
    onSubmit(typeof website === 'string' ? website : '');
  };

  const message = fieldState('message');
  const consent = fieldState('dietaryConsent');

  return (
    <form ref={form} onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset className="attendance">
        <legend>{t(r.attendance, lang)}</legend>
        <label className="check">
          <input
            type="radio"
            name={`${id}-attending`}
            checked={draft.attending}
            onChange={() => onChange({ ...draft, attending: true })}
          />
          {t(r.yes, lang)}
        </label>
        <label className="check">
          <input
            type="radio"
            name={`${id}-attending`}
            checked={!draft.attending}
            onChange={() => onChange({ ...draft, attending: false })}
          />
          {t(r.no, lang)}
        </label>
      </fieldset>
      {!draft.attending && <p className="eyebrow">{t(r.who, lang)}</p>}
      {draft.people.map((person, index) => {
        const name = fieldState(`people[${index}].name`);
        const note = fieldState(`people[${index}].dietary.note`);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; removal re-keys them
          <fieldset key={index}>
            <legend>{legend(index)}</legend>
            <label>
              {t(r.name, lang)}
              <input
                data-person={index}
                value={person.name}
                maxLength={limits.maxNameLength}
                autoComplete={index === 0 ? 'name' : 'off'}
                aria-required="true"
                {...name.invalid}
                onChange={(event) => setPerson(index, { name: event.target.value })}
              />
            </label>
            {name.message}
            {draft.attending && (
              <fieldset className="diet">
                <legend>{t(r.diet, lang)}</legend>
                {DIETS.map((diet) => (
                  <label key={diet} className="check">
                    <input
                      type="checkbox"
                      checked={person.diet.includes(diet)}
                      onChange={(event) => toggleDiet(index, diet, event.target.checked)}
                    />
                    {t(r[diet], lang)}
                  </label>
                ))}
                <label>
                  {t(r.dietNote, lang)}
                  <input
                    value={person.dietNote}
                    maxLength={limits.maxNoteLength}
                    {...note.invalid}
                    onChange={(event) => setPerson(index, { dietNote: event.target.value })}
                  />
                </label>
                {note.message}
              </fieldset>
            )}
            {index > 0 && (
              <button
                type="button"
                className="link"
                aria-label={`${t(r.remove, lang)}: ${legend(index)}`}
                onClick={() => {
                  onChange({ ...draft, people: draft.people.filter((_, i) => i !== index) });
                  setFocusRow(index - 1);
                }}
              >
                {t(r.remove, lang)}
              </button>
            )}
          </fieldset>
        );
      })}
      {draft.people.length < limits.maxPeople && (
        <button
          type="button"
          className="link"
          onClick={() => {
            onChange({ ...draft, people: [...draft.people, emptyPerson()] });
            setFocusRow(draft.people.length);
          }}
        >
          {t(draft.attending ? r.addCompanion : r.addPerson, lang)}
        </button>
      )}
      {hasDietData(draft) && (
        <>
          <label className="check consent">
            <input
              type="checkbox"
              checked={draft.dietConsent}
              aria-required="true"
              {...consent.invalid}
              onChange={(event) => onChange({ ...draft, dietConsent: event.target.checked })}
            />
            {t(r.dietConsent, lang)}
          </label>
          {consent.message}
        </>
      )}
      <label>
        {t(r.message, lang)}
        <textarea
          rows={3}
          value={draft.message}
          maxLength={limits.maxMessageLength}
          {...message.invalid}
          onChange={(event) => onChange({ ...draft, message: event.target.value })}
        />
      </label>
      {message.message}
      {/* Honeypot: invisible to people and assistive technology; bots that fill it are refused. */}
      <div className="hp" aria-hidden="true">
        <label>
          {t(ui.website, lang)}
          <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {fieldErrors.length > 0 && (
        <p className="rsvp-alert" role="alert">
          {t(summaryText(fieldErrors), lang)}
        </p>
      )}
      {alert}
      <p className="rsvp-privacy">
        {fill(t(r.privacyNote, lang), {
          link: <a href={PRIVACY_PATH}>{t(r.privacyLink, lang)}</a>,
        })}
      </p>
      <div className="row">
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t(r.back, lang)}
        </button>
        <button type="submit" className="btn" disabled={busy}>
          {t(busy ? r.saving : r.save, lang)}
        </button>
      </div>
    </form>
  );
}
