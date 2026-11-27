import type { SiteContent } from '@weddingplanner/content';
import { useEffect, useRef } from 'react';
import type { ApiFailure } from '../api/rsvp-client.ts';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { RsvpAlert } from '../components/RsvpAlert.tsx';
import { type ContactLink, RsvpContactHint } from '../components/RsvpContactHint.tsx';
import { RsvpForm } from '../components/RsvpForm.tsx';
import { RsvpSummary } from '../components/RsvpSummary.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { formatDeadline } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { type RsvpNotice, useRsvp } from '../use-rsvp.ts';
import { isShown, navLabel } from './titles.ts';
import type { SectionProps } from './types.ts';

const r = ui.rsvp;

const NOTICES = {
  withdrawn: r.withdrawn,
  alreadyAnswered: r.alreadyAnswered,
  conflict: r.conflict,
  replyGone: r.replyGone,
  claimed: r.claimed,
  linkInvalid: r.linkInvalid,
} as const satisfies Record<RsvpNotice, unknown>;

function failureText(failure: ApiFailure, lang: Lang): string {
  const e = ui.rsvpError;
  switch (failure.kind) {
    case 'validation':
      return t(e.validation, lang);
    case 'closed':
      return t(e.closed, lang);
    case 'rateLimited':
      return t(e.rateLimited, lang);
    case 'network':
      return t(e.network, lang);
    case 'full':
      return t(e.full, lang);
    default:
      return t(e.unavailable, lang);
  }
}

/** The page's first shown contact section: the fallback when replying online fails. */
function contactLink(content: SiteContent, lang: Lang): ContactLink | undefined {
  const section = content.sections.find((s) => s.type === 'contact' && isShown(s));
  return section === undefined ? undefined : { id: section.id, label: navLabel(section, lang) };
}

/**
 * The RSVP section: yes/no, then the reply form; afterwards a thank-you with the reply and buttons
 * to change or withdraw it. Talks to the RSVP API only once the section is near the viewport or a
 * button is pressed. With `features.rsvp` off it shows an "opens soon" note and calls nothing.
 */
export function Rsvp({ section, ctx }: SectionProps<'rsvp'>) {
  const { lang, content, build } = ctx;
  const enabled = build.features.rsvp;
  const anchor = useRef<HTMLDivElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLParagraphElement>(null);
  const rsvp = useRsvp({ enabled, lang, deadline: build.rsvpDeadline, anchor });
  const { phase, mine, closed, closedByApi, interacted } = rsvp;
  const contact = contactLink(content, lang);
  const deadline = formatDeadline(content, build, lang);

  // Back at the buttons after an action (withdrawn, cancelled): focus the first one.
  useEffect(() => {
    if (phase.kind === 'choose' && interacted) {
      yes.current?.focus();
    }
  }, [phase.kind, interacted]);

  // The API closed replies during an action: its buttons are gone, so focus the note instead.
  useEffect(() => {
    if (closedByApi) {
      note.current?.focus();
    }
  }, [closedByApi]);

  const intro = section.data.intro !== undefined && (
    <Paragraphs className="lead" text={t(section.data.intro, lang)} />
  );

  if (!enabled) {
    return (
      <SectionFrame section={section} lang={lang}>
        {intro}
        <p className="rsvp-note">{t(r.opensSoon, lang)}</p>
        <p className="muted">
          {t(r.deadline, lang)} {deadline}
        </p>
      </SectionFrame>
    );
  }

  const errorAlert = rsvp.error !== null && (
    <RsvpAlert
      message={failureText(rsvp.error, lang)}
      lang={lang}
      contact={contact}
      withContact={rsvp.error.kind !== 'validation'}
    />
  );
  const answered = t(rsvp.stored === 'no' ? r.answeredNo : r.answeredYes, lang);

  const body = () => {
    switch (phase.kind) {
      case 'stored':
        return (
          <div className="thanks">
            <p className="lead">{answered}</p>
            {rsvp.active ? (
              <p className="muted" role="status">
                {t(r.loading, lang)}
              </p>
            ) : (
              <button type="button" className="btn ghost" onClick={rsvp.reveal}>
                {t(r.showReply, lang)}
              </button>
            )}
          </div>
        );
      case 'claiming':
        return (
          <div className="thanks">
            {rsvp.active ? (
              <p className="muted" role="status">
                {t(r.claiming, lang)}
              </p>
            ) : (
              <button type="button" className="btn ghost" onClick={rsvp.reveal}>
                {t(r.showReply, lang)}
              </button>
            )}
          </div>
        );
      case 'loadFailed':
        return (
          <div className="thanks">
            {rsvp.stored !== null && <p className="lead">{answered}</p>}
            <RsvpAlert
              message={failureText(phase.error, lang)}
              lang={lang}
              contact={contact}
              withContact
            />
            <button type="button" className="btn ghost" onClick={rsvp.retry}>
              {t(r.retry, lang)}
            </button>
          </div>
        );
      case 'form':
        return (
          <RsvpForm
            draft={phase.draft}
            lang={lang}
            limits={rsvp.limits}
            busy={rsvp.busy}
            fieldErrors={rsvp.fieldErrors}
            alert={errorAlert}
            onChange={rsvp.change}
            onCancel={rsvp.cancel}
            onSubmit={(website) => void rsvp.submit(website)}
          />
        );
      case 'saved':
        return (
          mine !== null && (
            <>
              <RsvpSummary
                rsvp={mine.rsvp}
                lang={lang}
                readOnly={closed}
                busy={rsvp.busy}
                focusOnMount={interacted}
                editLink={rsvp.editLink}
                onEdit={rsvp.edit}
                onWithdraw={() => void rsvp.withdraw()}
              />
              {closed && (
                <>
                  <p className="rsvp-note" tabIndex={-1} ref={note}>
                    {t(r.readOnly, lang)}
                  </p>
                  <RsvpContactHint contact={contact} lang={lang} />
                </>
              )}
              {errorAlert}
            </>
          )
        );
      default:
        if (closed || rsvp.full || rsvp.unavailable) {
          const e = ui.rsvpError;
          return (
            <>
              <p className="rsvp-note" tabIndex={-1} ref={note}>
                {t(closed ? e.closed : rsvp.full ? e.full : e.unavailable, lang)}
              </p>
              <RsvpContactHint contact={contact} lang={lang} />
            </>
          );
        }
        return (
          <>
            <div className="row center">
              <button type="button" className="btn" ref={yes} onClick={() => rsvp.start(true)}>
                {t(r.yes, lang)}
              </button>
              <button type="button" className="btn ghost" onClick={() => rsvp.start(false)}>
                {t(r.no, lang)}
              </button>
            </div>
            {errorAlert}
          </>
        );
    }
  };

  return (
    <SectionFrame section={section} lang={lang}>
      {intro}
      <div ref={anchor} className="rsvp">
        <p className="muted">
          {t(closed ? r.deadlinePassed : r.deadline, lang)} {deadline}
        </p>
        <div className="rsvp-live" aria-live="polite">
          {rsvp.notice !== null && <p className="rsvp-notice">{t(NOTICES[rsvp.notice], lang)}</p>}
        </div>
        {body()}
      </div>
    </SectionFrame>
  );
}
