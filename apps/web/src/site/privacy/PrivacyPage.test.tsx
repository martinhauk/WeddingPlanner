import { render, screen, within } from '@testing-library/react';
import type { SiteContent } from '@weddingplanner/content';
import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '../i18n.ts';
import type { SiteBuild } from '../sections/types.ts';
import { build, content } from '../test/fixture.ts';
import { PrivacyPage } from './PrivacyPage.tsx';
import { isPrivacyPath } from './route.ts';

const renderPage = (
  options: { content?: SiteContent; regions?: SiteBuild['regions']; lang?: Lang } = {},
) =>
  render(
    <PrivacyPage
      content={options.content ?? content}
      regions={options.regions ?? build.regions}
      lang={options.lang ?? 'de'}
    />,
  );

const block = (name: string | RegExp) => screen.getByRole('region', { name });

describe('PrivacyPage', () => {
  it('names the controllers with their addresses and the contact email from the content', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeVisible();
    const controller = block('Verantwortlich');
    expect(
      within(controller).getByText(
        'Verantwortlich für die Verarbeitung eurer Daten im Sinne der Datenschutz-Grundverordnung (DSGVO) sind Anna und Ben.',
      ),
    ).toBeInTheDocument();
    expect(controller.querySelector('address')?.textContent).toBe(
      'Anna\nBeispielweg 1\n99999 Musterstadt',
    );
    expect(within(controller).getByRole('link', { name: 'anna@example.com' })).toHaveAttribute(
      'href',
      'mailto:anna@example.com',
    );
    expect(
      within(block('Eure Rechte')).getByRole('link', { name: 'anna@example.com' }),
    ).toBeInTheDocument();
  });

  it('covers data, health data, purpose, legal bases, cookies and rights', () => {
    renderPage();
    expect(within(block('Welche Daten wir verarbeiten')).getByText(/Art\. 9 DSGVO/)).toBeVisible();
    expect(within(block('Rechtsgrundlagen')).getAllByRole('listitem')).toHaveLength(4);
    expect(within(block('Rechtsgrundlagen')).getByText(/Art\. 9 Abs\. 2 lit\. a/)).toBeVisible();
    const cookies = block('Cookies und lokaler Speicher');
    expect(
      within(cookies)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('code')?.textContent),
    ).toEqual(['wp_rsvp', 'wp_rsvp_state', 'wp.lang']);
    expect(within(cookies).getByText(/§ 25 Abs\. 2 Nr\. 2 TDDDG/)).toBeVisible();
    expect(within(block('Karten und Links')).getByText(/„Karte anzeigen“/)).toBeVisible();
    const rights = block('Eure Rechte');
    for (const article of ['Art. 15', 'Art. 16', 'Art. 17', 'Art. 7 Abs. 3', 'Art. 77']) {
      expect(rights.textContent).toContain(article);
    }
  });

  it.each([
    [
      'de',
      'Welche Daten wir verarbeiten',
      'Cookies und lokaler Speicher',
      [
        /Wer den Link hat, kann eure Antwort ansehen, ändern und zurückziehen\. Behaltet ihn deshalb für euch\./,
        /Wir speichern davon nur eine Art Fingerabdruck \(einen sogenannten Hash\)/,
        /Teil der Adresse nach dem „#“\. Diesen Teil schicken Browser beim Öffnen nicht an den Server/,
      ],
      /Er wird gesetzt, wenn ihr eure Antwort absendet oder euren persönlichen Link öffnet/,
      /außer euch können das nur wir als Gastgeber\./,
      /nur noch über uns/,
    ],
    [
      'en',
      'What data we process',
      'Cookies and local storage',
      [
        /Anyone who has the link can see, change and withdraw your reply, so please keep it to yourselves\./,
        /We only store a kind of fingerprint of it \(a so-called hash\)/,
        /after the “#”\. Browsers do not send this part to the server/,
      ],
      /It is set when you send your reply or open your personal link/,
      /apart from you, only we as your hosts can change it\./,
      /only we can change a saved reply/,
    ],
    [
      'es',
      'Qué datos tratamos',
      'Cookies y almacenamiento local',
      [
        /Quien tenga el enlace puede ver, cambiar y retirar vuestra respuesta, así que guardadlo para vosotros\./,
        /Solo guardamos una especie de huella de ella \(lo que se llama un hash\)/,
        /sigue a «#»\. Los navegadores no envían esa parte al servidor/,
      ],
      /Se crea al enviar la respuesta o al abrir vuestro enlace personal/,
      /solo podemos cambiarla nosotros como anfitriones\./,
      /solo nosotros podremos cambiar/,
    ],
  ] as const)(
    'explains the personal link and who can change a reply in %s',
    (lang, dataTitle, cookiesTitle, link, cookie, closing, stale) => {
      renderPage({ lang });
      const data = block(dataTitle);
      for (const sentence of link) {
        expect(data.textContent).toMatch(sentence);
      }
      const cookies = block(cookiesTitle);
      expect(cookies.textContent).toMatch(cookie);
      expect(cookies.textContent).toMatch(closing);
      expect(cookies.textContent).not.toMatch(stale);
    },
  );

  it('says that consent for dietary data given outside the form is recorded too', () => {
    renderPage();
    const data = block('Welche Daten wir verarbeiten');
    expect(data.textContent).toContain(
      'Gebt ihr uns solche Angaben auf anderem Weg, zum Beispiel per E-Mail, tragen wir sie nur ein, wenn ihr ausdrücklich zugestimmt habt.',
    );
    expect(data.textContent).not.toContain('nur, wenn ihr im Antwortformular ausdrücklich');
  });

  it('deletes by the last day of the third month after the wedding by default', () => {
    renderPage();
    expect(
      within(block('Wie lange wir Daten speichern')).getByText(
        /Wir löschen alle Antworten und Gästedaten spätestens am 30\. September 2099\./,
      ),
    ).toBeVisible();
  });

  it('uses the configured deletion date and imprint', () => {
    renderPage({
      content: {
        ...content,
        privacy: {
          controllers: [{ name: 'Anna' }],
          email: 'anna@example.com',
          deleteBy: '2099-12-31',
          imprint: { de: 'Anna\nBeispielweg 1, 99999 Musterstadt', en: 'Anna (imprint)' },
        },
      },
      lang: 'en',
    });
    expect(
      screen.getByText(
        'The controller of your data under the General Data Protection Regulation (GDPR) is Anna.',
      ),
    ).toBeVisible();
    expect(screen.getByText(/by December 31, 2099 at the latest/)).toBeVisible();
    const imprint = block('Legal notice');
    expect(imprint).toHaveAttribute('id', 'impressum');
    expect(within(imprint).getByText('Anna (imprint)')).toBeVisible();
    expect(within(imprint).queryByText(/no legal notice/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Photos' })).toBeNull();
  });

  it('says that no imprint is required unless one is configured, and shows extra paragraphs', () => {
    renderPage();
    expect(within(block('Impressum')).getByText(/§ 5 DDG/)).toBeVisible();
    expect(within(block('Fotos')).getByText('Es wird fotografiert.')).toBeVisible();
  });

  it('names the Azure regions and the US transfer basis', () => {
    renderPage();
    const hosting = block('Hosting und Dienstleister');
    expect(hosting.textContent).toContain('East US 2 (Virginia, USA)');
    expect(hosting.textContent).toContain('Germany West Central (Frankfurt am Main, Deutschland)');
    expect(hosting.textContent).toContain('EU-U.S. Data Privacy Framework');
    expect(hosting.textContent).toContain('Application Insights');
    // The pages come from Microsoft's worldwide network; only the interface runs in the app region.
    expect(hosting.textContent).toContain('über ein weltweites Netz von Servern');
    expect(hosting.textContent).toMatch(
      /Die Schnittstelle, die eure Antworten entgegennimmt, läuft in der Azure-Region East US 2/,
    );
    expect(hosting.textContent).toMatch(/dort liegen auch die Sicherungskopien/);
    expect(hosting.textContent).toMatch(/persönlichen Links, Cookies oder IP-Adressen/);
  });

  it('has no transfer paragraph in the EU and the standard clauses elsewhere', () => {
    const { unmount } = renderPage({ regions: { app: 'westeurope', data: 'germanywestcentral' } });
    expect(block('Hosting und Dienstleister').textContent).not.toContain('Art. 46');
    unmount();
    renderPage({ regions: { app: 'eastasia', data: 'somewhere1' } });
    const hosting = block('Hosting und Dienstleister');
    expect(hosting.textContent).toContain('somewhere1');
    expect(hosting.textContent).toContain('Standardvertragsklauseln');
    expect(hosting.textContent).not.toContain('Data Privacy Framework');
  });

  it('falls back to the couple and the contact section without privacy details', () => {
    const { privacy: _, ...withoutPrivacy } = content;
    renderPage({ content: withoutPrivacy });
    expect(
      screen.getByText(/im Sinne der Datenschutz-Grundverordnung \(DSGVO\) ist Anna & Ben\./),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Bei Fragen zum Datenschutz erreicht ihr uns über die Kontaktangaben auf dieser Website.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
    expect(screen.getByText(/30\. September 2099/)).toBeVisible();
  });

  it.each(LANGS)('is complete in %s: every placeholder filled, a back link to the page', (lang) => {
    const { container } = renderPage({ lang });
    expect(container.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(10);
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
  });
});

describe('isPrivacyPath', () => {
  it('matches /datenschutz and /privacy only', () => {
    for (const path of ['/datenschutz', '/datenschutz/', '/privacy', '/Privacy/']) {
      expect(isPrivacyPath(path)).toBe(true);
    }
    for (const path of ['/', '/datenschutz/x', '/admin', '/privacy.html']) {
      expect(isPrivacyPath(path)).toBe(false);
    }
  });
});
