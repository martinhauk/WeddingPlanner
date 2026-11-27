import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';
import {
  type AdminApi,
  type AdminList,
  type AdminResult,
  type AdminRsvp,
  EXPORT_CSV_URL,
  LOGIN_URL,
  LOGOUT_URL,
} from './api.ts';

// Fictional sample guests only (Anna & Ben's wedding).
const pablo: AdminRsvp = {
  id: 'a1',
  attending: true,
  people: [
    {
      id: 'p1',
      name: 'Pablo Pérez',
      dietary: { tags: ['vegetarian', 'glutenFree'], note: 'Sin nueces' },
    },
    { id: 'p2', name: 'María-José García', dietary: { tags: [] } },
  ],
  message: '¡Felicidades, Anna y Ben!',
  language: 'es',
  createdAt: '2099-04-01T10:00:00Z',
  updatedAt: '2099-04-02T16:30:00Z',
  version: '"v1"',
};

const juergen: AdminRsvp = {
  id: 'b2',
  attending: false,
  people: [{ id: 'p3', name: 'Jürgen Müller', dietary: { tags: [] } }],
  language: 'de',
  createdAt: '2099-04-01T09:00:00Z',
  updatedAt: '2099-04-01T09:00:00Z',
  version: '"v2"',
};

const list: AdminList = {
  rsvps: [pablo, juergen],
  totals: {
    replies: 2,
    yes: 1,
    no: 1,
    attendingPeople: 2,
    declinedPeople: 1,
    dietary: { vegetarian: 1, vegan: 0, glutenFree: 1, lactoseFree: 0 },
    dietaryNotes: 1,
    messages: 1,
  },
};

const CONSENT =
  'Der Gast hat ausdrücklich eingewilligt, dass wir diese Angaben zum Essen speichern.';

const ok = <T,>(data: T): AdminResult<T> => ({ ok: true, data });
const fail = (
  kind: 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable',
  status: number,
) => ({ ok: false, kind, status }) as const;

function fakeApi(overrides: Partial<AdminApi> = {}) {
  return {
    list: vi.fn<AdminApi['list']>(overrides.list ?? (() => Promise.resolve(ok(list)))),
    update: vi.fn<AdminApi['update']>(overrides.update ?? (() => Promise.resolve(ok(pablo)))),
    remove: vi.fn<AdminApi['remove']>(overrides.remove ?? (() => Promise.resolve(ok(null)))),
  };
}

function renderApp(api: AdminApi, confirm: (message: string) => boolean = () => true) {
  render(<AdminApp api={api} timeZone="Europe/Berlin" confirm={confirm} />);
}

async function rowOf(name: string) {
  const cell = await screen.findByText(name, { selector: '.admin-people li' });
  const row = cell.closest('tr');
  if (row === null) {
    throw new Error(`no row for ${name}`);
  }
  return within(row);
}

