import type { AdminRsvp } from './api.ts';
import { de, dietaryLabel, formatDateTime } from './strings.ts';

export type RsvpTableProps = {
  readonly rsvps: readonly AdminRsvp[];
  readonly timeZone: string;
  readonly busy: boolean;
  readonly onEdit: (rsvp: AdminRsvp) => void;
  readonly onDelete: (rsvp: AdminRsvp) => void;
};

/** The names of a reply, for labels and the delete confirmation. */
export function replyNames(rsvp: AdminRsvp): string {
  return rsvp.people.map((person) => person.name).join(', ');
}

/**
 * One row per reply: people, yes/no, dietary needs per person, message, last change, actions. On
 * narrow screens each row becomes a card (see admin.css); `data-label` names the cell there.
 */
export function RsvpTable({ rsvps, timeZone, busy, onEdit, onDelete }: RsvpTableProps) {
  if (rsvps.length === 0) {
    return <p className="admin-empty">{de.empty}</p>;
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th scope="col">{de.columns.people}</th>
          <th scope="col">{de.columns.attending}</th>
          <th scope="col">{de.columns.dietary}</th>
          <th scope="col">{de.columns.message}</th>
          <th scope="col">{de.columns.updated}</th>
          <th scope="col">
            <span className="visually-hidden">{de.columns.actions}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rsvps.map((rsvp) => {
          const names = replyNames(rsvp);
          const dietary = rsvp.people.filter(
            (person) => person.dietary.tags.length > 0 || (person.dietary.note ?? '') !== '',
          );
          return (
            <tr key={rsvp.id} className={rsvp.attending ? 'yes' : 'no'}>
              <td data-label={de.columns.people}>
                <ul className="admin-people">
                  {rsvp.people.map((person) => (
                    <li key={person.id}>{person.name}</li>
                  ))}
                </ul>
              </td>
              <td data-label={de.columns.attending}>
                <span className={rsvp.attending ? 'admin-badge yes' : 'admin-badge no'}>
                  {rsvp.attending ? de.yes : de.no}
                </span>
              </td>
              <td data-label={de.columns.dietary}>
                {dietary.length === 0 ? (
                  de.none
                ) : (
                  <ul className="admin-dietary">
                    {dietary.map((person) => (
                      <li key={person.id}>
                        <span className="admin-dietary-name">{person.name}:</span>{' '}
                        {[...person.dietary.tags.map(dietaryLabel), person.dietary.note]
                          .filter((part) => part !== undefined && part !== '')
                          .join(', ')}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td data-label={de.columns.message} className="admin-message">
                {rsvp.message ?? de.none}
              </td>
              <td data-label={de.columns.updated}>
                <time dateTime={rsvp.updatedAt}>{formatDateTime(rsvp.updatedAt, timeZone)}</time>
              </td>
              <td className="admin-actions">
                <button
                  type="button"
                  aria-label={de.editAria(names)}
                  disabled={busy}
                  onClick={() => onEdit(rsvp)}
                >
                  {de.edit}
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={de.deleteAria(names)}
                  disabled={busy}
                  onClick={() => onDelete(rsvp)}
                >
                  {de.delete}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
