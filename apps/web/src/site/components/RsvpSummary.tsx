import { useEffect, useRef, useState } from 'react';
import type { RsvpView } from '../api/rsvp-client.ts';
import { type Lang, t } from '../i18n.ts';
import { isDiet } from '../rsvp-reply.ts';
import { ui } from '../ui.ts';

const r = ui.rsvp;

export type RsvpSummaryProps = {
  readonly rsvp: RsvpView;
  readonly lang: Lang;
  /** After the deadline: no change or withdraw buttons. */
  readonly readOnly: boolean;
  readonly busy: boolean;
  /** Moves focus to the thank-you line when shown after a guest's action (never on page load). */
  readonly focusOnMount: boolean;
  readonly onEdit: () => void;
  readonly onWithdraw: () => void;
};

/** Dietary tags and note of one person, e.g. "Vegetarian, Lactose-free · No nuts". */
function dietaryText(person: RsvpView['people'][number], lang: Lang): string {
  const tags = person.dietary.tags.filter(isDiet).map((tag) => t(r[tag], lang));
  return [tags.join(', '), person.dietary.note ?? ''].filter((part) => part !== '').join(' · ');
}

/** The thank-you after a reply: who comes (or not), dietary needs, the message, change/withdraw. */
export function RsvpSummary(props: RsvpSummaryProps) {
  const { rsvp, lang, readOnly, busy, focusOnMount, onEdit, onWithdraw } = props;
  const [confirming, setConfirming] = useState(false);
  const thanks = useRef<HTMLParagraphElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);
  const [focusFirst] = useState(focusOnMount);

  useEffect(() => {
    if (focusFirst) {
      thanks.current?.focus();
    }
  }, [focusFirst]);

  // The button that was clicked disappears: keep the focus in the same place.
  const toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) {
      (confirming ? cancel : withdrawButton).current?.focus();
    }
  }, [confirming]);

  const confirm = (open: boolean) => {
    toggled.current = true;
    setConfirming(open);
  };

  return (
    <div className="thanks">
      <p className="lead" tabIndex={-1} ref={thanks}>
        {t(rsvp.attending ? r.thanksYes : r.thanksNo, lang)}
      </p>
      <dl className="rsvp-summary">
        <dt>{t(rsvp.attending ? r.coming : r.notComing, lang)}</dt>
        <dd>
          <ul>
            {rsvp.people.map((person, index) => {
              const dietary = rsvp.attending ? dietaryText(person, lang) : '';
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; the list is static
                <li key={index}>
                  <span className="rsvp-name">{person.name}</span>
                  {dietary !== '' && <span className="rsvp-diet">{dietary}</span>}
                </li>
              );
            })}
          </ul>
        </dd>
        {rsvp.message !== undefined && rsvp.message !== '' && (
          <>
            <dt>{t(r.yourMessage, lang)}</dt>
            <dd className="rsvp-message">{rsvp.message}</dd>
          </>
        )}
      </dl>
      {!readOnly &&
        (confirming ? (
          <div className="rsvp-confirm">
            <p className="rsvp-confirm-text">{t(r.withdrawConfirm, lang)}</p>
            <div className="row center">
              <button
                type="button"
                className="btn ghost"
                ref={cancel}
                onClick={() => confirm(false)}
              >
                {t(r.cancel, lang)}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={onWithdraw}>
                {t(r.withdrawYes, lang)}
              </button>
            </div>
          </div>
        ) : (
          <div className="row center">
            <button type="button" className="btn" onClick={onEdit}>
              {t(r.change, lang)}
            </button>
            <button
              type="button"
              className="btn ghost"
              ref={withdrawButton}
              onClick={() => confirm(true)}
            >
              {t(r.withdraw, lang)}
            </button>
          </div>
        ))}
    </div>
  );
}
