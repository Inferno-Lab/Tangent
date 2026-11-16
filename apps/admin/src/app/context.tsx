import { createContext, useContext } from 'react';
import type { SessionUser } from '@tangent/contracts';
import type { Client } from './client';
import { t } from '@tangent/web-ui';

export interface AppCtx {
  slug: string;
  /** The router's base path, `/s/<slug>` on a shared address and empty on a school's own. */
  base: string;
  api: Client['api'];
  user: SessionUser;
  signOut: () => void;
  go: (path: string) => void;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error(t('admin.context.useapp_must_be_used_inside'));
  return c;
}
