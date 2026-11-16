import { useQuery } from '@tanstack/react-query';
import { EmptyState, t } from '@tangent/web-ui';
import type { MigrationRow } from '@tangent/contracts';
import { Card, Page } from '../../app/Page';
import { useApp } from '../../app/context';
import { url } from '../../app/base';

const KIND: Record<MigrationRow['kind'], string> = { expand: 'v', backfill: 'v', contract: 'a' };
const KIND_WORD: Record<MigrationRow['kind'], string> = { expand: t('console.migrations_tab.adds'), backfill: t('console.migrations_tab.fills_in'), contract: t('console.migrations_tab.removes') };
const KIND_HELP: Record<MigrationRow['kind'], string> = { expand: t('console.migrations_tab.adds_something_new_safe_to'), backfill: t('console.migrations_tab.fills_in_old_rows'), contract: t('console.migrations_tab.removes_something_old_runs_last') };

/** Releases → Database changes: each change to the schools' tables and which schools have it. */
export function MigrationsTab({ tabs }: { tabs: React.ReactNode }) {
  const app = useApp();
  const q = useQuery({ queryKey: ['migrations'], queryFn: app.api.releases.migrations, refetchInterval: 15_000 });
  const rows = q.data ?? [];
  return (
    <Page title={t('console.migrations_tab.releases')} sub={t('console.migrations_tab.database_changes_and_which_schools')} tabs={tabs} loading={q.isLoading} error={q.isError ? { message: (q.error as Error).message, retry: () => void q.refetch() } : null}>
      {rows.length === 0 ? (
        <div><EmptyState scene="migrations" onAction={() => app.go('/releases')} /></div>
      ) : rows.map((m) => {
        const applied = m.schools.filter((s) => s.state === 'applied').length;
        const bad = m.schools.filter((s) => s.state === 'failed');
        return (
          <Card key={m.tag} title={m.tag} chip={<span className={`chip ${KIND[m.kind]}`}>{KIND_WORD[m.kind]}</span>}>
            <div className="help">{KIND_HELP[m.kind]}</div>
            <div className="us" style={{ marginTop: 12 }}>
              <div className="r">{t('console.migrations_tab.schools_with_it')}<b>{applied} {t('console.migrations_tab.of')}{' '}{m.schools.length}</b></div>
              <div className={`bar ${bad.length ? 'warn' : ''}`}><i style={{ width: `${m.schools.length ? (applied / m.schools.length) * 100 : 0}%` }}></i></div>
            </div>
            {bad.map((s) => <div key={s.id} className="emsg" role="alert" style={{ marginTop: 10 }}><a href={url(`/schools/${s.id}/technical`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${s.id}/technical`); }} style={{ color: 'inherit', fontWeight: 700 }}>{s.name}</a>: {s.error ?? 'failed'}</div>)}
          </Card>
        );
      })}
    </Page>
  );
}
