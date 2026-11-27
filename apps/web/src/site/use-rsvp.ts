import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  type ApiFailure,
  claimRsvp,
  createRsvp,
  deleteRsvp,
  editLinkFor,
  type FieldError,
  getMine,
  getStatus,
  parseEditLink,
  RSVP_STATE_EVENT,
  type RsvpCreated,
  type RsvpLimits,
  type RsvpMine,
  type RsvpState,
  type RsvpStatus,
  readRsvpState,
  updateRsvp,
} from './api/rsvp-client.ts';
import type { Lang } from './i18n.ts';
import {
  formLimits,
  newReply,
  type Reply,
  replyFromView,
  toRequest,
  validateReply,
} from './rsvp-reply.ts';
import { useNearViewport } from './use-near-viewport.ts';

/** What the section shows. The own reply (`mine`) is kept next to it. */
export type RsvpPhase =
  /** No reply in this browser: the yes/no buttons. */
  | { readonly kind: 'choose' }
  /** The state cookie says there is a reply; it loads once the section is near the viewport. */
  | { readonly kind: 'stored' }
  /** The page was opened with a personal edit link; it is claimed once the section is near. */
  | { readonly kind: 'claiming' }
  | { readonly kind: 'loadFailed'; readonly error: ApiFailure }
  | { readonly kind: 'form'; readonly mode: 'create' | 'edit'; readonly draft: Reply }
  /** The thank-you with the own reply. */
  | { readonly kind: 'saved' };

/** Short messages after an action (announced politely). */
export type RsvpNotice =
  | 'withdrawn'
  | 'alreadyAnswered'
  | 'conflict'
  | 'replyGone'
  /** An edit link moved the reply into this browser. */
  | 'claimed'
  /** An edit link that is wrong, incomplete or of a withdrawn reply (never says which). */
  | 'linkInvalid';

export type UseRsvpOptions = {
  /** `features.rsvp` of the build: when off, nothing is read and nothing is called. */
  readonly enabled: boolean;
  readonly lang: Lang;
  /** The enforced deadline (UTC ISO), from `build.json`. */
  readonly deadline: string;
  /** Element whose visibility starts the first API call. */
  readonly anchor: RefObject<Element | null>;
};

export type UseRsvp = {
  readonly phase: RsvpPhase;
  /** The state cookie as it was when the page loaded. */
  readonly stored: RsvpState | null;
  readonly mine: RsvpMine | null;
  /**
   * The personal edit link of the reply this page has just created (shown until it is withdrawn);
   * `null` otherwise, also for a returning guest (the API returns it only once).
   */
  readonly editLink: string | null;
  /** The section is near the viewport or the guest pressed a button: the API may be called. */
  readonly active: boolean;
  readonly busy: boolean;
  /** Failure of the last action that is not a validation finding. */
  readonly error: ApiFailure | null;
  readonly fieldErrors: readonly FieldError[];
  readonly notice: RsvpNotice | null;
  /** Past the deadline: no new replies, the own reply is read-only. */
  readonly closed: boolean;
  /** The API refused a write because the deadline has passed (the page had not noticed yet). */
  readonly closedByApi: boolean;
  /** The API takes no more new replies (cap reached). */
  readonly full: boolean;
  /** The API is not configured (no storage or deadline). */
  readonly unavailable: boolean;
  readonly limits: RsvpLimits;
  /** The guest has acted in the section, so moving the focus is expected. */
  readonly interacted: boolean;
  readonly start: (attending: boolean) => void;
  readonly edit: () => void;
  readonly cancel: () => void;
  readonly change: (draft: Reply) => void;
  readonly submit: (website: string) => Promise<void>;
  readonly withdraw: () => Promise<void>;
  /** Loads the stored reply now (also without `IntersectionObserver`). */
  readonly reveal: () => void;
  readonly retry: () => void;
};

const CHOOSE: RsvpPhase = { kind: 'choose' };
const STORED: RsvpPhase = { kind: 'stored' };
const CLAIMING: RsvpPhase = { kind: 'claiming' };
const SAVED: RsvpPhase = { kind: 'saved' };

/** An unplaced validation finding: the form shows its general message. */
const INVALID: readonly FieldError[] = [{ field: '', code: 'invalid' }];

function subscribeToRsvpState(onChange: () => void): () => void {
  window.addEventListener(RSVP_STATE_EVENT, onChange);
  return () => window.removeEventListener(RSVP_STATE_EVENT, onChange);
}

/**
 * The `wp_rsvp_state` cookie (`yes`, `no` or `null`), re-read whenever an RSVP call may have changed
 * it. Reads only the cookie: no API call.
 */
