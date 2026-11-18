import { createContext, useContext, type ReactNode } from 'react';
import { Shell, t } from '@tangent/web-ui';
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
  return (
    <Chrome.Provider value={rest}>
      <Shell theme={rest.themeCls} aside={aside} overlays={overlays}>{children}</Shell>
    </Chrome.Provider>
  );
}
