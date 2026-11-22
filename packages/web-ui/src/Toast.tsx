import { Icon } from './Icon';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Presence, leavingProps, useLeaving } from './Presence';
import { t as tr } from './i18n';

export interface ToastProps {
  text: ReactNode;
  tone?: 'ok' | 'bad';
  /** One button on the toast, such as Undo. */
  action?: { label: string; onPress: () => void };
  /** Set by useToast: the pointer over the toast, or keyboard focus in it, holds it; an error has a close button. */
  hold?: (on: boolean) => void;
  close?: () => void;
}

/** How long a toast stays: a confirmation 4 s, one with an action 10 s (time to reach it by keyboard), an error 8 s (it also has a close button). */
export const TOAST_MS = 4000;
export const TOAST_ACTION_MS = 10000;
export const TOAST_ERROR_MS = 8000;

/** `say("Saved")` shows a toast; `say("Couldn’t save", 'bad')` an error that stays a little longer. Timers stop with the page. */
export function useToast(): { toast: ToastProps | null; say: (text: ReactNode, tone?: 'ok' | 'bad', action?: ToastProps['action']) => void; clear: () => void } {
  const [toast, setToast] = useState<ToastProps | null>(null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ms = useRef(0);
  useEffect(() => () => clearTimeout(t.current), []);
  const clear = useCallback(() => { clearTimeout(t.current); setToast(null); }, []);
  const arm = useCallback(() => { clearTimeout(t.current); t.current = setTimeout(() => setToast(null), ms.current); }, []);
  const say = useCallback((text: ReactNode, tone: 'ok' | 'bad' = 'ok', action?: ToastProps['action']) => {
    ms.current = tone === 'bad' ? TOAST_ERROR_MS : action ? TOAST_ACTION_MS : TOAST_MS;
    setToast({ text, tone, action, hold: (on) => (on ? clearTimeout(t.current) : arm()), close: clear });
    arm();
  }, [arm, clear]);
  return { toast, say, clear };
}

/** The dark pill that confirms something happened, in one line at the bottom of the window. */
export function Toast({ text, tone = 'ok', action, hold, close }: ToastProps) {
  const leaving = useLeaving();
  return (
    <div className="toast" role={tone === 'bad' ? 'alert' : 'status'} {...leavingProps(leaving)} onPointerEnter={() => hold?.(true)} onPointerLeave={() => hold?.(false)}
      onFocus={() => hold?.(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hold?.(false); }}>
      <span style={{ width: 28, height: 28, borderRadius: 10, background: tone === 'ok' ? 'var(--ok)' : 'var(--bad)', color: tone === 'ok' ? 'var(--on-ok)' : 'var(--on-bad)', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon name={tone === 'ok' ? 'check' : 'close'} size={16} />
      </span>
      {text}
      {action && <button className="btn wht sm" onClick={action.onPress}>{action.label}</button>}
      {tone === 'bad' && close && <button className="xb" onClick={close} aria-label={tr('ui.toast.close')}><Icon name="close" size={16} /></button>}
    </div>
  );
}

/** The toast slot every page uses: shows `toast` while it is set and lets it fade out when it clears. */
export function ToastSlot({ toast }: { toast: ToastProps | null | undefined | false | '' }) {
  const ok = toast && toast.tone !== 'bad' ? toast : null;
  const bad = toast && toast.tone === 'bad' ? toast : null;
  // The live regions are always in the page and the toast arrives inside one, so a screen reader hears it (a region that
  // appears together with its words is often not read): an error at once, the rest when the reader is free.
  return (
    <>
      <div className="toasts" aria-live="polite"><Presence>{ok && <Toast {...ok} />}</Presence></div>
      <div className="toasts" aria-live="assertive"><Presence>{bad && <Toast {...bad} />}</Presence></div>
    </>
  );
}
