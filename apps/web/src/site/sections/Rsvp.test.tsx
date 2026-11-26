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
