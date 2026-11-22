import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { EmptyCard, PageScope, Presence, t, Skeleton } from '@tangent/web-ui';
import { AskTangent } from '../profile/AskTangent';
import { useApp } from '../../app/context';
import { pageForPath } from '@tangent/config-engine';
import { moduleForPath } from '../../app/nav';

/**
 * Around every signed-in page: a page the person's menu does not have says why plainly, instead of loading and failing (someone
 * followed an old link or a bookmark): a module the school does not have, Moving in after the school went live, or a page the
 * person's role does not include. The menu (ShellData.menu, from the module definitions) is the one rule for all three.
 */
export function PlanGate({ children }: { children: ReactNode }) {
  const app = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const path = app.base && pathname.startsWith(app.base) ? pathname.slice(app.base.length) || '/' : pathname;
  const page = pageForPath(path);
  const shell = useQuery({ queryKey: ['shell'], queryFn: app.api.shell, staleTime: 30_000, enabled: !!page });
  const d = shell.data;
  const router = useRouter();
  // The page's code loads while the menu does, so waiting for the menu costs nothing on a first visit.
  useEffect(() => { if (page && !d) void router.preloadRoute({ to: pathname as never }).catch(() => undefined); }, [page, d, pathname, router]);
  // Until the menu is known a page is not drawn: a module paused or taken away would otherwise ask the server first.
  if (page && !d && !shell.isError) return <main className="mn"><Skeleton kind="rows" rows={6} /></main>;
  if (!page || !d || d.menu.some((g) => g.pages.some((x) => x.id === page.id))) return <>{children}</>;
  const need = moduleForPath(path);
  if (need && !d.modules.includes(need) && !d.features.includes(need)) return <NotInPlan area={page.label} />;
  if (page.untilLive) return <Closed title={t('admin.plan_gate.moving_in')} heading={t('admin.plan_gate.your_school_has_moved_in')} body={t('admin.plan_gate.moving_in_closes_once_the')} />;
  return <Closed title={page.label} heading={t('admin.plan_gate.your_role_does_not_include')} body={t('admin.plan_gate.ask_your_principal_if_you')} />;
}

function Closed({ title, heading, body }: { title: string; heading: string; body: string }) {
  const app = useApp();
  return (
    <PageScope page="dashboard">
      <main className="mn">
        <div><EmptyCard title={title} chip={{ text: t('admin.plan_gate.not_here'), tone: 'a' }} icon="lock" heading={heading} body={body}
          actions={<button className="btn pri" onClick={() => app.go('/')}>{t('admin.plan_gate.go_to_the_dashboard')}</button>} /></div>
      </main>
    </PageScope>
  );
}

function NotInPlan({ area }: { area: string }) {
  const app = useApp();
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <PageScope page="dashboard" overlays={<Presence>{asking && <AskTangent area={area} onClose={() => setAsking(false)} onDone={() => { setAsking(false); setSent(true); }} />}</Presence>}>
      <main className="mn">
        <div><EmptyCard title={area} chip={{ text: t('admin.plan_gate.not_included'), tone: 'a' }} icon="lock" heading={t('admin.plan_gate.this_is_not_part_of')}
          body={sent ? t('admin.plan_gate.your_request_is_with_tangent') : t('admin.plan_gate.your_school_does_not_have')}
          actions={<>
            {!sent && <button className="btn pri" onClick={() => setAsking(true)}>{t('admin.plan_gate.ask_tangent_to_add_it')}</button>}
            <button className="btn" onClick={() => app.go('/profile/plan')}>{t('admin.plan_gate.see_the_plan')}</button>
          </>} /></div>
      </main>
    </PageScope>
  );
}
