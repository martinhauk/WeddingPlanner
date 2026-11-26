import { type FormEvent, useId, useState } from 'react';
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
  readonly onSave: (body: AdminRsvpUpdate) => void;
  readonly onCancel: () => void;
};

let nextKey = 0;

/** Edits one reply: yes/no, people with dietary needs, and the message. */
export function RsvpEditor({ rsvp, saving, onSave, onCancel }: RsvpEditorProps) {
  const formId = useId();
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

  const change = (key: string, update: Partial<PersonDraft>) =>
    setPeople((current) =>
      current.map((person) => (person.key === key ? { ...person, ...update } : person)),
    );

  const toggleTag = (person: PersonDraft, tag: DietaryTag, checked: boolean) =>
    change(person.key, {
      tags: checked ? [...person.tags, tag] : person.tags.filter((value) => value !== tag),
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    onSave({
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
    });
  };

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
