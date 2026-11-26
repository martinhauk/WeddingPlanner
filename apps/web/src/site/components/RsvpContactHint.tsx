import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';

/** The page's contact section, the fallback when replying online does not work. */
export type ContactLink = { readonly id: string; readonly label: string };

export type RsvpContactHintProps = {
  readonly contact: ContactLink | undefined;
  readonly lang: Lang;
};

/** "You can also let us know directly", linked to the contact section when the page has one. */
export function RsvpContactHint({ contact, lang }: RsvpContactHintProps) {
  return (
    <p className="rsvp-contact">
      {t(ui.rsvp.contactHint, lang)}
      {contact === undefined ? (
        '.'
      ) : (
        <>
          : <a href={`#${contact.id}`}>{contact.label}</a>
        </>
      )}
    </p>
  );
}
