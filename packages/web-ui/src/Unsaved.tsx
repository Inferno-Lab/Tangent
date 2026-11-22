import { useEffect } from 'react';

// What is open with unsaved work: a page's edits, a popup someone typed in. Closing or reloading the tab asks first.
let open = 0;
const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };

// Popups that hear when a change was saved (what was typed in them is no longer at risk).
const savers = new Set<() => void>();

/** A change was saved (MutationCache onSuccess): popups stop counting what was typed before it as unsaved. */
export function markSaved(): void {
  for (const f of savers) f();
}

/** Calls [f] each time a change is saved, while the component is mounted. */
export function useOnSaved(f: () => void): void {
  useEffect(() => {
    savers.add(f);
    return () => { savers.delete(f); };
  }, [f]);
}

/** Whether anything on the page holds work that is not saved (the app's router asks before it leaves the page). */
export const hasUnsaved = (): boolean => open > 0;

/** Marks this page or popup as holding unsaved work while [dirty] is true. */
export function useUnsaved(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    if (open++ === 0) window.addEventListener('beforeunload', warn);
    return () => { if (--open === 0) window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
}
