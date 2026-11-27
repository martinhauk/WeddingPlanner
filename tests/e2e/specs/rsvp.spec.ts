import { callsOtherThanKeepWarm, installApiMocks } from '../fixtures/api-mocks.ts';
import { rsvpStateCookie, SAMPLE_YES_REPLY } from '../fixtures/rsvp-api.ts';
import { sectionOfType } from '../fixtures/sample.ts';
import { expect, FIXED_NOW, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

// The RSVP flows against the in-memory RSVP API (fixtures/rsvp-api.ts), in German. Every state is
// captured: start, filled (yes and no), validation error, saved (yes and no, with the personal
// edit link), revisit, edit, withdrawn, closed, a link that does not work and the hero's answered
// state.

const RSVP_ID = sectionOfType('rsvp').id;

/** The personal edit link as the success screen shows it. */
const EDIT_LINK = /\/#edit=[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/;

test.describe('RSVP', () => {
  test('yes: two guests with dietary needs and a message', async ({ page, rsvpApi }) => {
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    const yes = rsvp.getByRole('button', { name: 'Ja, wir kommen' });
    await expect(yes).toBeVisible();
    await snap(page, 'rsvp-start', { lang: 'de', target: rsvp });

    await yes.click();
    const you = rsvp.getByRole('group', { name: 'Du', exact: true });
    await expect(you.getByLabel('Name', { exact: true })).toBeFocused();
    await you.getByLabel('Name', { exact: true }).fill('Jürgen Müller');
    await you.getByLabel('Vegetarisch').check();

    await rsvp.getByRole('button', { name: '+ Begleitung hinzufügen' }).click();
    const companion = rsvp.getByRole('group', { name: 'Begleitung 1', exact: true });
    await companion.getByLabel('Name', { exact: true }).fill('Pablo Pérez');
    await companion.getByLabel('Glutenfrei').check();
    await companion.getByLabel('Laktosefrei').check();
    await companion.getByLabel('Allergien oder Hinweise (optional)').fill('Keine Nüsse');
    await rsvp.getByLabel('Nachricht an uns (optional)').fill('Wir freuen uns sehr!');
    // Dietary data needs the explicit consent (health data); without it nothing is sent.
    await rsvp.getByRole('checkbox', { name: /^Ich bin einverstanden/ }).check();
    await snap(page, 'rsvp-filled-yes', { lang: 'de', target: rsvp });

    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();
    await expect(rsvp.getByText('Danke! Wir freuen uns auf euch.')).toBeVisible();
    const summary = rsvp.locator('.rsvp-summary');
    await expect(summary).toContainText('Dabei sind');
    await expect(summary).toContainText('Jürgen Müller');
    await expect(summary).toContainText('Pablo Pérez');
    await expect(summary).toContainText('Wir freuen uns sehr!');
    await expect(rsvp.getByRole('textbox', { name: 'Euer persönlicher Link' })).toHaveValue(
      EDIT_LINK,
    );
    await snap(page, 'rsvp-saved-yes', { lang: 'de', target: rsvp });

    expect(rsvpApi.writes()).toEqual([
      {
        method: 'POST',
        path: '/api/rsvp',
        ifMatch: undefined,
        body: {
          attending: true,
          people: [
            { name: 'Jürgen Müller', dietary: { tags: ['vegetarian'] } },
            {
              name: 'Pablo Pérez',
              dietary: { tags: ['glutenFree', 'lactoseFree'], note: 'Keine Nüsse' },
            },
          ],
          message: 'Wir freuen uns sehr!',
          language: 'de',
          website: '',
          elapsedMs: expect.any(Number),
          dietaryConsent: true,
        },
      },
    ]);
  });

  test('no: several names, without dietary needs', async ({ page, rsvpApi }) => {
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Leider nicht' }).click();
    await expect(rsvp.getByText('Wer kann nicht kommen?')).toBeVisible();
    await expect(rsvp.getByRole('group', { name: 'Ernährung' })).toHaveCount(0);

    await rsvp
      .getByRole('group', { name: 'Du', exact: true })
      .getByLabel('Name', { exact: true })
      .fill('Pablo Pérez');
    await rsvp.getByRole('button', { name: '+ Weitere Person' }).click();
    await rsvp
      .getByRole('group', { name: 'Person 2', exact: true })
      .getByLabel('Name', { exact: true })
      .fill('María-José García');
    await snap(page, 'rsvp-filled-no', { lang: 'de', target: rsvp });

    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();
    await expect(rsvp.getByText('Schade – danke für eure Rückmeldung.')).toBeVisible();
    const summary = rsvp.locator('.rsvp-summary');
    await expect(summary).toContainText('Nicht dabei');
    await expect(summary).toContainText('Pablo Pérez');
    await expect(summary).toContainText('María-José García');
    await snap(page, 'rsvp-saved-no', { lang: 'de', target: rsvp });

    expect(rsvpApi.writes().map((write) => write.body)).toEqual([
      {
        attending: false,
        people: [{ name: 'Pablo Pérez' }, { name: 'María-José García' }],
        language: 'de',
        website: '',
        elapsedMs: expect.any(Number),
      },
    ]);
  });

  test('a missing name is reported before anything is sent', async ({ page, rsvpApi }) => {
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Ja, wir kommen' }).click();
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();

    await expect(rsvp.getByRole('alert')).toHaveText('Bitte prüft die markierten Angaben.');
    const name = rsvp.getByRole('group', { name: 'Du', exact: true }).getByLabel('Name', {
      exact: true,
    });
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('Bitte gebt einen Namen ein.');
    await expect(name).toBeFocused();
    await snap(page, 'rsvp-validation', { lang: 'de', target: rsvp });
    expect(rsvpApi.writes()).toEqual([]);
  });

  test('the name rules and a name given twice are reported before anything is sent', async ({
    page,
    rsvpApi,
  }) => {
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Ja, wir kommen' }).click();
    await rsvp.getByRole('button', { name: '+ Begleitung hinzufügen' }).click();
    await rsvp.getByRole('button', { name: '+ Begleitung hinzufügen' }).click();
    const name = (group: string) =>
      rsvp.getByRole('group', { name: group, exact: true }).getByLabel('Name', { exact: true });
    await name('Du').fill('A');
    await name('Begleitung 1').fill('Jürgen Müller');
    await name('Begleitung 2').fill('jurgen muller');
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();

    await expect(rsvp.getByRole('alert')).toHaveText('Bitte prüft die markierten Angaben.');
    await expect(name('Du')).toHaveAccessibleDescription('Bitte gebt den vollständigen Namen ein.');
    await expect(name('Begleitung 1')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name('Begleitung 2')).toHaveAccessibleDescription(
      'Dieser Name steht schon in eurer Antwort.',
    );
    await snap(page, 'rsvp-name-rules', { lang: 'de', target: rsvp });
    expect(rsvpApi.writes()).toEqual([]);
  });

  test('a refused submission is reported without its reason', async ({ page, rsvpApi }) => {
    // Registered after the fake API, so this route answers the POST first.
    await page.route('**/api/rsvp', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 400,
            contentType: 'application/problem+json',
            body: JSON.stringify({ status: 400, code: 'submission_rejected' }),
          })
        : route.fallback(),
    );
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Leider nicht' }).click();
    await rsvp
      .getByRole('group', { name: 'Du', exact: true })
      .getByLabel('Name', { exact: true })
      .fill('Pablo Pérez');
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();

    await expect(rsvp.getByRole('alert')).toHaveText(
      'Die Antwort konnte nicht gesendet werden. Bitte prüft eure Angaben und versucht es gleich noch einmal.',
    );
    await snap(page, 'rsvp-rejected', { lang: 'de', target: rsvp });
    expect(rsvpApi.stored()).toBeUndefined();
  });

  test('a returning guest sees, changes and withdraws the reply', async ({
    page,
    context,
    baseURL,
    rsvpApi,
  }) => {
    if (baseURL === undefined) throw new Error('no baseURL');
    rsvpApi.seed(SAMPLE_YES_REPLY);
    await context.addCookies([rsvpStateCookie(new URL(baseURL).origin, 'yes')]);
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);

    const summary = rsvp.locator('.rsvp-summary');
    await expect(summary).toContainText('Jürgen Müller');
    await expect(summary).toContainText('María-José García');
    await expect(summary).toContainText('Wir freuen uns!');
    await snap(page, 'rsvp-revisit', { lang: 'de', target: rsvp });

    await rsvp.getByRole('button', { name: 'Antwort ändern' }).click();
    const you = rsvp.getByRole('group', { name: 'Du', exact: true });
    await expect(you.getByLabel('Name', { exact: true })).toHaveValue('Jürgen Müller');
    await expect(you.getByLabel('Vegetarisch')).toBeChecked();
    await rsvp.getByLabel('Nachricht an uns (optional)').fill('Bis bald!');
    await snap(page, 'rsvp-edit', { lang: 'de', target: rsvp });
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();
    await expect(summary).toContainText('Bis bald!');

    await rsvp.getByRole('button', { name: 'Antwort zurückziehen' }).click();
    await expect(rsvp.getByText('Wollt ihr eure Antwort wirklich zurückziehen?')).toBeVisible();
    await rsvp.getByRole('button', { name: 'Ja, zurückziehen' }).click();
    await expect(rsvp.getByText('Eure Antwort wurde zurückgezogen.')).toBeVisible();
    await expect(rsvp.getByRole('button', { name: 'Ja, wir kommen' })).toBeVisible();
    await snap(page, 'rsvp-withdrawn', { lang: 'de', target: rsvp });

    const writes = rsvpApi.writes();
    expect(writes.map((write) => `${write.method} ${write.path} ${write.ifMatch}`)).toEqual([
      'PUT /api/rsvp/me "v1"',
      'DELETE /api/rsvp/me "v2"',
    ]);
    expect(writes[0]?.body).toMatchObject({
      attending: true,
      people: [{ id: 'e2e00001', name: 'Jürgen Müller' }, { id: 'e2e00002' }],
      message: 'Bis bald!',
    });
    expect(rsvpApi.stored()).toBeUndefined();
  });

  test('the personal edit link opens the reply in a fresh browser', async ({
    page,
    browser,
    baseURL,
    rsvpApi,
  }) => {
    if (baseURL === undefined) throw new Error('no baseURL');
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await rsvp.getByRole('button', { name: 'Leider nicht' }).click();
    await rsvp
      .getByRole('group', { name: 'Du', exact: true })
      .getByLabel('Name', { exact: true })
      .fill('Pablo Pérez');
    await rsvp.getByRole('button', { name: 'Antwort speichern' }).click();

    const field = rsvp.getByRole('textbox', { name: 'Euer persönlicher Link' });
    await expect(field).toHaveValue(EDIT_LINK);
    await expect(field).toHaveAccessibleDescription(/^Hebt diesen Link gut auf/);
    await rsvp.getByRole('button', { name: 'Link kopieren' }).click();
    // Copied, or (where the browser refuses the clipboard) selected for copying by hand.
    await expect(rsvp.getByText(/^(Link kopiert\.|Kopieren hat nicht geklappt)/)).toBeVisible();
    await snap(page, 'rsvp-edit-link', { lang: 'de', target: rsvp });
    const link = new URL(await field.inputValue());
    expect(link.origin).toBe(new URL(baseURL).origin);
    expect(link.hash).toBe(`#edit=${rsvpApi.editToken()}`);

    // Another phone, or the real browser after a messenger's in-app browser: no cookies at all.
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
    const fresh = await browser.newContext({
      baseURL,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    try {
      const freshApi = await installApiMocks(fresh, link.origin);
      await rsvpApi.attach(freshApi);
      const other = await fresh.newPage();
      await other.clock.setFixedTime(FIXED_NOW);
      await other.goto(`${link.pathname}${link.hash}`);

      const section = other.locator(`#${RSVP_ID}`);
      await expect(
        section.getByText(
          'Eure Antwort ist jetzt auch in diesem Browser gespeichert. Ihr könnt sie hier ändern.',
        ),
      ).toBeVisible();
      await expect(section.locator('.rsvp-summary')).toContainText('Pablo Pérez');
      await expect(section.getByRole('button', { name: 'Antwort ändern' })).toBeVisible();
      await expect(section.getByRole('textbox', { name: 'Euer persönlicher Link' })).toHaveCount(0);
      // The link leaves the address bar (and the history entry) once it is claimed.
      await expect.poll(() => other.evaluate(() => window.location.hash)).toBe('');
      expect(callsOtherThanKeepWarm(freshApi.calls())).toEqual(['POST /api/rsvp/claim']);
      expect(freshApi.takeUnmocked()).toEqual([]);
    } finally {
      await fresh.close();
    }
    expect(rsvpApi.writes().map((write) => `${write.method} ${write.path}`)).toEqual([
      'POST /api/rsvp',
      'POST /api/rsvp/claim',
    ]);
    expect(rsvpApi.writes()[1]?.body).toEqual({ editToken: rsvpApi.editToken() });
  });

  test('a link that does not work says so, without saying why', async ({ page, rsvpApi }) => {
    rsvpApi.seed(SAMPLE_YES_REPLY);
    // The id of a stored reply with a wrong secret: answered exactly like an unknown id.
    await page.goto(`/#edit=${SAMPLE_YES_REPLY.id}.${'A'.repeat(43)}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await expect(
      rsvp.getByText(
        'Dieser Link funktioniert leider nicht. Vielleicht ist er unvollständig, oder die Antwort dazu wurde zurückgezogen.',
      ),
    ).toBeVisible();
    await expect(rsvp.getByRole('button', { name: 'Ja, wir kommen' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await snap(page, 'rsvp-link-invalid', { lang: 'de', target: rsvp });
    expect(rsvpApi.writes().map((write) => `${write.method} ${write.path}`)).toEqual([
      'POST /api/rsvp/claim',
    ]);
  });

  test('the hero shows the reply of this browser without calling the API', async ({
    page,
    context,
    baseURL,
    rsvpApi,
    expectOnlyKeepWarmCalls,
  }) => {
    if (baseURL === undefined) throw new Error('no baseURL');
    rsvpApi.seed(SAMPLE_YES_REPLY);
    await context.addCookies([rsvpStateCookie(new URL(baseURL).origin, 'yes')]);
    await page.goto('/');
    const hero = page.locator('.hero');
    await expect(hero.getByText('Ihr habt zugesagt.')).toBeVisible();
    const change = hero.getByRole('link', { name: 'Antwort ändern' });
    await expect(change).toHaveAttribute('href', `#${RSVP_ID}`);
    await expect(hero.getByRole('link', { name: 'Zusagen' })).toHaveCount(0);
    await expectOnlyKeepWarmCalls();
    await snap(page, 'rsvp-hero-answered', {
      lang: 'de',
      target: hero,
      mask: [hero.getByRole('timer')],
    });

    await change.click();
    await expect(page.locator(`#${RSVP_ID} .rsvp-summary`)).toContainText('Jürgen Müller');
  });

  test('after the deadline no reply can be sent', async ({ page, rsvpApi }) => {
    rsvpApi.setStatus({ open: false });
    await page.goto(`/#${RSVP_ID}`);
    const rsvp = page.locator(`#${RSVP_ID}`);
    await expect(rsvp.getByText('Die Antwortfrist ist abgelaufen.')).toBeVisible();
    await expect(rsvp.getByRole('button', { name: 'Ja, wir kommen' })).toHaveCount(0);
    await snap(page, 'rsvp-closed', { lang: 'de', target: rsvp });
    expect(rsvpApi.writes()).toEqual([]);
  });
});
