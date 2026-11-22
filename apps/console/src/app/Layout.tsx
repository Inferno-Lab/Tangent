import { createContext, useContext, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { LeaveGuard, Presence, Shell, hasUnsaved, t } from '@tangent/web-ui';
import { useChrome } from './useChrome';

type ShellChrome = Omit<ReturnType<typeof useChrome>, 'aside' | 'overlays'>;
const Chrome = createContext<ShellChrome | null>(null);

/** What a page may need from the shell around it: the search box, the theme, and the schools and approvals the menu counts. */
export function useShellChrome(): ShellChrome {
  const c = useContext(Chrome);
  if (!c) throw new Error(t('console.layout.useshellchrome_is_only_available_inside'));
  return c;
}

/** The one shell of the signed-in console: the menu, search and phone dock stay mounted while pages change below them. */
export function AppLayout({ children }: { children: ReactNode }) {
  const { aside, overlays, ...rest } = useChrome();
  // A page or popup with unsaved work asks before the app moves to another page (closing the tab asks too: useUnsaved).
  const leave = useBlocker({ shouldBlockFn: hasUnsaved, enableBeforeUnload: false, withResolver: true });
  const guarded = <>{overlays}<Presence>{leave.status === 'blocked' && <LeaveGuard {...leave} />}</Presence></>;
  return (
    <Chrome.Provider value={rest}>
      <Shell theme={rest.themeCls} aside={aside} overlays={guarded}>{children}</Shell>
    </Chrome.Provider>
  );
}
