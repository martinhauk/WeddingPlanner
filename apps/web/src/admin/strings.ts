import type { DietaryTag } from './api.ts';

/** German UI strings of the admin area (admins only; no other languages needed). */
export const de = {
  title: 'Antworten',
  subtitle: 'Admin-Bereich',
  logout: 'Abmelden',
  login: 'Anmelden',
  loading: 'Antworten werden geladen …',
  reload: 'Neu laden',
  downloadCsv: 'CSV herunterladen',
  empty: 'Noch keine Antworten.',
  unauthorizedTitle: 'Bitte anmelden',
  unauthorized: 'Deine Sitzung ist abgelaufen oder du bist nicht angemeldet.',
  forbiddenTitle: 'Kein Zugriff',
  forbidden:
    'Dieses Konto hat keine Admin-Rechte. Melde dich mit dem Microsoft-Konto an, das eingeladen wurde.',
  disabledTitle: 'Admin-Bereich ausgeschaltet',
  disabled: 'Der Admin-Bereich ist in dieser Umgebung nicht eingeschaltet.',
  unavailableTitle: 'Gerade nicht erreichbar',
  unavailable: 'Die Antworten konnten nicht geladen werden. Bitte versuche es gleich noch einmal.',
  totals: {
    replies: 'Antworten',
    yes: 'Zusagen',
    no: 'Absagen',
    attendingPeople: 'Personen kommen',
    declinedPeople: 'Personen sagen ab',
    dietaryNotes: 'Hinweise zum Essen',
    messages: 'Nachrichten',
  },
  columns: {
    people: 'Personen',
    attending: 'Zusage',
    dietary: 'Essen',
    message: 'Nachricht',
    updated: 'Geändert',
    actions: 'Aktionen',
  },
  yes: 'Ja',
  no: 'Nein',
  none: '–',
  edit: 'Bearbeiten',
  delete: 'Löschen',
  editAria: (names: string) => `Antwort von ${names} bearbeiten`,
  deleteAria: (names: string) => `Antwort von ${names} löschen`,
  confirmDelete: (names: string) =>
    `Antwort von ${names} wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
  deleted: 'Antwort gelöscht.',
  saved: 'Antwort gespeichert.',
  conflict:
    'Die Antwort wurde inzwischen geändert. Die Liste ist neu geladen, bitte erneut versuchen.',
  gone: 'Die Antwort gibt es nicht mehr. Die Liste ist neu geladen.',
  invalid: 'Bitte die Eingaben prüfen: Jede Person braucht einen Namen.',
  actionFailed: 'Das hat nicht geklappt. Bitte versuche es gleich noch einmal.',
  editor: {
    title: 'Antwort bearbeiten',
    attending: 'Zusage',
    attendingYes: 'Ja, kommt',
    attendingNo: 'Nein, kommt nicht',
    person: (index: number) => (index === 0 ? 'Person 1 (Gast)' : `Person ${index + 1}`),
    name: 'Name',
    note: 'Hinweis zum Essen',
    removePerson: 'Person entfernen',
    addPerson: 'Person hinzufügen',
    message: 'Nachricht an das Paar',
    save: 'Speichern',
    saving: 'Speichert …',
    cancel: 'Abbrechen',
  },
  dietary: {
    vegetarian: 'Vegetarisch',
    vegan: 'Vegan',
    glutenFree: 'Glutenfrei',
    lactoseFree: 'Laktosefrei',
  } satisfies Record<DietaryTag, string>,
} as const;

/** The German label of a dietary tag (an unknown tag shows as is). */
export function dietaryLabel(tag: string): string {
  return Object.hasOwn(de.dietary, tag) ? de.dietary[tag as DietaryTag] : tag;
}

/** An instant as German date and time in `timeZone` (the wedding's, not the browser's). */
export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}
