import { rsvpStateCookie, SAMPLE_YES_REPLY } from '../fixtures/rsvp-api.ts';
import { sectionOfType } from '../fixtures/sample.ts';
import { expect, test } from '../fixtures/test.ts';
import { snap } from '../screenshots-tooling/snap.ts';

// The RSVP flows against the in-memory RSVP API (fixtures/rsvp-api.ts), in German. Every state is
// captured: start, filled (yes and no), validation error, saved (yes and no), revisit, edit,
// withdrawn and closed.

const RSVP_ID = sectionOfType('rsvp').id;

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
