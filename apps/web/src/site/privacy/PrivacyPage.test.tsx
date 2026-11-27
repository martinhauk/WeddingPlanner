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
        /Später könnt ihr ihn euch auf der Einladungsseite bei eurer Antwort noch einmal anzeigen lassen, in dem Browser, mit dem ihr geantwortet oder den Link geöffnet habt\./,
        /Wer den Link hat, kann eure Antwort ansehen, ändern und zurückziehen\. Behaltet ihn deshalb für euch\./,
        /Wir speichern davon nur eine Art Fingerabdruck \(einen sogenannten Hash\)/,
        /Teil der Adresse nach dem „#“\. Diesen Teil schicken Browser beim Öffnen nicht an den Server/,
      ],
      [
        /Er wird gesetzt, wenn ihr eure Antwort absendet oder euren persönlichen Link öffnet; hat dieser Browser schon eine andere Antwort/,
        /in diesem Browser oder mit eurem persönlichen Link; außer euch \(und allen, die euren Link haben\) können das nur wir als Gastgeber\./,
      ],
      /nur noch über uns|auf dieser Seite|Gerät/,
    ],
    [
      'en',
      'What data we process',
      'Cookies and local storage',
      [
        /You can show it again later in the reply section of the invitation page, in the browser you used to reply or to open the link\./,
        /Anyone who has the link can see, change and withdraw your reply, so please keep it to yourselves\./,
        /We only store a kind of fingerprint of it \(a so-called hash\)/,
        /after the “#”\. Browsers do not send this part to the server/,
      ],
      [
        /It is set when you send your reply or open your personal link; if this browser already has another reply/,
        /in this browser or with your personal link; apart from you \(and anyone who has your link\), only we as your hosts can change it\./,
      ],
      /only we can change a saved reply|on this page|device|with your reply,/,
    ],
    [
      'es',
      'Qué datos tratamos',
      'Cookies y almacenamiento local',
      [
        /Más tarde podéis volver a mostrarlo junto a vuestra respuesta en la página de la invitación, desde el navegador con el que respondisteis o abristeis el enlace\./,
        /Quien tenga el enlace puede ver, cambiar y retirar vuestra respuesta, así que no lo compartáis con nadie\./,
        /Solo guardamos una especie de huella de ella \(lo que se llama un hash\)/,
        /sigue a «#»\. Los navegadores no envían esa parte al servidor/,
      ],
      [
        /Se crea al enviar la respuesta o al abrir vuestro enlace personal; si este navegador ya tiene otra respuesta/,
        /en este navegador o con vuestro enlace personal; aparte de vosotros \(y de quien tenga vuestro enlace\), solo podemos cambiarla nosotros como anfitriones\./,
      ],
      /solo nosotros podremos cambiar|en esta página|dispositivo/,
    ],
  ] as const)(
    'explains the personal link and who can change a reply in %s',
    (lang, dataTitle, cookiesTitle, link, cookie, stale) => {
      renderPage({ lang });
      const data = block(dataTitle);
      for (const sentence of link) {
        expect(data.textContent).toMatch(sentence);
      }
      const cookies = block(cookiesTitle);
      for (const sentence of cookie) {
        expect(cookies.textContent).toMatch(sentence);
      }
      // Cookies belong to a browser, and the link is shown again on the invitation, not here.
      expect(data.textContent).not.toMatch(stale);
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

  it.each([
    [
      'de',
      'Welche Daten wir verarbeiten',
      'Wir halten fest, dass und wann eingewilligt wurde und ob im Formular oder direkt bei uns.',
    ],
    [
      'en',
      'What data we process',
      'We record that consent was given, when, and whether in the form or directly to us.',
    ],
    [
      'es',
      'Qué datos tratamos',
      'Dejamos constancia de que se dio el consentimiento, de cuándo y de si fue en el formulario o directamente a nosotros.',
    ],
  ] as const)('says how the consent is recorded in %s', (lang, dataTitle, sentence) => {
    renderPage({ lang });
    expect(block(dataTitle).textContent).toContain(sentence);
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

  /** The paragraph after the hosting paragraph: the transfer outside the EU. */
  const transferParagraph = (title: string) =>
    block(title).querySelectorAll('p')[1]?.textContent ?? '';

  it.each([
    [
      'de',
      'Hosting und Dienstleister',
      'Zum weltweiten Netz von Microsoft gehören auch Server außerhalb der EU, zum Beispiel in den USA. Eure Angaben können deshalb auch dorthin übermittelt werden. Microsoft ist nach dem EU-U.S. Data Privacy Framework zertifiziert, für das ein Angemessenheitsbeschluss der EU-Kommission besteht (Art. 45 DSGVO). Für jede Übermittlung in ein Land außerhalb der EU gelten außerdem die Standardvertragsklauseln der EU-Kommission (Art. 46 DSGVO). Die Klauseln findet ihr auf der Website der EU-Kommission, unseren Vertrag mit Microsoft im Data Protection Addendum und die Zertifizierung von Microsoft in der Liste des Data Privacy Framework.',
    ],
    [
      'en',
      'Hosting and service providers',
      'Microsoft’s worldwide network also includes servers outside the EU, for example in the USA, so your details may be transferred there as well. Microsoft is certified under the EU-U.S. Data Privacy Framework, which is covered by an adequacy decision of the European Commission (Art. 45 GDPR). In addition, the European Commission’s standard contractual clauses apply to every transfer to a country outside the EU (Art. 46 GDPR). You can find the clauses on the website of the European Commission, our contract with Microsoft in the Data Protection Addendum and Microsoft’s certification on the Data Privacy Framework list.',
    ],
    [
      'es',
      'Alojamiento y proveedores',
      'La red mundial de Microsoft incluye también servidores fuera de la UE, por ejemplo en EE. UU., así que vuestros datos también pueden transferirse allí. Microsoft está certificada conforme al Marco de Privacidad de Datos UE-EE. UU., cubierto por una decisión de adecuación de la Comisión Europea (art. 45 RGPD). Además, para cualquier transferencia a un país fuera de la UE se aplican las cláusulas contractuales tipo de la Comisión Europea (art. 46 RGPD). Podéis encontrar las cláusulas en la web de la Comisión Europea, nuestro contrato con Microsoft en el Data Protection Addendum y la certificación de Microsoft en la lista del Marco de Privacidad de Datos.',
    ],
  ] as const)(
    'always has the transfer paragraph, also with both regions in the EU (%s)',
    (lang, title, paragraph) => {
      renderPage({ regions: { app: 'westeurope', data: 'germanywestcentral' }, lang });
      // The worldwide network delivers the pages from outside the EU too; no region is named.
      expect(transferParagraph(title)).toBe(paragraph);
    },
  );

  it.each([
    [
      'de',
      'Hosting und Dienstleister',
      'Die Azure-Region East US 2 (Virginia, USA) liegt ebenfalls außerhalb der EU; dorthin werden eure Antworten in jedem Fall übermittelt. Microsoft ist nach dem EU-U.S. Data Privacy Framework zertifiziert',
    ],
    [
      'en',
      'Hosting and service providers',
      'The Azure region East US 2 (Virginia, USA) is also outside the EU, and your replies are always sent there. Microsoft is certified under the EU-U.S. Data Privacy Framework',
    ],
    [
      'es',
      'Alojamiento y proveedores',
      'La región de Azure East US 2 (Virginia, EE. UU.) también está fuera de la UE, y vuestras respuestas se envían allí en todo caso. Microsoft está certificada conforme al Marco de Privacidad de Datos UE-EE. UU.',
    ],
  ] as const)(
    'names an API region in the USA in the transfer paragraph (%s)',
    (lang, title, text) => {
      renderPage({ regions: { app: 'eastus2', data: 'germanywestcentral' }, lang });
      const paragraph = transferParagraph(title);
      expect(paragraph).toContain(text);
      expect(paragraph).toMatch(/(Art\.|art\.) 46/);
      expect(paragraph).not.toContain('Germany West Central');
    },
  );

  const SCC_PAGE =
    'https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_';
  const DPA_PAGE =
    'https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA';
  const DPF_LIST = 'https://www.dataprivacyframework.gov/list';

  it.each([
    [
      'de',
      'Hosting und Dienstleister',
      [
        ['EU-Kommission', `${SCC_PAGE}de`],
        ['Data Protection Addendum', DPA_PAGE],
        ['Liste des Data Privacy Framework', DPF_LIST],
      ],
    ],
    [
      'en',
      'Hosting and service providers',
      [
        ['European Commission', `${SCC_PAGE}en`],
        ['Data Protection Addendum', DPA_PAGE],
        ['Data Privacy Framework list', DPF_LIST],
      ],
    ],
    [
      'es',
      'Alojamiento y proveedores',
      [
        ['Comisión Europea', `${SCC_PAGE}es`],
        ['Data Protection Addendum', DPA_PAGE],
        ['lista del Marco de Privacidad de Datos', DPF_LIST],
      ],
    ],
  ] as const)(
    'links where the safeguards are published, in a new tab without a referrer (%s)',
    (lang, title, expected) => {
      renderPage({ regions: { app: 'eastus2', data: 'germanywestcentral' }, lang });
      const paragraph = block(title).querySelectorAll('p')[1];
      if (paragraph === undefined) throw new Error('no transfer paragraph');
      const links = within(paragraph).getAllByRole('link');
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual(expected);
      for (const link of links) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      // The links close the paragraph, after the legal basis.
      expect(paragraph.textContent).toMatch(/\((Art\.|art\.) 46 [^)]+\)\. \S.*\.$/);
    },
  );

  it('names every region outside the EU once', () => {
    const { unmount } = renderPage({ regions: { app: 'eastasia', data: 'somewhere1' } });
    expect(transferParagraph('Hosting und Dienstleister')).toContain(
      'Die Azure-Regionen East Asia (Hongkong) und somewhere1 liegen ebenfalls außerhalb der EU;',
    );
    unmount();
    renderPage({ regions: { app: 'eastus2', data: 'eastus2' }, lang: 'en' });
    const paragraph = transferParagraph('Hosting and service providers');
    expect(paragraph).toContain(
      'The Azure region East US 2 (Virginia, USA) is also outside the EU',
    );
    expect(paragraph.match(/East US 2/g)).toHaveLength(1);
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
