import { privacyDeleteBy, type SiteContent } from '@weddingplanner/content';
import type { ReactNode } from 'react';
import { RSVP_CREDENTIAL_COOKIE, RSVP_STATE_COOKIE } from '../api/rsvp-client.ts';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { fill } from '../fill.tsx';
import { formatDate } from '../format.ts';
import { LANG_STORAGE_KEY, type Lang, t } from '../i18n.ts';
import type { SiteBuild } from '../sections/types.ts';
import { type UiText, ui } from '../ui.ts';
import { privacyText as p } from './privacy-text.ts';
import { regionArea, regionName } from './regions.ts';
import { IMPRINT_ID } from './route.ts';

export type PrivacyPageProps = {
  readonly content: SiteContent;
  readonly regions: SiteBuild['regions'];
  readonly lang: Lang;
};

type BlockProps = { readonly id: string; readonly title: string; readonly children: ReactNode };

function Block({ id, title, children }: BlockProps) {
  return (
    <section id={id} aria-labelledby={`${id}_title`}>
      <h2 id={`${id}_title`}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * The privacy notice (`/datenschutz`): the built-in text in the current language, filled with the
 * instance's controllers, contact email, deletion date and Azure regions, then the instance's extra
 * paragraphs and the imprint (or the note that none is required).
 */
export function PrivacyPage({ content, regions, lang }: PrivacyPageProps) {
  const tx = (text: UiText) => t(text, lang);
  const { privacy } = content;
  // Without privacy details the couple is named; `validate` warns about the missing contact.
  const controllers = privacy?.controllers ?? [{ name: t(content.couple, lang) }];
  const names = new Intl.ListFormat(lang, { type: 'conjunction' }).format(
    controllers.map((controller) => controller.name),
  );
  const email = privacy?.email;
  const mail = email === undefined ? undefined : <a href={`mailto:${email}`}>{email}</a>;
  const deleteBy = formatDate(`${privacyDeleteBy(content)}T12:00:00Z`, lang, 'UTC', 'long');
  const areas = [regionArea(regions.app), regionArea(regions.data)];
  const transfer = areas.includes('other')
    ? p.transferOther
    : areas.includes('us')
      ? p.transferUs
      : undefined;

  return (
    <article className="section privacy" aria-labelledby="privacy_title">
      <p className="privacy-back">
        <a href="/">
          <span aria-hidden="true">←</span> {tx(p.back)}
        </a>
      </p>
      <h1 id="privacy_title">{tx(p.title)}</h1>
      <p className="lead">{tx(p.intro)}</p>

      <Block id="privacy-controller" title={tx(p.controllerTitle)}>
        <p>
          {fill(tx(controllers.length === 1 ? p.controllerOne : p.controllerMany), {
            controllers: names,
          })}
        </p>
        {controllers.map((controller, index) =>
          'address' in controller && controller.address !== undefined ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order
            <address key={index} className="privacy-address">
              {controller.name}
              {'\n'}
              {controller.address}
            </address>
          ) : null,
        )}
        <p>
          {mail === undefined ? tx(p.contactFallback) : fill(tx(p.contactEmail), { email: mail })}
        </p>
      </Block>

      <Block id="privacy-data" title={tx(p.dataTitle)}>
        <p>{tx(p.dataRsvp)}</p>
        <p>{tx(p.dataHealth)}</p>
        <p>{tx(p.editLink)}</p>
        <p>{tx(p.editLinkSecret)}</p>
        <p>{tx(p.dataTechnical)}</p>
      </Block>

      <Block id="privacy-purpose" title={tx(p.purposeTitle)}>
        <p>{tx(p.purpose)}</p>
      </Block>

      <Block id="privacy-legal" title={tx(p.legalTitle)}>
        <ul>
          {p.legal.map((item) => (
            <li key={item.de}>{tx(item)}</li>
          ))}
        </ul>
      </Block>

      <Block id="privacy-hosting" title={tx(p.hostingTitle)}>
        <p>
          {fill(tx(p.hosting), {
            appRegion: regionName(regions.app, lang),
            dataRegion: regionName(regions.data, lang),
          })}
        </p>
        {transfer !== undefined && <p>{tx(transfer)}</p>}
        <p>{tx(p.logs)}</p>
      </Block>

      <Block id="privacy-maps" title={tx(p.mapsTitle)}>
        <p>{fill(tx(p.mapsOsm), { showMap: tx(ui.showMap) })}</p>
        <p>{tx(p.mapsLinks)}</p>
        <p>{tx(p.noTracking)}</p>
      </Block>

      <Block id="privacy-cookies" title={tx(p.cookiesTitle)}>
        <ul>
          <li>
            <code>{RSVP_CREDENTIAL_COOKIE}</code>: {tx(p.cookieRsvp)}
          </li>
          <li>
            <code>{RSVP_STATE_COOKIE}</code>: {tx(p.cookieState)}
          </li>
          <li>
            <code>{LANG_STORAGE_KEY}</code> {tx(p.storageLang)}
          </li>
        </ul>
        <p>{tx(p.cookies)}</p>
      </Block>

      <Block id="privacy-retention" title={tx(p.retentionTitle)}>
        <p>{fill(tx(p.retention), { deleteBy })}</p>
      </Block>

      <Block id="privacy-rights" title={tx(p.rightsTitle)}>
        <p>{tx(p.rights)}</p>
        <p>{tx(p.withdraw)}</p>
        <p>
          {mail === undefined ? tx(p.rightsFallback) : fill(tx(p.rightsEmail), { email: mail })}
        </p>
        <p>{tx(p.complaint)}</p>
      </Block>

      {privacy?.extra?.map((block, index) => {
        const id = `privacy-extra-${index + 1}`;
        const title = t(block.title, lang);
        return title === '' ? (
          <section key={id} id={id}>
            <Paragraphs text={t(block.text, lang)} />
          </section>
        ) : (
          <Block key={id} id={id} title={title}>
            <Paragraphs text={t(block.text, lang)} />
          </Block>
        );
      })}

      <Block id={IMPRINT_ID} title={tx(p.imprintTitle)}>
        {privacy?.imprint === undefined ? (
          <p>{tx(p.noImprint)}</p>
        ) : (
          <Paragraphs className="privacy-imprint" text={t(privacy.imprint, lang)} />
        )}
      </Block>
    </article>
  );
}
