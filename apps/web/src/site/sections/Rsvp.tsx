import { type FormEvent, useState } from 'react';
import { Paragraphs } from '../components/Paragraphs.tsx';
import { RsvpForm } from '../components/RsvpForm.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { formatDeadline } from '../format.ts';
import { t } from '../i18n.ts';
import { emptyPerson, loadReply, normalizeReply, type Reply, storeReply } from '../rsvp-reply.ts';
import { ui } from '../ui.ts';
import type { SectionProps } from './types.ts';

const r = ui.rsvp;

/** The RSVP section: yes/no, then the reply form; afterwards a confirmation with a change button. */
export function Rsvp({ section, ctx }: SectionProps<'rsvp'>) {
  const { lang, content, build } = ctx;
  const [saved, setSaved] = useState<Reply | null>(loadReply);
  const [draft, setDraft] = useState<Reply | null>(null);

  const start = (attending: boolean) =>
    setDraft(
      saved !== null
        ? { ...saved, attending }
        : { attending, people: [emptyPerson()], message: '', savedAt: '' },
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) {
      return;
    }
    // TODO(rsvp-api): POST the reply once the RSVP API is wired up; until then it stays local.
    const reply = normalizeReply(draft, new Date());
    storeReply(reply);
    setSaved(reply);
    setDraft(null);
  };

  return (
    <SectionFrame section={section} lang={lang}>
      {section.data.intro !== undefined && (
        <Paragraphs className="lead" text={t(section.data.intro, lang)} />
      )}
      <p className="muted">
        {t(r.deadline, lang)} {formatDeadline(content, build, lang)}
      </p>
      {draft !== null ? (
        <RsvpForm
          draft={draft}
          lang={lang}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSubmit={submit}
        />
      ) : saved !== null ? (
        <div className="thanks" aria-live="polite">
          <p className="lead">{t(saved.attending ? r.thanksYes : r.thanksNo, lang)}</p>
          <p>{saved.people.map((p) => p.name).join(', ')}</p>
          <button type="button" className="btn ghost" onClick={() => setDraft(saved)}>
            {t(r.change, lang)}
          </button>
        </div>
      ) : (
        <div className="row center">
          <button type="button" className="btn" onClick={() => start(true)}>
            {t(r.yes, lang)}
          </button>
          <button type="button" className="btn ghost" onClick={() => start(false)}>
            {t(r.no, lang)}
          </button>
        </div>
      )}
    </SectionFrame>
  );
}
