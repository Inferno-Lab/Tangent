import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { setLocaleSource, setZoneSource, type SchoolLocale, type ShellData } from '@tangent/contracts';
import { Shell, useLanguage } from '@tangent/web-ui';
import { useChrome } from './useChrome';

interface ShellChrome { openSearch: () => void; shell: ShellData | undefined; themeCls: string }
const Chrome = createContext<ShellChrome | null>(null);

/** What a page may need from the shell around it: the search box, the school's shell data, the theme. */
export function useShellChrome(): ShellChrome {
  const c = useContext(Chrome);
  if (!c) throw new Error('useShellChrome is only available inside the signed-in layout.');
  return c;
}

/** The one shell of the signed-in admin: the menu, search and phone dock stay mounted while pages change below them. */
// Every date, time, number and amount on a page is written the school's way (its zone, locale and currency, locale.ts).
let current: SchoolLocale | undefined;
setZoneSource(() => current?.zone);
setLocaleSource(() => current);

export function AppLayout({ children }: { children: ReactNode }) {
  const v = useChrome();
  current = v.shell?.locale;
  // The school's language and its own words (People → Settings); the page loads again once if they changed.
  useLanguage(v.shell?.locale.language, v.shell?.locale.vocab);
  // Pages are drawn again once if the school's locale arrives or changes, so nothing keeps a format from before.
  const key = current ? `${current.zone}|${current.locale}|${current.currency}` : '';
  return (
    <Chrome.Provider value={{ openSearch: v.openSearch, shell: v.shell, themeCls: v.themeCls }}>
      <Shell theme={v.themeCls} aside={v.aside} overlays={v.overlays}><Fragment key={key}>{children}</Fragment></Shell>
    </Chrome.Provider>
  );
}
