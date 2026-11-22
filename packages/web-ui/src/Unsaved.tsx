import { useEffect } from 'react';

// What is open with unsaved work: a page's edits, a popup someone typed in. Closing or reloading the tab asks first.
let open = 0;
const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };

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
