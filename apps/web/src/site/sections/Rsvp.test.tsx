import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RsvpRequest, RsvpView } from '../api/rsvp-client.ts';
import type { Lang } from '../i18n.ts';
import {
  json,
  mineBody,
  mockApi,
  mockIntersectionObserver,
  offline,
  openStatus,
  problem,
  type RecordedCall,
  setStateCookie,
  yesReply,
} from '../test/fake-api.ts';
import { build, content, sections } from '../test/fixture.ts';
import { Rsvp } from './Rsvp.tsx';
import type { SiteBuild } from './types.ts';

const STATUS = 'GET /api/rsvp/status';
const CREATE = 'POST /api/rsvp';
const MINE = 'GET /api/rsvp/me';
const UPDATE = 'PUT /api/rsvp/me';
const DELETE = 'DELETE /api/rsvp/me';

let io: ReturnType<typeof mockIntersectionObserver>;

beforeEach(() => {
  io = mockIntersectionObserver();
  setStateCookie(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setStateCookie(null);
});

const renderRsvp = (options: { lang?: Lang; build?: SiteBuild; withDate?: boolean } = {}) => {
  const { rsvpDeadline: _, ...withoutDate } = content;
  return render(
    <Rsvp
      section={sections.rsvp}
      ctx={{
        lang: options.lang ?? 'de',
        content: options.withDate === false ? withoutDate : content,
        build: options.build ?? build,
      }}
    />,
  );
};

/** The reply the fake API stores for a request body. */
function stored(call: RecordedCall): RsvpView {
  const body = call.body as RsvpRequest;
  return {
    id: '1b86eb8e593b91c86f2d8d37d4fd593a',
    attending: body.attending,
    people: body.people.map((person, index) => ({
      id: person.id ?? `0000000${index}`,
      name: person.name,
      dietary: person.dietary ?? { tags: [] },
    })),
    ...(body.message === undefined ? {} : { message: body.message }),
    language: body.language,
  };
}

const created = (call: RecordedCall) =>
  json(201, { rsvp: stored(call), version: '"v1"' }, { ETag: '"v1"' });

const pastDeadline: SiteBuild = { ...build, rsvpDeadline: '2000-01-01T00:00:00.000Z' };

const contactLink = () => screen.getByRole('link', { name: 'Kontakt' });

/** A returning guest whose reply loads once the section is in view. */
async function showStoredReply(mine = mineBody(yesReply)) {
  setStateCookie(mine.rsvp.attending ? 'yes' : 'no');
  renderRsvp();
  io.reveal();
  return screen.findByText('Danke! Wir freuen uns auf euch.');
}

describe('Rsvp', () => {
  it('shows the intro and the display deadline', () => {
    mockApi({});
    renderRsvp();
    expect(screen.getByText('Wir freuen uns auf eure Antwort.')).toBeInTheDocument();
    expect(screen.getByText('Bitte antwortet bis 1. Mai 2099')).toBeInTheDocument();
  });

  it('falls back to the enforced deadline without a display date', () => {
    mockApi({});
    renderRsvp({ lang: 'en', withDate: false });
    expect(screen.getByText('Please reply by May 1, 2099')).toBeInTheDocument();
  });

  it('shows an "opens soon" note and calls no API while the feature is off', () => {
    const api = mockApi({});
    renderRsvp({ build: { ...build, features: { rsvp: false, admin: false } } });
    io.reveal();
    expect(
      screen.getByText('Die Anmeldung öffnet bald – schaut gern wieder vorbei.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(api.calls).toEqual([]);
    expect(io.observed()).toBe(0);
  });

  it('calls no API until the section comes into view, then only asks for the status', async () => {
    const api = mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    expect(api.calls).toEqual([]);

    io.reveal();
    await waitFor(() => expect(api.callsTo(STATUS)).toHaveLength(1));
    expect(api.calls).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ja, wir kommen' })).toBeInTheDocument();
  });

  it('sends a yes with companions and dietary needs per person, then shows a summary', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));

    const you = screen.getByRole('group', { name: 'Du' });
    const name = within(you).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();
    await user.type(name, 'Jürgen Müller');
    await user.click(within(you).getByRole('checkbox', { name: 'Vegetarisch' }));
    await user.click(within(you).getByRole('checkbox', { name: 'Laktosefrei' }));

    await user.click(screen.getByRole('button', { name: '+ Begleitung hinzufügen' }));
    const companion = screen.getByRole('group', { name: 'Begleitung 1' });
    expect(within(companion).getByRole('textbox', { name: 'Name' })).toHaveFocus();
    await user.type(within(companion).getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.type(
      within(companion).getByRole('textbox', { name: 'Allergien oder Hinweise (optional)' }),
      'Nüsse',
    );
    await user.type(screen.getByRole('textbox', { name: 'Nachricht an uns (optional)' }), 'Hurra!');

    // Dietary data needs the explicit consent (health data): without it nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));
    const consent = screen.getByRole('checkbox', { name: /^Ich bin einverstanden/ });
    expect(consent).toHaveFocus();
    expect(consent).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Bitte willigt ein oder entfernt die Angaben zur Ernährung.'),
    ).toBeInTheDocument();
    expect(api.callsTo(CREATE)).toHaveLength(0);
    await user.click(consent);
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toHaveFocus();
    const [post] = api.callsTo(CREATE);
    expect(post?.headers['content-type']).toBe('application/json');
    expect(post?.body).toEqual({
      attending: true,
      people: [
        { name: 'Jürgen Müller', dietary: { tags: ['vegetarian', 'lactoseFree'] } },
        { name: 'Pablo Pérez', dietary: { tags: [], note: 'Nüsse' } },
      ],
      message: 'Hurra!',
      language: 'de',
      website: '',
      dietaryConsent: true,
      elapsedMs: expect.any(Number),
    });
    expect(api.callsTo(STATUS)).toHaveLength(1);

    expect(screen.getByText('Dabei sind')).toBeInTheDocument();
    expect(screen.getByText('Jürgen Müller')).toBeInTheDocument();
    expect(screen.getByText('Vegetarisch, Laktosefrei')).toBeInTheDocument();
    expect(screen.getByText('Nüsse')).toBeInTheDocument();
    expect(screen.getByText('Hurra!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Antwort ändern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Antwort zurückziehen' })).toBeInTheDocument();
  });

  it('asks for the dietary consent only while dietary data is entered', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
    renderRsvp({ lang: 'en' });
    await user.click(screen.getByRole('button', { name: "Yes, we'll be there" }));
    const consentName = /^I agree that you store the details about diet/;
    expect(screen.queryByRole('checkbox', { name: consentName })).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    const vegan = screen.getByRole('checkbox', { name: 'Vegan' });
    await user.click(vegan);
    expect(screen.getByRole('checkbox', { name: consentName })).not.toBeChecked();
    await user.click(vegan);
    expect(screen.queryByRole('checkbox', { name: consentName })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save reply' }));
    expect(await screen.findByText("Thank you! We can't wait to see you.")).toBeInTheDocument();
    expect(api.callsTo(CREATE)[0]?.body).not.toHaveProperty('dietaryConsent');
  });

  it('links the privacy notice from the form', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
    expect(
      screen.getByText(/Eure Angaben verwenden wir nur für die Organisation unserer Hochzeit/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute(
      'href',
      '/datenschutz',
    );
  });

  it('shows the API finding on the consent checkbox', async () => {
    const user = userEvent.setup();
    mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [{ field: 'dietaryConsent', code: 'required' }],
        }),
    });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Anna');
    await user.click(screen.getByRole('checkbox', { name: 'Vegan' }));
    await user.click(screen.getByRole('checkbox', { name: /^Ich bin einverstanden/ }));
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    const consent = await screen.findByRole('checkbox', { name: /^Ich bin einverstanden/ });
    await waitFor(() => expect(consent).toHaveAttribute('aria-invalid', 'true'));
    expect(
      screen.getByText('Bitte willigt ein oder entfernt die Angaben zur Ernährung.'),
    ).toBeInTheDocument();
  });

  it('lets a no list several names, without dietary questions', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
    renderRsvp({ lang: 'en' });
    await user.click(screen.getByRole('button', { name: "Sadly we can't" }));
    expect(screen.getByText("Who can't come?")).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'María-José García');
    await user.click(screen.getByRole('button', { name: '+ Add person' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Person 2' })).getByRole('textbox'),
      'Jürgen Müller',
    );
    await user.click(screen.getByRole('button', { name: 'Save reply' }));

    expect(await screen.findByText('Too bad – thanks for letting us know.')).toBeInTheDocument();
    expect(screen.getByText('Not coming')).toBeInTheDocument();
    expect(api.callsTo(CREATE)[0]?.body).toEqual({
      attending: false,
      people: [{ name: 'María-José García' }, { name: 'Jürgen Müller' }],
      language: 'en',
      website: '',
      elapsedMs: expect.any(Number),
    });
  });

  it('allows at most six people (one guest and five companions) and removes companions', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole('button', { name: '+ Begleitung hinzufügen' }));
    }
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: '+ Begleitung hinzufügen' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Entfernen: Begleitung 5' }));
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(5);
    expect(screen.getByRole('button', { name: '+ Begleitung hinzufügen' })).toBeInTheDocument();
  });

  it('checks the names before sending and focuses the first missing one', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Bitte prüft die markierten Angaben.');
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription('Bitte gebt einen Namen ein.');
    expect(name).toHaveFocus();
    expect(api.callsTo(CREATE)).toEqual([]);
  });

  it('shows the API validation findings at their fields', async () => {
    const user = userEvent.setup();
    mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: () =>
        problem(400, 'validation_failed', {
          errors: [{ field: 'people[0].dietary.note', code: 'too_long' }],
        }),
    });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    const note = screen.getByRole('textbox', { name: 'Allergien oder Hinweise (optional)' });
    await waitFor(() => expect(note).toHaveAccessibleDescription('Dieser Text ist zu lang.'));
    expect(note).toHaveFocus();
  });

  it('sends names the API decides on and shows a refused one at its person', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: (call) =>
        (call.body as RsvpRequest).people.some((person) => person.name === 'example.com')
          ? problem(400, 'validation_failed', {
              errors: [{ field: 'people[1].name', code: 'invalid' }],
            })
          : created(call),
    });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
    await user.click(screen.getByRole('button', { name: '+ Weitere Person' }));
    const [first, second] = screen.getAllByRole('textbox', { name: 'Name' });
    await user.type(first as HTMLElement, 'Mª.de los Ángeles');
    await user.type(second as HTMLElement, 'example.com');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    await waitFor(() =>
      expect(second).toHaveAccessibleDescription(
        'Bitte gebt nur einen Namen ein, ohne Links oder E-Mail-Adressen.',
      ),
    );
    expect(api.callsTo(CREATE)[0]?.body).toMatchObject({
      people: [{ name: 'Mª.de los Ángeles' }, { name: 'example.com' }],
    });
    expect(second).toBeInvalid();
    expect(second).toHaveFocus();
    expect(first).toBeValid();
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte prüft die markierten Angaben.');

    await user.clear(second as HTMLElement);
    await user.type(second as HTMLElement, 'Dr.rer.nat. Ben Example');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByText('Schade – danke für eure Rückmeldung.')).toBeVisible();
    expect(api.callsTo(CREATE)[1]?.body).toMatchObject({
      people: [{ name: 'Mª.de los Ángeles' }, { name: 'Dr.rer.nat. Ben Example' }],
    });
  });

  it('sends what a bot typed into the honeypot', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
    const { container } = renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    const honeypot = container.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    if (honeypot !== null) {
      await user.type(honeypot, 'https://example.com');
    }
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));
    await screen.findByText('Danke! Wir freuen uns auf euch.');
    expect(api.callsTo(CREATE)[0]?.body).toMatchObject({ website: 'https://example.com' });
  });

  it('sends the time since the form was shown with a new reply', async () => {
    const user = userEvent.setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    try {
      const api = mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
      renderRsvp();
      await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
      now.mockReturnValue(9_500);
      await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
      await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

      await screen.findByText('Schade – danke für eure Rückmeldung.');
      expect(api.callsTo(CREATE)[0]?.body).toMatchObject({ elapsedMs: 8_500 });
    } finally {
      now.mockRestore();
    }
  });

  it('shows a refused submission without its reason and lets the guest send again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const api = mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: (call) => {
        attempts += 1;
        return attempts === 1 ? problem(400, 'submission_rejected') : created(call);
      },
    });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Antwort konnte nicht gesendet werden. Bitte prüft eure Angaben und versucht es gleich noch einmal.',
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Pablo Pérez');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeValid();

    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
    expect(api.callsTo(CREATE)).toHaveLength(2);
  });

  it('finds a name given twice before sending', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
    await user.click(screen.getByRole('button', { name: '+ Weitere Person' }));
    const [first, second] = screen.getAllByRole('textbox', { name: 'Name' });
    await user.type(first as HTMLElement, 'María-José García');
    await user.type(second as HTMLElement, 'maria jose garcia');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(second).toBeInvalid();
    expect(second).toHaveAccessibleDescription('Dieser Name steht schon in eurer Antwort.');
    expect(second).toHaveFocus();
    expect(first).toBeValid();
    expect(api.callsTo(CREATE)).toEqual([]);
  });

  it.each([
    [
      'de',
      'Ja, wir kommen',
      '+ Begleitung hinzufügen',
      'Name',
      'Antwort speichern',
      [
        'Bitte gebt den vollständigen Namen ein.',
        'Bitte gebt nur einen Namen ein, ohne Links oder E-Mail-Adressen.',
        'Dieser Name steht schon in eurer Antwort.',
      ],
    ],
    [
      'en',
      "Yes, we'll be there",
      '+ Add companion',
      'Name',
      'Save reply',
      [
        'Please enter the full name.',
        'Please enter just a name, without links or email addresses.',
        'This name is already in your reply.',
      ],
    ],
    [
      'es',
      'Sí, iremos',
      '+ Añadir acompañante',
      'Nombre',
      'Guardar respuesta',
      [
        'Por favor, escribid el nombre completo.',
        'Por favor, escribid solo un nombre, sin enlaces ni direcciones de correo.',
        'Este nombre ya está en vuestra respuesta.',
      ],
    ],
  ] as const)(
    'shows the name findings of the API in %s',
    async (lang, yes, add, label, save, texts) => {
      const user = userEvent.setup();
      mockApi({
        [STATUS]: () => json(200, openStatus),
        [CREATE]: () =>
          problem(400, 'validation_failed', {
            errors: [
              { field: 'people[0].name', code: 'too_short' },
              { field: 'people[1].name', code: 'invalid' },
              { field: 'people[2].name', code: 'duplicate' },
            ],
          }),
      });
      renderRsvp({ lang });
      await user.click(screen.getByRole('button', { name: yes }));
      await user.click(screen.getByRole('button', { name: add }));
      await user.click(screen.getByRole('button', { name: add }));
      const names = screen.getAllByRole('textbox', { name: label });
      for (const [index, name] of ['Pablo Pérez', 'María-José García', 'Jürgen Müller'].entries()) {
        await user.type(names[index] as HTMLElement, name);
      }
      await user.click(screen.getByRole('button', { name: save }));

      await waitFor(() => expect(names[0]).toHaveAccessibleDescription(texts[0]));
      expect(names[1]).toHaveAccessibleDescription(texts[1]);
      expect(names[2]).toHaveAccessibleDescription(texts[2]);
    },
  );

  it.each([
    [
      'rate limited',
      () => problem(429, 'rate_limited'),
      'Zu viele Versuche in kurzer Zeit. Bitte wartet ein paar Minuten und versucht es dann erneut.',
    ],
    [
      'offline',
      offline,
      'Keine Verbindung. Bitte prüft eure Internetverbindung und versucht es erneut.',
    ],
    [
      'full',
      () => problem(503, 'capacity_reached'),
      'Online können wir leider keine weiteren Antworten annehmen.',
    ],
    [
      'broken',
      () => problem(500, 'internal_error'),
      'Das hat leider nicht geklappt. Bitte versucht es später noch einmal.',
    ],
  ])(
    'shows a clear error with a contact fallback (%s) and keeps the entries',
    async (_, answer, text) => {
      const user = userEvent.setup();
      mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: answer });
      renderRsvp();
      await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
      await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
      await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(within(alert).getByRole('link', { name: 'Kontakt' })).toHaveAttribute(
        'href',
        '#contact',
      );
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Pablo Pérez');
      expect(screen.getByRole('button', { name: 'Antwort speichern' })).toBeEnabled();
    },
  );

  it('closes the form when the API says the deadline has passed', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: () => problem(403, 'rsvp_closed') });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByText('Die Antwortfrist ist abgelaufen.')).toHaveFocus();
    expect(screen.getByText('Die Antwortfrist endete am 1. Mai 2099')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(contactLink()).toHaveAttribute('href', '#contact');
  });

  it('shows no buttons after the deadline, only the contact fallback', () => {
    const api = mockApi({});
    renderRsvp({ build: pastDeadline, withDate: false });
    expect(screen.getByText('Die Antwortfrist endete am 1. Januar 2000')).toBeInTheDocument();
    expect(screen.getByText('Die Antwortfrist ist abgelaufen.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(contactLink()).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });

  it('says so when no more replies are accepted', async () => {
    mockApi({ [STATUS]: () => json(200, { ...openStatus, open: false, full: true }) });
    renderRsvp();
    io.reveal();
    expect(
      await screen.findByText('Online können wir leider keine weiteren Antworten annehmen.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(contactLink()).toBeInTheDocument();
  });

  it('loads the reply of a returning guest only once the section is in view', async () => {
    const api = mockApi({ [MINE]: () => json(200, mineBody(yesReply)) });
    setStateCookie('yes');
    renderRsvp();
    expect(screen.getByText('Ihr habt bereits zugesagt.')).toBeInTheDocument();
    expect(api.calls).toEqual([]);

    io.reveal();
    expect(screen.getByRole('status')).toHaveTextContent('Eure Antwort wird geladen …');
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).not.toHaveFocus();
    expect(screen.getByText('Jürgen Müller')).toBeInTheDocument();
    expect(screen.getByText('Sin nueces')).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE]);
  });

  it('loads the stored reply on request when IntersectionObserver is missing', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('IntersectionObserver', undefined);
    const api = mockApi({ [MINE]: () => json(200, mineBody(yesReply)) });
    setStateCookie('yes');
    renderRsvp();
    expect(api.calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Antwort anzeigen' }));
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toHaveFocus();
  });

  it('changes a reply with If-Match and keeps the person ids', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [MINE]: () => json(200, mineBody(yesReply)),
      [UPDATE]: (call) => json(200, mineBody(stored(call), '"v2"')),
    });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort ändern' }));

    expect(
      screen.getAllByRole('textbox', { name: 'Name' }).map((input) => input.getAttribute('value')),
    ).toEqual(['Jürgen Müller', 'Pablo Pérez']);
    expect(
      within(screen.getByRole('group', { name: 'Du' })).getByRole('checkbox', {
        name: 'Vegetarisch',
      }),
    ).toBeChecked();
    // The stored reply has the consent, so the form keeps it ticked.
    expect(screen.getByRole('checkbox', { name: /^Ich bin einverstanden/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '+ Begleitung hinzufügen' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Begleitung 2' })).getByRole('textbox', {
        name: 'Name',
      }),
      'María-José García',
    );
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByText('María-José García')).toBeInTheDocument();
    const [put] = api.callsTo(UPDATE);
    expect(put?.headers['if-match']).toBe('"v1"');
    expect(put?.body).toEqual({
      attending: true,
      people: [
        { id: '5e97e056', name: 'Jürgen Müller', dietary: { tags: ['vegetarian'] } },
        { id: 'e8132d57', name: 'Pablo Pérez', dietary: { tags: [], note: 'Sin nueces' } },
        { name: 'María-José García', dietary: { tags: [] } },
      ],
      message: 'Hurra!',
      language: 'de',
      website: '',
      dietaryConsent: true,
    });
  });

  it('switches a yes to a no while editing', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [MINE]: () => json(200, mineBody(yesReply)),
      [UPDATE]: (call) => json(200, mineBody(stored(call), '"v2"')),
    });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort ändern' }));
    await user.click(screen.getByRole('radio', { name: 'Leider nicht' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(await screen.findByText('Schade – danke für eure Rückmeldung.')).toBeInTheDocument();
    expect(api.callsTo(UPDATE)[0]?.body).toMatchObject({
      attending: false,
      people: [
        { id: '5e97e056', name: 'Jürgen Müller' },
        { id: 'e8132d57', name: 'Pablo Pérez' },
      ],
    });
    expect(screen.queryByText('Sin nueces')).toBeNull();
  });

  it('withdraws a reply after a confirmation', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      [MINE]: () => json(200, mineBody(yesReply)),
      [DELETE]: () => new Response(null, { status: 204 }),
      [STATUS]: () => json(200, openStatus),
    });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort zurückziehen' }));
    expect(screen.getByText('Wollt ihr eure Antwort wirklich zurückziehen?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Ja, zurückziehen' }));

    expect(await screen.findByText('Eure Antwort wurde zurückgezogen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ja, wir kommen' })).toHaveFocus();
    expect(api.callsTo(DELETE)[0]?.headers['if-match']).toBe('"v1"');
  });

  it('cancels a withdrawal', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [MINE]: () => json(200, mineBody(yesReply)) });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort zurückziehen' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByRole('button', { name: 'Antwort zurückziehen' })).toHaveFocus();
    expect(api.callsTo(DELETE)).toEqual([]);
  });

  it('turns the reply read-only when the API refuses a withdrawal after the deadline', async () => {
    const user = userEvent.setup();
    mockApi({
      [MINE]: () => json(200, mineBody(yesReply)),
      [DELETE]: () => problem(403, 'rsvp_closed'),
    });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort zurückziehen' }));
    await user.click(screen.getByRole('button', { name: 'Ja, zurückziehen' }));

    expect(
      await screen.findByText(
        'Die Antwortfrist ist vorbei. Für Änderungen meldet euch bitte direkt bei uns.',
      ),
    ).toHaveFocus();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Jürgen Müller')).toBeInTheDocument();
    expect(contactLink()).toBeInTheDocument();
  });

  it('asks for a new reply when the stored one is gone', async () => {
    mockApi({ [MINE]: () => problem(404, 'not_found'), [STATUS]: () => json(200, openStatus) });
    setStateCookie('no');
    renderRsvp();
    expect(screen.getByText('Ihr habt bereits abgesagt.')).toBeInTheDocument();
    io.reveal();
    expect(await screen.findByRole('button', { name: 'Ja, wir kommen' })).toBeInTheDocument();
  });

  it('retries loading a stored reply after a network error', async () => {
    const user = userEvent.setup();
    mockApi({ [MINE]: [offline, () => json(200, mineBody(yesReply))] });
    setStateCookie('yes');
    renderRsvp();
    io.reveal();
    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung.');
    expect(contactLink()).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toHaveFocus();
  });

  it('shows the reply read-only after the deadline', async () => {
    mockApi({ [MINE]: () => json(200, mineBody(yesReply, '"v1"', false)) });
    await showStoredReply(mineBody(yesReply, '"v1"', false));
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText(
        'Die Antwortfrist ist vorbei. Für Änderungen meldet euch bitte direkt bei uns.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Die Antwortfrist endete am 1. Mai 2099')).toBeInTheDocument();
    expect(contactLink()).toBeInTheDocument();
  });

  it('shows the existing reply when this browser has answered already (409)', async () => {
    const user = userEvent.setup();
    mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: () => problem(409, 'rsvp_exists'),
      [MINE]: () => json(200, mineBody(yesReply)),
    });
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(
      await screen.findByText('Aus diesem Browser gibt es schon eine Antwort – hier ist sie.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
  });

  it('reloads the reply when it was changed elsewhere (412)', async () => {
    const user = userEvent.setup();
    const changed = { ...yesReply, message: 'Bis bald!' };
    mockApi({
      [MINE]: [() => json(200, mineBody(yesReply)), () => json(200, mineBody(changed, '"v2"'))],
      [UPDATE]: () => problem(412, 'precondition_failed'),
    });
    await showStoredReply();
    await user.click(screen.getByRole('button', { name: 'Antwort ändern' }));
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(
      await screen.findByText(
        'Eure Antwort wurde inzwischen an anderer Stelle geändert. Hier ist der aktuelle Stand.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Bis bald!')).toBeInTheDocument();
  });
});

