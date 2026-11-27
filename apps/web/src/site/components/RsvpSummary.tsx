import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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
  /** The personal edit link of the reply, shown with a copy button. */
  readonly editLink?: string | null;
  /**
   * Show the link at once (right after the reply was created); otherwise a "show your personal
   * link" button reveals it.
   */
  readonly editLinkShown?: boolean;
  readonly onEdit: () => void;
  readonly onWithdraw: () => void;
};

/** Dietary tags and note of one person, e.g. "Vegetarian, Lactose-free · No nuts". */
function dietaryText(person: RsvpView['people'][number], lang: Lang): string {
  const tags = person.dietary.tags.filter(isDiet).map((tag) => t(r[tag], lang));
  return [tags.join(', '), person.dietary.note ?? ''].filter((part) => part !== '').join(' · ');
}

/**
 * The personal edit link: a read-only field, a copy button and a hint to keep it. Without the
 * Clipboard API (older in-app browsers) or when copying fails, the link is selected for the guest to
 * copy by hand.
 */
export function RsvpEditLink({
  link,
  lang,
  focusOnMount = false,
}: {
  readonly link: string;
  readonly lang: Lang;
  /** Moves focus to the link (and selects it) when shown on request. */
  readonly focusOnMount?: boolean;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [focusFirst] = useState(focusOnMount);

  useEffect(() => {
    if (focusFirst) {
      field.current?.focus();
    }
  }, [focusFirst]);

  const copy = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopied(false);
    }
  };

  return (
    <form className="rsvp-link" onSubmit={(event) => void copy(event)}>
      <label htmlFor={id}>{t(r.editLinkTitle, lang)}</label>
      <input
        id={id}
        ref={field}
        type="text"
        readOnly
        value={link}
        aria-describedby={`${id}-hint`}
        onFocus={(event) => event.currentTarget.select()}
      />
      <p className="rsvp-privacy" id={`${id}-hint`}>
        {t(r.editLinkHint, lang)}
      </p>
      <div>
        <button type="submit" className="btn small">
          {t(r.copyLink, lang)}
        </button>
      </div>
      <p className="rsvp-privacy" role="status">
        {copied === null ? '' : t(copied ? r.linkCopied : r.copyFailed, lang)}
      </p>
    </form>
  );
}

/** The thank-you after a reply: who comes (or not), dietary needs, the message, change/withdraw. */
export function RsvpSummary(props: RsvpSummaryProps) {
  const { rsvp, lang, readOnly, busy, focusOnMount, editLink, editLinkShown, onEdit, onWithdraw } =
    props;
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const link = editLink ?? null;
  const linkVisible = link !== null && (editLinkShown === true || revealed);
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
      {linkVisible && <RsvpEditLink link={link} lang={lang} focusOnMount={revealed} />}
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
      {link !== null && !linkVisible && (
        <div className="row center rsvp-show-link">
          <button type="button" className="btn ghost small" onClick={() => setRevealed(true)}>
            {t(r.showLink, lang)}
          </button>
        </div>
      )}
    </div>
  );
}