describe('AdminApp', () => {
  it('shows the totals and one row per reply', async () => {
    renderApp(fakeApi());

    const totals = await screen.findByRole('list', { name: 'Summen' });
    expect(within(totals).getByText('Personen kommen').previousSibling).toHaveTextContent('2');
    expect(within(totals).getByText('Vegetarisch').previousSibling).toHaveTextContent('1');
    expect(within(totals).getByText('Laktosefrei').previousSibling).toHaveTextContent('0');

    expect(screen.getAllByRole('row')).toHaveLength(3); // header + two replies
    const first = await rowOf('Pablo Pérez');
    expect(first.getByText('María-José García')).toBeInTheDocument();
    expect(first.getByText('Ja')).toBeInTheDocument();
    expect(first.getByText(/Vegetarisch, Glutenfrei, Sin nueces/)).toBeInTheDocument();
    expect(first.getByText('¡Felicidades, Anna y Ben!')).toBeInTheDocument();
    // 16:30 UTC is 18:30 in Berlin (summer time).
    expect(first.getByText(/02\.04\.2099, 18:30/)).toBeInTheDocument();

    const second = await rowOf('Jürgen Müller');
    expect(second.getByText('Nein')).toBeInTheDocument();
  });

  it('offers the CSV download and a logout link', async () => {
    renderApp(fakeApi());

    const download = await screen.findByRole('link', { name: 'CSV herunterladen' });
    expect(download).toHaveAttribute('href', EXPORT_CSV_URL);
    expect(download).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Abmelden' })).toHaveAttribute('href', LOGOUT_URL);
  });

  it('asks a signed-out visitor to log in (401)', async () => {
    renderApp(fakeApi({ list: () => Promise.resolve(fail('unauthorized', 401)) }));

    expect(await screen.findByRole('heading', { name: 'Bitte anmelden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anmelden' })).toHaveAttribute('href', LOGIN_URL);
    expect(screen.queryByRole('link', { name: 'CSV herunterladen' })).not.toBeInTheDocument();
  });

  it('explains a missing admin role (403) and offers to switch accounts', async () => {
    renderApp(fakeApi({ list: () => Promise.resolve(fail('forbidden', 403)) }));

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByRole('heading', { name: 'Kein Zugriff' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Abmelden' })).toHaveAttribute(
      'href',
      LOGOUT_URL,
    );
  });

  it('says when the admin feature is switched off (404)', async () => {
    renderApp(fakeApi({ list: () => Promise.resolve(fail('not_found', 404)) }));

    expect(
      await screen.findByRole('heading', { name: 'Admin-Bereich ausgeschaltet' }),
    ).toBeInTheDocument();
  });

  it('lets the admin retry after a failure', async () => {
    const api = fakeApi();
    api.list.mockResolvedValueOnce(fail('unavailable', 500));
    renderApp(api);

    await userEvent.click(await screen.findByRole('button', { name: 'Neu laden' }));

    expect(await screen.findByRole('list', { name: 'Summen' })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('deletes a reply only after confirmation, then reloads', async () => {
    const api = fakeApi();
    const confirm = vi.fn(() => false);
    renderApp(api, confirm);
    const button = await screen.findByRole('button', { name: 'Antwort von Jürgen Müller löschen' });

    await userEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Jürgen Müller'));
    expect(api.remove).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await userEvent.click(button);

    expect(api.remove).toHaveBeenCalledWith('b2', '"v2"');
    expect(await screen.findByText('Antwort gelöscht.')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('edits a reply and sends the whole reply with its version', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );

    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    const second = within(editor).getByRole('group', { name: 'Person 2' });
    await userEvent.clear(within(second).getByLabelText('Name'));
    await userEvent.type(within(second).getByLabelText('Name'), 'Jürgen Müller');
    await userEvent.click(within(second).getByLabelText('Vegan'));
    await userEvent.click(within(editor).getByRole('checkbox', { name: CONSENT }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    expect(api.update).toHaveBeenCalledWith('a1', '"v1"', {
      attending: true,
      people: [
        {
          id: 'p1',
          name: 'Pablo Pérez',
          dietary: { tags: ['vegetarian', 'glutenFree'], note: 'Sin nueces' },
        },
        { id: 'p2', name: 'Jürgen Müller', dietary: { tags: ['vegan'] } },
      ],
      message: '¡Felicidades, Anna y Ben!',
      language: 'es',
      dietaryConsent: true,
    });
    expect(await screen.findByText('Antwort gespeichert.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Antwort bearbeiten' })).not.toBeInTheDocument();
  });

  it('drops dietary data when a reply becomes a no, and can add and remove people', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });

    await userEvent.click(within(editor).getByLabelText('Nein, kommt nicht'));
    expect(within(editor).queryByLabelText('Vegan')).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole('button', { name: 'Person hinzufügen' }));
    await userEvent.type(
      within(within(editor).getByRole('group', { name: 'Person 3' })).getByLabelText('Name'),
      'Anna',
    );
    const first = within(editor).getByRole('group', { name: 'Person 1 (Gast)' });
    await userEvent.click(within(first).getByRole('button', { name: 'Person entfernen' }));
    await userEvent.clear(within(editor).getByLabelText('Nachricht an das Paar'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    expect(api.update).toHaveBeenCalledWith('a1', '"v1"', {
      attending: false,
      people: [
        { id: 'p2', name: 'María-José García', dietary: { tags: [] } },
        { name: 'Anna', dietary: { tags: [] } },
      ],
      language: 'es',
    });
  });

  it('asks the admin to confirm the guest consented before saving new dietary data', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Antwort von Jürgen Müller bearbeiten' }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    await userEvent.click(within(editor).getByLabelText('Ja, kommt'));
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();

    await userEvent.type(within(editor).getByLabelText('Hinweis zum Essen'), 'Keine Nüsse');
    const consent = within(editor).getByRole('checkbox', { name: CONSENT });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveAccessibleDescription(/Nachweis aufbewahren/);

    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).not.toHaveBeenCalled();
    expect(consent).toHaveFocus();
    expect(consent).toHaveAttribute('aria-invalid', 'true');
    expect(consent).toHaveAccessibleDescription(/Bitte bestätigen, dass der Gast eingewilligt hat/);

    await userEvent.click(consent);
    expect(consent).toHaveAttribute('aria-invalid', 'false');
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).toHaveBeenCalledWith('b2', '"v2"', {
      attending: true,
      people: [{ id: 'p3', name: 'Jürgen Müller', dietary: { tags: [], note: 'Keine Nüsse' } }],
      language: 'de',
      dietaryConsent: true,
    });
  });

  it('needs no confirmation when dietary data stays the same or is only removed', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    const first = within(editor).getByRole('group', { name: 'Person 1 (Gast)' });
    const second = within(editor).getByRole('group', { name: 'Person 2' });

    await userEvent.click(within(first).getByLabelText('Glutenfrei'));
    await userEvent.clear(within(first).getByLabelText('Hinweis zum Essen'));
    // Ticking and unticking a tag again is no change either.
    await userEvent.click(within(first).getByLabelText('Vegan'));
    await userEvent.click(within(first).getByLabelText('Vegan'));
    // Renaming a person without dietary data is no dietary change.
    await userEvent.type(within(second).getByLabelText('Name'), ' Pérez');
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    expect(api.update).toHaveBeenCalledWith('a1', '"v1"', {
      attending: true,
      people: [
        { id: 'p1', name: 'Pablo Pérez', dietary: { tags: ['vegetarian'] } },
        { id: 'p2', name: 'María-José García Pérez', dietary: { tags: [] } },
      ],
      message: '¡Felicidades, Anna y Ben!',
      language: 'es',
    });
  });

  it('asks for the confirmation when a person who keeps dietary data is renamed', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    const first = within(editor).getByRole('group', { name: 'Person 1 (Gast)' });

    // The slot now names someone else, who would take over Pablo's dietary data.
    await userEvent.clear(within(first).getByLabelText('Name'));
    await userEvent.type(within(first).getByLabelText('Name'), 'Jürgen Müller');
    expect(within(editor).getByRole('checkbox', { name: CONSENT })).not.toBeChecked();

    // Without any dietary data left, the rename moves nothing to anyone.
    await userEvent.click(within(first).getByLabelText('Vegetarisch'));
    await userEvent.click(within(first).getByLabelText('Glutenfrei'));
    await userEvent.clear(within(first).getByLabelText('Hinweis zum Essen'));
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).toHaveBeenCalledWith(
      'a1',
      '"v1"',
      expect.not.objectContaining({ dietaryConsent: true }),
    );
  });

  it('unticks the confirmation when it hides, so it never comes back ticked', async () => {
    const api = fakeApi();
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Antwort von Jürgen Müller bearbeiten' }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    await userEvent.click(within(editor).getByLabelText('Ja, kommt'));

    await userEvent.click(within(editor).getByLabelText('Vegan'));
    await userEvent.click(within(editor).getByRole('checkbox', { name: CONSENT }));
    expect(within(editor).getByRole('checkbox', { name: CONSENT })).toBeChecked();
    await userEvent.click(within(editor).getByLabelText('Vegan'));
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();

    await userEvent.type(within(editor).getByLabelText('Hinweis zum Essen'), 'Keine Nüsse');
    const consent = within(editor).getByRole('checkbox', { name: CONSENT });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveAttribute('aria-invalid', 'false');
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).not.toHaveBeenCalled();
  });

  it('shows the API’s request for the confirmation at the checkbox and resends with it', async () => {
    const api = fakeApi();
    api.update.mockResolvedValueOnce({
      ok: false,
      kind: 'invalid',
      status: 400,
      fields: ['dietaryConsent'],
    });
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Neue oder geänderte Angaben zum Essen speichern wir nur mit der ausdrücklichen Einwilligung des Gastes.',
    );
    const consent = within(editor).getByRole('checkbox', { name: CONSENT });
    expect(consent).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(consent);
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).toHaveBeenLastCalledWith(
      'a1',
      '"v1"',
      expect.objectContaining({ dietaryConsent: true }),
    );
    expect(await screen.findByText('Antwort gespeichert.')).toBeInTheDocument();
  });

  it('drops the API’s request once the answer or the people change', async () => {
    const api = fakeApi();
    api.update.mockResolvedValueOnce({
      ok: false,
      kind: 'invalid',
      status: 400,
      fields: ['dietaryConsent'],
    });
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    const first = within(editor).getByRole('group', { name: 'Person 1 (Gast)' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // The message is not part of the rule: the request stays.
    await userEvent.type(within(editor).getByLabelText('Nachricht an das Paar'), '!');
    expect(within(editor).getByRole('checkbox', { name: CONSENT })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // Removing dietary data, as the error suggests, leaves the decision to the rule again.
    await userEvent.clear(within(first).getByLabelText('Hinweis zum Essen'));
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(api.update).toHaveBeenLastCalledWith('a1', '"v1"', {
      attending: true,
      people: [
        { id: 'p1', name: 'Pablo Pérez', dietary: { tags: ['vegetarian', 'glutenFree'] } },
        { id: 'p2', name: 'María-José García', dietary: { tags: [] } },
      ],
      message: '¡Felicidades, Anna y Ben!!',
      language: 'es',
    });
    expect(await screen.findByText('Antwort gespeichert.')).toBeInTheDocument();
  });

  it('does not flash the API’s request while saving the reply without the refused data', async () => {
    let answer: (result: AdminResult<AdminRsvp>) => void = () => {};
    const api = fakeApi();
    api.update
      .mockResolvedValueOnce({
        ok: false,
        kind: 'invalid',
        status: 400,
        fields: ['dietaryConsent'],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    const first = within(editor).getByRole('group', { name: 'Person 1 (Gast)' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    expect(within(editor).getByRole('checkbox', { name: CONSENT })).toBeInTheDocument();

    // The admin removes the data the API refused and saves again.
    await userEvent.clear(within(first).getByLabelText('Hinweis zum Essen'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    // While that save is in flight, the old request is about other data: no checkbox, no error.
    expect(within(editor).getByRole('button', { name: 'Speichert …' })).toBeDisabled();
    expect(within(editor).queryByRole('checkbox', { name: CONSENT })).not.toBeInTheDocument();
    expect(within(editor).queryByText(/Bitte bestätigen/)).not.toBeInTheDocument();
    expect(api.update).toHaveBeenLastCalledWith(
      'a1',
      '"v1"',
      expect.not.objectContaining({ dietaryConsent: true }),
    );

    answer(ok(pablo));
    expect(await screen.findByText('Antwort gespeichert.')).toBeInTheDocument();
  });

  it('keeps the ticked confirmation visible while the attested save is in flight', async () => {
    let answer: (result: AdminResult<AdminRsvp>) => void = () => {};
    const api = fakeApi();
    api.update
      .mockResolvedValueOnce({
        ok: false,
        kind: 'invalid',
        status: 400,
        fields: ['dietaryConsent'],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Antwort von Pablo Pérez, María-José García bearbeiten',
      }),
    );
    const editor = screen.getByRole('form', { name: 'Antwort bearbeiten' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));
    await userEvent.click(within(editor).getByRole('checkbox', { name: CONSENT }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Speichern' }));

    const consent = within(editor).getByRole('checkbox', { name: CONSENT });
    expect(consent).toBeChecked();
    expect(consent).toHaveAttribute('aria-invalid', 'false');
    expect(api.update).toHaveBeenLastCalledWith(
      'a1',
      '"v1"',
      expect.objectContaining({ dietaryConsent: true }),
    );

    answer(ok(pablo));
    expect(await screen.findByText('Antwort gespeichert.')).toBeInTheDocument();
  });

  it('reloads and explains when the reply changed in the meantime (412)', async () => {
    const api = fakeApi({ update: vi.fn(() => Promise.resolve(fail('conflict', 412))) });
    renderApp(api);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Antwort von Jürgen Müller bearbeiten' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('inzwischen geändert');
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('form', { name: 'Antwort bearbeiten' })).not.toBeInTheDocument();
  });

  it('switches to the login panel when the session expires during an action', async () => {
    const api = fakeApi({ remove: vi.fn(() => Promise.resolve(fail('unauthorized', 0))) });
    renderApp(api);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Antwort von Jürgen Müller löschen' }),
    );

    expect(await screen.findByRole('heading', { name: 'Bitte anmelden' })).toBeInTheDocument();
  });
});