export function useRsvpState(): RsvpState | null {
  return useSyncExternalStore(
    subscribeToRsvpState,
    () => readRsvpState(),
    () => null,
  );
}

/**
 * Removes a personal edit link from the address bar (and so from the history entry), keeping the
 * path and query. The fragment never reaches a server; this keeps it off screenshots and shared
 * URLs too.
 */
function forgetEditLink(): void {
  if (parseEditLink(window.location.hash) !== null) {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  }
}

/**
 * State and API calls of the RSVP section. On page load it reads only the `wp_rsvp_state` cookie
 * and the URL fragment; the API is called once the section comes near the viewport or the guest
 * presses a button. A personal edit link (`#edit=<id>.<token>`) is then claimed for this browser
 * (`POST /api/rsvp/claim`) and removed from the address bar.
 */
export function useRsvp({ enabled, lang, deadline, anchor }: UseRsvpOptions): UseRsvp {
  const [stored] = useState(() => (enabled ? readRsvpState() : null));
  const [link] = useState(() => (enabled ? parseEditLink(window.location.hash) : null));
  // The token still to claim; cleared once the API has answered for good.
  const [claimToken, setClaimToken] = useState(() => link?.token ?? null);
  const [phase, setPhase] = useState<RsvpPhase>(
    claimToken !== null ? CLAIMING : stored === null ? CHOOSE : STORED,
  );
  const [mine, setMine] = useState<RsvpMine | null>(null);
  const [editLink, setEditLink] = useState<string | null>(null);
  const [status, setStatus] = useState<RsvpStatus | null>(null);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<readonly FieldError[]>([]);
  // A malformed edit link is reported at once; no API call can make it work.
  const [notice, setNotice] = useState<RsvpNotice | null>(
    link !== null && link.token === null ? 'linkInvalid' : null,
  );
  const [closedByApi, setClosedByApi] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [openedAt] = useState(Date.now);
  // When the form was last shown: a new reply sends the time since then (`elapsedMs`), so the API
  // can refuse replies filled in faster than a person could.
  const formShownAt = useRef(0);

  const near = useNearViewport(anchor, enabled);
  const active = enabled && (near || requested);

  useEffect(() => {
    if (link !== null && link.token === null) {
      forgetEditLink();
    }
  }, [link]);

  // Opened with a personal edit link: claim the reply for this browser.
  const claimNow = active && phase.kind === 'claiming' && claimToken !== null;
  useEffect(() => {
    if (!claimNow || claimToken === null) {
      return undefined;
    }
    const controller = new AbortController();
    void claimRsvp(claimToken, controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        setClaimToken(null);
        forgetEditLink();
        setMine(result.value);
        setPhase(SAVED);
        setNotice('claimed');
      } else if (result.error.kind === 'notFound') {
        // Wrong, incomplete or withdrawn: say so, and carry on with this browser's own reply.
        setClaimToken(null);
        forgetEditLink();
        setPhase(stored === null ? CHOOSE : STORED);
        setNotice('linkInvalid');
      } else {
        // Offline, rate-limited or unavailable: keep the link for "try again".
        setPhase({ kind: 'loadFailed', error: result.error });
      }
    });
    return () => controller.abort();
  }, [claimNow, claimToken, stored]);

  // A returning guest: load the own reply.
  const loadMine = active && phase.kind === 'stored';
  useEffect(() => {
    if (!loadMine) {
      return undefined;
    }
    const controller = new AbortController();
    void getMine(controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok) {
        setMine(result.value);
        setPhase(SAVED);
      } else if (result.error.kind === 'notFound') {
        // The reply is gone (the API has cleared the stale cookies): answer anew.
        setPhase(CHOOSE);
      } else {
        setPhase({ kind: 'loadFailed', error: result.error });
      }
    });
    return () => controller.abort();
  }, [loadMine]);

  // No reply yet: ask whether replies are accepted (deadline, cap) and for the input limits.
  const loadStatus =
    active &&
    status === null &&
    mine === null &&
    (phase.kind === 'choose' || phase.kind === 'form');
  useEffect(() => {
    if (!loadStatus) {
      return undefined;
    }
    const controller = new AbortController();
    void getStatus(controller.signal).then((result) => {
      // Without a status the form still works; a write reports what is wrong.
      if (!controller.signal.aborted && result.ok) {
        setStatus(result.value);
      }
    });
    return () => controller.abort();
  }, [loadStatus]);

  const limits = formLimits(status);
  const deadlinePassed = openedAt > Date.parse(deadline);
  const closed =
    closedByApi ||
    deadlinePassed ||
    (mine !== null && !mine.open) ||
    (status?.enabled === true && !status.open && !status.full);
  const full = status?.full === true && !status.open;
  const unavailable = status !== null && !status.enabled;

  const clearFeedback = () => {
    setError(null);
    setFieldErrors([]);
    setNotice(null);
  };

  /** Reads the own reply again after a conflict, and shows it with `next`. */
  const reload = async (next: RsvpNotice) => {
    const result = await getMine();
    if (result.ok) {
      setMine(result.value);
      setPhase(SAVED);
      setNotice(next);
    } else if (result.error.kind === 'notFound') {
      setMine(null);
      setEditLink(null);
      setPhase(CHOOSE);
      setNotice('replyGone');
    } else {
      setError(result.error);
    }
  };

  const onWriteFailure = async (failure: ApiFailure, mode: 'create' | 'edit', draft: Reply) => {
    switch (failure.kind) {
      case 'validation':
        setFieldErrors(failure.errors.length > 0 ? failure.errors : INVALID);
        return;
      case 'exists':
        // This browser already has a reply (another tab): show it.
        await reload('alreadyAnswered');
        return;
      case 'conflict':
        await reload('conflict');
        return;
      case 'notFound':
        if (mode === 'edit') {
          // The reply was deleted elsewhere: keep the entries and let the guest send them anew.
          setMine(null);
          setEditLink(null);
          setPhase({
            kind: 'form',
            mode: 'create',
            draft: { ...draft, people: draft.people.map(({ id: _, ...person }) => person) },
          });
          setNotice('replyGone');
        } else {
          setError({ ...failure, kind: 'unavailable' });
        }
        return;
      case 'closed':
        setClosedByApi(true);
        setPhase(mine === null ? CHOOSE : SAVED);
        return;
      default:
        setError(failure);
    }
  };

  const start = (attending: boolean) => {
    setRequested(true);
    setInteracted(true);
    clearFeedback();
    formShownAt.current = performance.now();
    setPhase({ kind: 'form', mode: 'create', draft: newReply(attending) });
  };

  const edit = () => {
    if (mine === null) {
      return;
    }
    setInteracted(true);
    clearFeedback();
    formShownAt.current = performance.now();
    setPhase({ kind: 'form', mode: 'edit', draft: replyFromView(mine.rsvp) });
  };

  const cancel = () => {
    setInteracted(true);
    clearFeedback();
    setPhase(mine === null ? CHOOSE : SAVED);
  };

  const change = (draft: Reply) =>
    setPhase((current) => (current.kind === 'form' ? { ...current, draft } : current));

  const submit = async (website: string) => {
    if (phase.kind !== 'form' || busy) {
      return;
    }
    const { draft, mode } = phase;
    clearFeedback();
    const findings = validateReply(draft, limits);
    if (findings.length > 0) {
      setFieldErrors(findings);
      return;
    }
    setBusy(true);
    const result =
      mode === 'edit' && mine !== null
        ? await updateRsvp(toRequest(draft, lang, website), mine.version)
        : await createRsvp(
            toRequest(draft, lang, website, performance.now() - formShownAt.current),
          );
    if (result.ok) {
      const { editToken, ...saved }: RsvpCreated = result.value;
      setMine(saved);
      if (editToken !== undefined) {
        setEditLink(editLinkFor(editToken));
      }
      setPhase(SAVED);
    } else {
      await onWriteFailure(result.error, mode, draft);
    }
    setBusy(false);
  };

  const withdraw = async () => {
    if (mine === null || busy) {
      return;
    }
    clearFeedback();
    setInteracted(true);
    setBusy(true);
    const result = await deleteRsvp(mine.version);
    if (result.ok || result.error.kind === 'notFound') {
      // The API deleted the reply, so its edit link no longer works either.
      setMine(null);
      setEditLink(null);
      setPhase(CHOOSE);
      setNotice('withdrawn');
    } else if (result.error.kind === 'conflict') {
      await reload('conflict');
    } else if (result.error.kind === 'closed') {
      setClosedByApi(true);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const reveal = () => {
    setRequested(true);
    setInteracted(true);
  };

  const retry = () => {
    setRequested(true);
    setInteracted(true);
    setPhase(claimToken !== null ? CLAIMING : STORED);
  };

  return {
    phase,
    stored,
    mine,
    editLink,
    active,
    busy,
    error,
    fieldErrors,
    notice,
    closed,
    closedByApi,
    full,
    unavailable,
    limits,
    interacted,
    start,
    edit,
    cancel,
    change,
    submit,
    withdraw,
    reveal,
    retry,
  };
}
