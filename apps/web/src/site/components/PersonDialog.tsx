import type { SectionOf } from '@weddingplanner/content';
import { type MouseEvent, useEffect, useId, useRef } from 'react';
import { mediaUrl } from '../format.ts';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';
import { Paragraphs } from './Paragraphs.tsx';

export type PartyMember = SectionOf<'weddingParty'>['data']['people'][number];

export type PersonDialogProps = {
  readonly person: PartyMember;
  readonly lang: Lang;
  /** Called once the dialog has closed (close button, Escape or a click on the backdrop). */
  readonly onClose: () => void;
};

/**
 * A modal `<dialog>` with a person's role and text. The browser traps focus, closes it on Escape
 * and returns focus on close; the close button comes first, so it receives the initial focus.
 */
export function PersonDialog({ person, lang, onClose }: PersonDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  // No cleanup: unmounting removes the element and with it the modal state. Closing here would fire
  // a late `close` event after StrictMode's remount in development.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null || dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', ''); // engines without showModal (e.g. jsdom)
    }
  }, []);

  const close = () => {
    const dialog = ref.current;
    if (dialog !== null && typeof dialog.close === 'function' && dialog.open) {
      dialog.close(); // fires `close`, which calls onClose
    } else {
      onClose();
    }
  };

  // A click on the backdrop targets the <dialog> itself; clicks on the content target its children.
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      close();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the modal dialog natively
    <dialog
      ref={ref}
      className="person-dialog"
      aria-labelledby={headingId}
      onClose={onClose}
      onClick={closeOnBackdrop}
    >
      <div className="person-dialog-body">
        <button
          type="button"
          className="dialog-close"
          aria-label={t(ui.close, lang)}
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
        {person.photo !== undefined && (
          <img className="person-photo" src={mediaUrl(person.photo)} alt="" decoding="async" />
        )}
        <p className="eyebrow">{t(person.role, lang)}</p>
        <h3 id={headingId}>{person.name}</h3>
        <Paragraphs text={t(person.text, lang)} />
      </div>
    </dialog>
  );
}