describe('Rsvp: the personal edit link', () => {
  const CLAIM = 'POST /api/rsvp/claim';
  /** A well-formed edit token (fictional). */
  const TOKEN = `1b86eb8e593b91c86f2d8d37d4fd593a.${'Ab3_-'.repeat(8)}xyz`;
  const link = () => `${window.location.origin}/#edit=${TOKEN}`;

  const createdWithLink = (call: RecordedCall) =>
    json(201, { rsvp: stored(call), version: '"v1"', editToken: TOKEN }, { ETag: '"v1"' });

  /** This browser's own reply: another one than the link's (`yesReply`). */
  const ownReply: RsvpView = {
    id: '2c97fc9f604ca2d97f3e9e48e5fe604b',
    attending: false,
    people: [{ id: '7a0c1e55', name: 'María-José García', dietary: { tags: [] } }],
    language: 'es',
  };
  const OWN_TOKEN = `${ownReply.id}.${'Zz9_-'.repeat(8)}abc`;

  /** Opens the page with `hash` in the address bar. */
  const openWith = (hash: string) => window.history.replaceState(null, '', `/${hash}`);

  afterEach(() => window.history.replaceState(null, '', '/'));

  const labels = {
    de: { no: 'Leider nicht', save: 'Antwort speichern' },
    en: { no: "Sadly we can't", save: 'Save reply' },
    es: { no: 'Lamentablemente no', save: 'Guardar respuesta' },
  } as const;

  async function sendANo(user: ReturnType<typeof userEvent.setup>, lang: Lang = 'de') {
    renderRsvp({ lang });
    await user.click(screen.getByRole('button', { name: labels[lang].no }));
    const [name] = screen.getAllByRole('textbox');
    if (name === undefined) throw new Error('no name field');
    await user.type(name, 'Pablo Pérez');
    await user.click(screen.getByRole('button', { name: labels[lang].save }));
  }

  it('shows the link of a new reply with a copy button and a hint to keep it', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: createdWithLink });
    await sendANo(user);

    const field = await screen.findByRole('textbox', { name: 'Euer persönlicher Link' });
    expect(field).toHaveValue(link());
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAccessibleDescription(/^Hebt diesen Link gut auf/);
    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    expect(await screen.findByText('Link kopiert.')).toHaveAttribute('role', 'status');
    expect(await navigator.clipboard.readText()).toBe(link());
  });

  it('selects the link for copying by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: createdWithLink });
    await sendANo(user);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await user.click(await screen.findByRole('button', { name: 'Link kopieren' }));

    expect(
      await screen.findByText(
        'Kopieren hat nicht geklappt – bitte markiert den Link und kopiert ihn selbst.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Euer persönlicher Link' })).toHaveFocus();
  });

  it.each([
    ['en', 'Your personal link', 'Copy link', /^Keep this link safe/],
    ['es', 'Vuestro enlace personal', 'Copiar enlace', /^Guardad bien este enlace/],
  ] as const)('shows the link in %s', async (lang, label, copy, hint) => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: createdWithLink });
    await sendANo(user, lang);

    expect(await screen.findByRole('textbox', { name: label })).toHaveAccessibleDescription(hint);
    expect(screen.getByRole('button', { name: copy })).toBeInTheDocument();
  });

  it('shows no link when the API sends none', async () => {
    const user = userEvent.setup();
    mockApi({ [STATUS]: () => json(200, openStatus), [CREATE]: created });
    await sendANo(user);
    expect(await screen.findByText('Schade – danke für eure Rückmeldung.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Euer persönlicher Link' })).toBeNull();
  });

  it('drops the link once the reply is withdrawn', async () => {
    const user = userEvent.setup();
    mockApi({
      [STATUS]: () => json(200, openStatus),
      [CREATE]: createdWithLink,
      [DELETE]: () => new Response(null, { status: 204 }),
    });
    await sendANo(user);
    expect(await screen.findByRole('textbox', { name: 'Euer persönlicher Link' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Antwort zurückziehen' }));
    await user.click(screen.getByRole('button', { name: 'Ja, zurückziehen' }));
    expect(await screen.findByText('Eure Antwort wurde zurückgezogen.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Euer persönlicher Link' })).toBeNull();
  });

  it('claims the reply of an edit link once the section is in view, then forgets the link', async () => {
    openWith(`#edit=${TOKEN}`);
    const api = mockApi({ [CLAIM]: () => json(200, mineBody(yesReply)) });
    renderRsvp();
    expect(api.calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Antwort anzeigen' })).toBeInTheDocument();

    io.reveal();
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Eure Antwort ist jetzt auch in diesem Browser gespeichert. Ihr könnt sie hier ändern.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Jürgen Müller')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Antwort ändern' })).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([CLAIM]);
    expect(api.callsTo(CLAIM)[0]?.body).toEqual({ editToken: TOKEN });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('textbox', { name: 'Euer persönlicher Link' })).toBeNull();
  });

  it('says that a wrong or withdrawn link does not work, without saying which', async () => {
    openWith(`#edit=${TOKEN}`);
    const api = mockApi({
      [CLAIM]: () => problem(404, 'not_found'),
      [STATUS]: () => json(200, openStatus),
    });
    renderRsvp({ lang: 'en' });
    io.reveal();

    expect(
      await screen.findByText(
        "Sorry, this link doesn't work. It may be incomplete, or its reply was withdrawn.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: "Yes, we'll be there" })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(api.callsTo(CLAIM)).toHaveLength(1);
  });

  it('keeps showing the own reply when a link fails in a browser that has one', async () => {
    openWith(`#edit=${TOKEN}`);
    setStateCookie('no');
    const api = mockApi({
      [MINE]: () => json(200, mineBody(ownReply)),
      [CLAIM]: () => problem(404, 'not_found'),
    });
    renderRsvp({ lang: 'es' });
    io.reveal();

    expect(
      await screen.findByText(
        'Lo sentimos, este enlace no funciona. Puede que esté incompleto o que su respuesta se haya retirado.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Qué pena – gracias por avisarnos.')).toBeInTheDocument();
    expect(screen.getByText('María-José García')).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE, CLAIM]);
    expect(api.callsTo(CLAIM)[0]?.body).toEqual({ editToken: TOKEN, preview: true });
    expect(screen.queryByRole('heading', { name: '¿Quiénes sois?' })).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('shows the personal link of a returning guest only on request', async () => {
    const user = userEvent.setup();
    const api = mockApi({ [MINE]: () => json(200, { ...mineBody(yesReply), editToken: TOKEN }) });
    await showStoredReply();
    expect(screen.queryByRole('textbox', { name: 'Euer persönlicher Link' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Euren persönlichen Link anzeigen' }));

    const field = screen.getByRole('textbox', { name: 'Euer persönlicher Link' });
    expect(field).toHaveValue(link());
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription(/^Hebt diesen Link gut auf/);
    expect(screen.queryByRole('button', { name: 'Euren persönlichen Link anzeigen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeInTheDocument();
    // The link sits above the buttons to change or withdraw the reply.
    expect(
      field.compareDocumentPosition(screen.getByRole('button', { name: 'Antwort ändern' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE]);
  });

  it.each([
    ['en', 'Show your personal link', 'Your personal link'],
    ['es', 'Ver vuestro enlace personal', 'Vuestro enlace personal'],
  ] as const)('offers the link in %s', async (lang, show, label) => {
    const user = userEvent.setup();
    mockApi({ [MINE]: () => json(200, { ...mineBody(yesReply), editToken: TOKEN }) });
    setStateCookie('yes');
    renderRsvp({ lang });
    io.reveal();

    await user.click(await screen.findByRole('button', { name: show }));
    expect(screen.getByRole('textbox', { name: label })).toHaveValue(link());
  });

  it('offers the link after the deadline too, and never a link the API did not send', async () => {
    const user = userEvent.setup();
    setStateCookie('yes');
    mockApi({
      [MINE]: () => json(200, { ...mineBody(yesReply, '"v1"', false), editToken: TOKEN }),
    });
    const { unmount } = renderRsvp();
    io.reveal();
    await user.click(
      await screen.findByRole('button', { name: 'Euren persönlichen Link anzeigen' }),
    );
    expect(screen.getByRole('textbox', { name: 'Euer persönlicher Link' })).toHaveValue(link());
    unmount();

    mockApi({ [MINE]: () => json(200, mineBody(yesReply)) });
    renderRsvp();
    io.reveal();
    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Euren persönlichen Link anzeigen' })).toBeNull();
  });

  it('reports a malformed link at once and never sends it', async () => {
    openWith('#edit=1b86eb8e.abc');
    const api = mockApi({ [STATUS]: () => json(200, openStatus) });
    renderRsvp();
    expect(
      screen.getByText(
        'Dieser Link funktioniert leider nicht. Vielleicht ist er unvollständig, oder die Antwort dazu wurde zurückgezogen.',
      ),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('');

    io.reveal();
    await waitFor(() => expect(api.callsTo(STATUS)).toHaveLength(1));
    expect(api.callsTo(CLAIM)).toEqual([]);
  });

  it('keeps the link and claims again after a network error', async () => {
    const user = userEvent.setup();
    openWith(`#edit=${TOKEN}`);
    const api = mockApi({ [CLAIM]: [offline, () => json(200, mineBody(yesReply))] });
    renderRsvp();
    io.reveal();

    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung.');
    expect(screen.queryByText('Ihr habt bereits zugesagt.')).toBeNull();
    expect(window.location.hash).toBe(`#edit=${TOKEN}`);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
    expect(api.callsTo(CLAIM)).toHaveLength(2);
    expect(window.location.hash).toBe('');
  });

  describe('a link to another reply than this browser has: "who are you?"', () => {
    /** The claim route: names for a preview, else the link's reply (and its cookies). */
    const claimRoute = (call: RecordedCall) =>
      (call.body as { preview?: boolean }).preview === true
        ? json(200, { names: yesReply.people.map((person) => person.name) })
        : json(200, { ...mineBody(yesReply), editToken: TOKEN });

    async function openLinkWithOwnReply(lang: Lang = 'de') {
      openWith(`#edit=${TOKEN}`);
      setStateCookie('no');
      const api = mockApi({
        [MINE]: () => json(200, { ...mineBody(ownReply), editToken: OWN_TOKEN }),
        [CLAIM]: claimRoute,
      });
      renderRsvp({ lang });
      expect(api.calls).toEqual([]);
      io.reveal();
      return api;
    }

    it('asks with both names, focuses the question and changes nothing yet', async () => {
      const api = await openLinkWithOwnReply();

      const heading = await screen.findByRole('heading', { name: 'Wer seid ihr?' });
      expect(heading).toHaveFocus();
      expect(
        screen.getByText('Seid ihr María-José García oder Jürgen Müller und Pablo Pérez?'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'María-José García' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Jürgen Müller und Pablo Pérez' }),
      ).toBeInTheDocument();
      expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE, CLAIM]);
      expect(api.callsTo(CLAIM)[0]?.body).toEqual({ editToken: TOKEN, preview: true });
      expect(window.location.hash).toBe(`#edit=${TOKEN}`);
      expect(screen.queryByText('Danke! Wir freuen uns auf euch.')).toBeNull();
    });

    it('keeps this browser’s reply when the guest picks its names, without a claim', async () => {
      const user = userEvent.setup();
      const api = await openLinkWithOwnReply();

      await user.click(await screen.findByRole('button', { name: 'María-José García' }));

      const thanks = await screen.findByText('Schade – danke für eure Rückmeldung.');
      expect(thanks).toHaveFocus();
      expect(screen.getByText('María-José García')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Wer seid ihr?' })).toBeNull();
      expect(window.location.hash).toBe('');
      expect(api.callsTo(CLAIM)).toHaveLength(1);
      // The own reply's link, not the opened one.
      await user.click(screen.getByRole('button', { name: 'Euren persönlichen Link anzeigen' }));
      expect(screen.getByRole('textbox', { name: 'Euer persönlicher Link' })).toHaveValue(
        `${window.location.origin}/#edit=${OWN_TOKEN}`,
      );
    });

    it('takes the link’s reply when the guest picks the link’s names', async () => {
      const user = userEvent.setup();
      const api = await openLinkWithOwnReply();

      await user.click(
        await screen.findByRole('button', { name: 'Jürgen Müller und Pablo Pérez' }),
      );

      expect(await screen.findByText('Danke! Wir freuen uns auf euch.')).toHaveFocus();
      expect(
        screen.getByText(
          'Eure Antwort ist jetzt auch in diesem Browser gespeichert. Ihr könnt sie hier ändern.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Jürgen Müller')).toBeInTheDocument();
      expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE, CLAIM, CLAIM]);
      expect(api.callsTo(CLAIM)[1]?.body).toEqual({ editToken: TOKEN });
      expect(window.location.hash).toBe('');
    });

    it.each([
      [
        'en',
        'Who are you?',
        'Are you María-José García or Jürgen Müller and Pablo Pérez?',
        'Jürgen Müller and Pablo Pérez',
      ],
      [
        'es',
        '¿Quiénes sois?',
        '¿Sois María-José García o Jürgen Müller y Pablo Pérez?',
        'Jürgen Müller y Pablo Pérez',
      ],
    ] as const)('asks in %s', async (lang, title, question, linkNames) => {
      await openLinkWithOwnReply(lang);
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByText(question)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: linkNames })).toBeInTheDocument();
    });

    it.each(['de', 'en', 'es'] as const)('speaks only of people in %s', async (lang) => {
      await openLinkWithOwnReply(lang);
      const own = await screen.findByRole('button', { name: 'María-José García' });
      const question = own.closest('.rsvp-who');
      expect(question?.textContent).toMatch(/María-José García/);
      expect(question?.textContent).not.toMatch(
        /browser|navegador|cookie|token|session|sitzung|sesión|claim|daten|datos|data|speicher|storage|almacen|link|enlace/i,
      );
    });

    it('shows the reply without asking or claiming when the link is this browser’s own', async () => {
      openWith(`#edit=${OWN_TOKEN}`);
      setStateCookie('no');
      const api = mockApi({
        [MINE]: () => json(200, { ...mineBody(ownReply), editToken: OWN_TOKEN }),
      });
      renderRsvp();
      io.reveal();

      expect(await screen.findByText('Schade – danke für eure Rückmeldung.')).toBeInTheDocument();
      expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE]);
      expect(window.location.hash).toBe('');
      expect(screen.queryByRole('heading', { name: 'Wer seid ihr?' })).toBeNull();
    });

    it('claims at once when the state cookie is stale (the own reply is gone)', async () => {
      openWith(`#edit=${TOKEN}`);
      setStateCookie('yes');
      const api = mockApi({ [MINE]: () => problem(404, 'not_found'), [CLAIM]: claimRoute });
      renderRsvp();
      io.reveal();

      expect(
        await screen.findByText(
          'Eure Antwort ist jetzt auch in diesem Browser gespeichert. Ihr könnt sie hier ändern.',
        ),
      ).toBeInTheDocument();
      expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([MINE, CLAIM]);
      expect(api.callsTo(CLAIM)[0]?.body).toEqual({ editToken: TOKEN });
    });

    it('asks again after a network error while asking', async () => {
      const user = userEvent.setup();
      openWith(`#edit=${TOKEN}`);
      setStateCookie('no');
      const api = mockApi({
        [MINE]: () => json(200, mineBody(ownReply)),
        [CLAIM]: [offline, claimRoute],
      });
      renderRsvp();
      io.reveal();

      expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung.');
      expect(window.location.hash).toBe(`#edit=${TOKEN}`);
      await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

      expect(await screen.findByRole('heading', { name: 'Wer seid ihr?' })).toBeInTheDocument();
      expect(api.callsTo(CLAIM).map((call) => call.body)).toEqual([
        { editToken: TOKEN, preview: true },
        { editToken: TOKEN, preview: true },
      ]);
    });
  });

  it('ignores an edit link while the feature is off', () => {
    openWith(`#edit=${TOKEN}`);
    const api = mockApi({});
    renderRsvp({ build: { ...build, features: { rsvp: false, admin: false } } });
    io.reveal();
    expect(api.calls).toEqual([]);
    expect(window.location.hash).toBe(`#edit=${TOKEN}`);
  });
});
