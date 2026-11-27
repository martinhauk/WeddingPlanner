import { type FormEvent, useId, useRef, useState } from 'react';
import {
  type AdminRsvp,
  type AdminRsvpUpdate,
  DIETARY_TAGS,
  type DietaryTag,
  MAX_PEOPLE,
} from './api.ts';
import { de } from './strings.ts';

type PersonDraft = {
  /** Stable React key; also the person id for people that already exist. */
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly note: string;
};

export type RsvpEditorProps = {
  readonly rsvp: AdminRsvp;
  readonly saving: boolean;
  /**
   * The API refused the last save because new or changed dietary data came without the consent
   * attestation (`dietaryConsent`): the checkbox is shown with its error until it is ticked.
   */
  readonly consentError?: boolean;
  readonly onSave: (body: AdminRsvpUpdate) => void;
  readonly onCancel: () => void;
};

let nextKey = 0;

/** A note as the API compares it: NFC, whitespace runs collapsed, trimmed. */
const normalNote = (note: string) => note.normalize('NFC').replace(/\s+/gu, ' ').trim();

/**
 * Whether `body` adds or changes dietary data compared with the stored reply, by the API's rule
 * (`AdminDietaryConsent.AddsOrChanges`): a person (matched by id) gets a tag they did not have or a
 * new or different note, or a new person comes with any dietary data. Removing data never counts.
 */
export function addsOrChangesDietary(stored: AdminRsvp, body: AdminRsvpUpdate): boolean {
  return body.people.some((person) => {
    const previous =
      person.id === undefined ? undefined : stored.people.find((p) => p.id === person.id);
    const tagAdded = person.dietary.tags.some((tag) => !previous?.dietary.tags.includes(tag));
    const note = person.dietary.note;
    const noteChanged =
      note !== undefined && normalNote(note) !== normalNote(previous?.dietary.note ?? '');
    return tagAdded || noteChanged;
  });
}

/** Edits one reply: yes/no, people with dietary needs, and the message. */
export function RsvpEditor({
  rsvp,
  saving,
  consentError = false,
  onSave,
  onCancel,
}: RsvpEditorProps) {
  const formId = useId();
  const consentRef = useRef<HTMLInputElement>(null);
  const [attending, setAttending] = useState(rsvp.attending);
  const [people, setPeople] = useState<PersonDraft[]>(() =>
    rsvp.people.map((person) => ({
      key: person.id,
      id: person.id,
      name: person.name,
      tags: person.dietary.tags,
      note: person.dietary.note ?? '',
    })),
  );
  const [message, setMessage] = useState(rsvp.message ?? '');
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);

  const change = (key: string, update: Partial<PersonDraft>) =>
    setPeople((current) =>
      current.map((person) => (person.key === key ? { ...person, ...update } : person)),
    );

  const toggleTag = (person: PersonDraft, tag: DietaryTag, checked: boolean) =>
    change(person.key, {
      tags: checked ? [...person.tags, tag] : person.tags.filter((value) => value !== tag),
    });

  const trimmedMessage = message.trim();
  const body: AdminRsvpUpdate = {
    attending,
    people: people.map((person) => {
      const note = person.note.trim();
      return {
        ...(person.id === undefined ? {} : { id: person.id }),
        name: person.name.trim(),
        dietary: attending
          ? {
              tags: DIETARY_TAGS.filter((tag) => person.tags.includes(tag)),
              ...(note === '' ? {} : { note }),
            }
          : { tags: [] },
      };
    }),
    ...(trimmedMessage === '' ? {} : { message: trimmedMessage }),
    language: rsvp.language,
  };
  // The API decides; the checkbox also appears when it asked for the attestation.
  const askConsent = consentError || addsOrChangesDietary(rsvp, body);
  const showConsentError = askConsent && !consent && (consentError || consentMissing);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (askConsent && !consent) {
      setConsentMissing(true);
      consentRef.current?.focus();
      return;
    }
    onSave(askConsent ? { ...body, dietaryConsent: true } : body);
  };

  const hintId = `${formId}-consent-hint`;
  const errorId = `${formId}-consent-error`;

  return (
    <form className="admin-editor" aria-labelledby={`${formId}-title`} onSubmit={submit}>
      <h2 id={`${formId}-title`}>{de.editor.title}</h2>

      <fieldset>
        <legend>{de.editor.attending}</legend>
        <label>
          <input
            type="radio"
            name={`${formId}-attending`}
            checked={attending}
            onChange={() => setAttending(true)}
          />{' '}
          {de.editor.attendingYes}
        </label>
        <label>
          <input
            type="radio"
            name={`${formId}-attending`}
            checked={!attending}
            onChange={() => setAttending(false)}
          />{' '}
          {de.editor.attendingNo}
        </label>
      </fieldset>

      {people.map((person, index) => (
        <fieldset key={person.key} className="admin-person">
          <legend>{de.editor.person(index)}</legend>
          <label>
            {de.editor.name}
            <input
              type="text"
              required
              maxLength={80}
              value={person.name}
              onChange={(event) => change(person.key, { name: event.target.value })}
            />
          </label>
          {attending && (
            <>
              <div className="admin-tags">
                {DIETARY_TAGS.map((tag) => (
                  <label key={tag}>
                    <input
                      type="checkbox"
                      checked={person.tags.includes(tag)}
                      onChange={(event) => toggleTag(person, tag, event.target.checked)}
                    />{' '}
                    {de.dietary[tag]}
                  </label>
                ))}
              </div>
              <label>
                {de.editor.note}
                <input
                  type="text"
                  maxLength={200}
                  value={person.note}
                  onChange={(event) => change(person.key, { note: event.target.value })}
                />
              </label>
            </>
          )}
          {people.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() =>
                setPeople((current) => current.filter((value) => value.key !== person.key))
              }
            >
              {de.editor.removePerson}
            </button>
          )}
        </fieldset>
      ))}

      {people.length < MAX_PEOPLE && (
        <button
          type="button"
          className="link"
          onClick={() =>
            setPeople((current) => [
              ...current,
              { key: `new-${++nextKey}`, name: '', tags: [], note: '' },
            ])
          }
        >
          {de.editor.addPerson}
        </button>
      )}

      <label>
        {de.editor.message}
        <textarea
          rows={3}
          maxLength={1000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>

      {askConsent && (
        <div className={`admin-consent${showConsentError ? ' invalid' : ''}`}>
          <label>
            <input
              ref={consentRef}
              type="checkbox"
              // Checked in `submit` (not `required`), so the message is ours and in German.
              aria-required="true"
              checked={consent}
              aria-invalid={showConsentError}
              aria-describedby={showConsentError ? `${hintId} ${errorId}` : hintId}
              onChange={(event) => setConsent(event.target.checked)}
            />{' '}
            {de.editor.dietaryConsent}
          </label>
          <p id={hintId} className="admin-hint">
            {de.editor.dietaryConsentHint}
          </p>
          {showConsentError && (
            <p id={errorId} className="admin-field-error">
              {de.editor.dietaryConsentMissing}
            </p>
          )}
        </div>
      )}

      <div className="admin-editor-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? de.editor.saving : de.editor.save}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          {de.editor.cancel}
        </button>
      </div>
    </form>
  );
}
