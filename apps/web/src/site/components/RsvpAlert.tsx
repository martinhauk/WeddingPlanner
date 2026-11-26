import type { Lang } from '../i18n.ts';
import { type ContactLink, RsvpContactHint } from './RsvpContactHint.tsx';

export type RsvpAlertProps = {
  readonly message: string;
  readonly lang: Lang;
  /** Shows the contact fallback below the message. */
  readonly contact?: ContactLink | undefined;
  readonly withContact?: boolean;
};

/** An error of the RSVP section, announced to screen readers, with the contact fallback. */
export function RsvpAlert({ message, lang, contact, withContact = false }: RsvpAlertProps) {
  return (
    <div className="rsvp-alert" role="alert">
      <p className="rsvp-alert-text">{message}</p>
      {withContact && <RsvpContactHint contact={contact} lang={lang} />}
    </div>
  );
}
