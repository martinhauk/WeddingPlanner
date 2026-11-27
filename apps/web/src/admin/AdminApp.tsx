import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AdminApi,
  type AdminFailureKind,
  type AdminList,
  type AdminResult,
  type AdminRsvp,
  type AdminRsvpUpdate,
  DIETARY_CONSENT_FIELD,
  EXPORT_CSV_URL,
  LOGIN_URL,
  LOGOUT_URL,
} from './api.ts';
import { RsvpEditor } from './RsvpEditor.tsx';
import { RsvpTable, replyNames } from './RsvpTable.tsx';
import { de } from './strings.ts';
import { TotalsCards } from './TotalsCards.tsx';

export type AdminAppProps = {
  readonly api: AdminApi;
  /** Time zone for dates (the wedding's, from the baked build info). */
  readonly timeZone: string;
  /** Asks before deleting; defaults to `window.confirm`. */
  readonly confirm?: (message: string) => boolean;
};

type View =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly kind: AdminFailureKind }
  | { readonly state: 'loaded'; readonly list: AdminList };

type Notice = { readonly tone: 'info' | 'error'; readonly text: string };

const defaultConfirm = (message: string) => window.confirm(message);

/** The admin overview: totals, the table of replies, edit and delete, and the CSV download. */
export function AdminApp({ api, timeZone, confirm = defaultConfirm }: AdminAppProps) {
  const [view, setView] = useState<View>({ state: 'loading' });
  const [editing, setEditing] = useState<AdminRsvp | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /**
   * The body of the open editor's last save that the API refused for want of the dietary consent
   * attestation; set only once that answer is in, so a save still in flight never shows it.
   */
  const [consentRefused, setConsentRefused] = useState<AdminRsvpUpdate | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const result = await api.list();
    if (!mounted.current) {
      return;
    }
    setView(
      result.ok
        ? { state: 'loaded', list: result.data }
        : { state: 'failed', kind: result.kind === 'not_found' ? 'disabled' : result.kind },
    );
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Shared handling of an edit or delete result; returns whether it succeeded. */
  const settle = async (result: AdminResult<unknown>, success: string): Promise<boolean> => {
    if (result.ok) {
      setNotice({ tone: 'info', text: success });
      await load();
      return true;
    }
    switch (result.kind) {
      case 'unauthorized':
      case 'forbidden':
        setView({ state: 'failed', kind: result.kind });
        return false;
      case 'conflict':
        setNotice({ tone: 'error', text: de.conflict });
        setEditing(null);
        await load();
        return false;
      case 'not_found':
        setNotice({ tone: 'error', text: de.gone });
        setEditing(null);
        await load();
        return false;
      case 'invalid':
        setNotice({
          tone: 'error',
          text: result.fields?.includes(DIETARY_CONSENT_FIELD) ? de.consentRequired : de.invalid,
        });
        return false;
      default:
        setNotice({ tone: 'error', text: de.actionFailed });
        return false;
    }
  };

  const save = async (rsvp: AdminRsvp, body: AdminRsvpUpdate) => {
    setBusy(true);
    setNotice(null);
    const result = await api.update(rsvp.id, rsvp.version, body);
    const refused =
      !result.ok && result.kind === 'invalid' && !!result.fields?.includes(DIETARY_CONSENT_FIELD);
    setConsentRefused(refused ? body : null);
    if (await settle(result, de.saved)) {
      setEditing(null);
    }
    setBusy(false);
  };

  const remove = async (rsvp: AdminRsvp) => {
    if (!confirm(de.confirmDelete(replyNames(rsvp)))) {
      return;
    }
    setBusy(true);
    setNotice(null);
    await settle(await api.remove(rsvp.id, rsvp.version), de.deleted);
    setBusy(false);
  };

  return (
    <div className="admin">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">{de.subtitle}</p>
          <h1>{de.title}</h1>
        </div>
        <nav className="admin-nav">
          {view.state === 'loaded' && (
            <a className="button primary" href={EXPORT_CSV_URL} download>
              {de.downloadCsv}
            </a>
          )}
          <a className="button" href={LOGOUT_URL}>
            {de.logout}
          </a>
        </nav>
      </header>

      <main>
        {view.state === 'loading' && <p role="status">{de.loading}</p>}
        {view.state === 'failed' && <Failure kind={view.kind} onRetry={() => void load()} />}
        {view.state === 'loaded' && (
          <>
            {notice !== null && (
              <p
                className={`admin-notice ${notice.tone}`}
                role={notice.tone === 'error' ? 'alert' : 'status'}
              >
                {notice.text}
              </p>
            )}
            <TotalsCards totals={view.list.totals} />
            {editing !== null && (
              <RsvpEditor
                key={`${editing.id}-${editing.version}`}
                rsvp={editing}
                saving={busy}
                consentRefused={consentRefused ?? undefined}
                onSave={(body) => void save(editing, body)}
                onCancel={() => {
                  setConsentRefused(null);
                  setEditing(null);
                }}
              />
            )}
            <RsvpTable
              rsvps={view.list.rsvps}
              timeZone={timeZone}
              busy={busy}
              onEdit={(rsvp) => {
                setNotice(null);
                setConsentRefused(null);
                setEditing(rsvp);
              }}
              onDelete={(rsvp) => void remove(rsvp)}
            />
          </>
        )}
      </main>
    </div>
  );
}

/** Friendly panels for 401, 403, a disabled admin feature and other failures. */
function Failure({
  kind,
  onRetry,
}: {
  readonly kind: AdminFailureKind;
  readonly onRetry: () => void;
}) {
  switch (kind) {
    case 'unauthorized':
      return (
        <section className="admin-panel" role="alert">
          <h2>{de.unauthorizedTitle}</h2>
          <p>{de.unauthorized}</p>
          <a className="button primary" href={LOGIN_URL}>
            {de.login}
          </a>
        </section>
      );
    case 'forbidden':
      return (
        <section className="admin-panel" role="alert">
          <h2>{de.forbiddenTitle}</h2>
          <p>{de.forbidden}</p>
          <a className="button primary" href={LOGOUT_URL}>
            {de.logout}
          </a>
        </section>
      );
    case 'disabled':
      return (
        <section className="admin-panel" role="alert">
          <h2>{de.disabledTitle}</h2>
          <p>{de.disabled}</p>
        </section>
      );
    default:
      return (
        <section className="admin-panel" role="alert">
          <h2>{de.unavailableTitle}</h2>
          <p>{de.unavailable}</p>
          <button type="button" className="primary" onClick={onRetry}>
            {de.reload}
          </button>
        </section>
      );
  }
}
