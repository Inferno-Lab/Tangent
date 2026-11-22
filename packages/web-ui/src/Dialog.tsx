import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { leavingProps, useLeaving, useReturnFocus } from './Presence';
import { t } from './i18n';
import { useUnsaved } from './Unsaved';

export interface DialogProps {
  title: string;
  /** A small label above the title, like "Cannot be undone". */
  tag?: { text: string; tone: 'v' | 'c' | 'a' | 'g' };
  dark?: boolean;
  onClose: () => void;
  /** Applied to the card, for the vibrate on a wrong answer. */
  shake?: string;
  width?: number;
  children: ReactNode;
}

/** Focus stays inside [box] while Tab and Shift+Tab move through what can be pressed in it. */
function trapTab(e: KeyboardEvent, box: HTMLElement) {
  const items = [...box.querySelectorAll<HTMLElement>('input,textarea,button,a[href],[tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
  if (!items.length) return;
  const a = items[0]!, z = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
  else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
}

/**
 * Once someone types in a popup, Escape and the backdrop ask before throwing it away (its own Cancel and Save close it as
 * they always did), and the page warns before it is closed or left.
 */
function useGuardedClose(onClose: () => void) {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  useUnsaved(dirty);
  const dismiss = () => (dirty ? setAsking(true) : onClose());
  const ask = asking && (
    <div className="unsaved" role="alertdialog" aria-label={t('ui.unsaved.discard_q')}>
      <span>{t('ui.unsaved.discard_q')}</span>
      <button type="button" className="btn sm" autoFocus onClick={() => setAsking(false)}>{t('ui.unsaved.keep')}</button>
      <button type="button" className="btn sm dngf" onClick={onClose}>{t('ui.unsaved.discard')}</button>
    </div>
  );
  // A search or filter box is not work to lose.
  const onInput = (e: { target: EventTarget }) => { if (!(e.target as HTMLElement).closest('.srch,[type="search"],[role="search"],[role="searchbox"]')) setDirty(true); };
  return { onInput, dismiss, ask };
}

/**
 * A card over a dimmed page (no blur: it made every scroll inside the popup repaint the whole page). Escape and the backdrop close it (asking first once something was typed in it), and focus stays inside until it does.
 * Render it inside `<Presence>` (Page's `overlays` does) and it fades out instead of vanishing.
 */
export function Dialog({ title, tag, dark, onClose, shake, width, children }: DialogProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useLeaving();
  useReturnFocus(leaving);
  const guard = useGuardedClose(onClose);
  const close = useRef(guard.dismiss);
  close.current = guard.dismiss;
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,button:not(.xb),[tabindex="0"]');
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (!ref.current || ref.current.closest('[data-leaving]')) return;
      // A popup opened from the dialog (a dropdown, a calendar) takes Escape first.
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
      if (e.key === 'Tab') trapTab(e, ref.current);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <div className="scrim" onClick={leaving ? undefined : guard.dismiss} {...leavingProps(leaving)}></div>
      <div className="mod" {...leavingProps(leaving)}>
        <div ref={ref} onInput={guard.onInput} className={`dlg ${dark ? 'dk' : ''} ${shake ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={id} style={{ ...(width ? { width } : {}), maxHeight: 'calc(100dvh - 32px)', overflow: 'auto' }}>
          {tag && <span className={`chip ${tag.tone}`}>{tag.text}</span>}
          <h3 id={id}>{title}</h3>
          {guard.ask}
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * A record opened beside the list: slides in from the right over a dimmed page. Escape and the backdrop close it (asking
 * first once something was typed in it), and focus stays inside until it does. Render it inside `<Presence>`.
 */
export function Panel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const leaving = useLeaving();
  useReturnFocus(leaving);
  const guard = useGuardedClose(onClose);
  const close = useRef(guard.dismiss);
  close.current = guard.dismiss;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (!ref.current || ref.current.closest('[data-leaving]')) return;
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
      if (e.key === 'Tab') trapTab(e, ref.current);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <div className="scrim" onClick={leaving ? undefined : guard.dismiss} {...leavingProps(leaving)}></div>
      <aside ref={ref} onInput={guard.onInput} className="drw" role="dialog" aria-modal="true" aria-label={label} {...leavingProps(leaving)}>{guard.ask}{children}</aside>
    </>
  );
}

/** Asks before the app leaves a page with unsaved work (the router's blocker, `useBlocker({ withResolver: true })`). */
export function LeaveGuard({ status, proceed, reset }: { status: 'blocked' | 'idle'; proceed?: () => void; reset?: () => void }) {
  if (status !== 'blocked' || !proceed || !reset) return null;
  return (
    <Dialog title={t('ui.unsaved.leave_title')} onClose={reset}>
      <p className="help">{t('ui.unsaved.leave_body')}</p>
      <div className="tgrow" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button type="button" className="btn" onClick={reset}>{t('ui.unsaved.stay')}</button>
        <button type="button" className="btn dngf" onClick={proceed}>{t('ui.unsaved.leave')}</button>
      </div>
    </Dialog>
  );
}
