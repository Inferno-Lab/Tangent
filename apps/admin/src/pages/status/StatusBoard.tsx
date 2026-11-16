import { useQuery } from '@tanstack/react-query';
import type { PublicStatus } from '@tangent/contracts';
import { useTheme, Icon, EmptyNote, t } from '@tangent/web-ui';
import { fmtDate } from '@tangent/contracts';

const TEXT = { ok: t('admin.status_board.everything_is_working'), degraded: t('admin.status_board.some_things_are_slow'), down: t('admin.status_board.something_is_down') } as const;
const TONE = { ok: 'g', degraded: 'a', down: 'c' } as const;
const WORD = { ok: t('admin.status_board.working'), degraded: t('admin.status_board.slow'), down: t('admin.status_board.down') } as const;

/** What anyone can open to see whether Tangent is up: no sign-in, no school data, just names and states. */
export function StatusBoard() {
  const theme = useTheme();
  const q = useQuery({
    queryKey: ['public-status'],
    queryFn: async () => { const r = await fetch('/console/v1/public/status'); if (!r.ok) throw new Error(t('admin.status_board.the_status_could_not_be')); return (await r.json()) as PublicStatus; },
    refetchInterval: 30_000,
  });
  const s = q.data;
  return (
    <div className={`nest ${theme.cls}`} style={{ minHeight: '100dvh', padding: 12 }}>
      <main className="fr" style={{ maxWidth: 820, margin: '0 auto', padding: '32px 32px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <header>
          <div className="lbl">{t('admin.status_board.tangent_status')}</div>
          <h1 className="fd" style={{ margin: '6px 0 4px', font: '700 30px/1.1 var(--fd)', letterSpacing: '-.035em' }}>{s ? TEXT[s.state] : q.isError ? t('admin.status_board.we_could_not_check') : t('admin.status_board.checking')}</h1>
          <p style={{ margin: 0, color: 'var(--ink3)', font: '600 14px var(--fb)' }}>{s ? t('admin.status_board.updated_this_page_refreshes_by', { fmtDate: fmtDate(s.updatedAt, 'time') }) : q.isError ? t('admin.status_board.try_again_in_a_minute') : ' '}</p>
        </header>
        {!s && !q.isError && <div className="skc" style={{ height: 220, borderRadius: 24 }} />}
        {s && (
          <>
            <section className="card">
              <div className="ch"><h2>{t('admin.status_board.schools')}</h2><span className={`chip ${TONE[s.state]}`}>{s.schools.length}</span></div>
              <div className="lscroll" style={{ maxHeight: 360, marginTop: 8 }}>
                {s.schools.length === 0 && <EmptyNote icon="fleet" title={t('admin.status_board.no_schools_are_set_up')} body={t('admin.status_board.each_school_shows_here_with')} />}
                {s.schools.map((x) => <div className="kv" key={x.name}><span>{x.name}</span><b><span className={`st ${TONE[x.state]}`}><i></i>{WORD[x.state]}</span></b></div>)}
              </div>
            </section>
            <section className="card">
              <div className="ch"><h2>{t('admin.status_board.recent_incidents')}</h2></div>
              {s.incidents.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}><div style={{ width: 90, flex: 'none' }}><span className="itile"><Icon name="checkCircle" size={24} /></span></div><div className="help">{t('admin.status_board.nothing_in_the_last_7')}</div></div>
              ) : s.incidents.map((i) => <div className="kv" key={i.id}><span>{i.title}<br /><small style={{ color: 'var(--ink3)' }}>{fmtDate(i.startedAt, 'stamp')}</small></span><b><span className={`st ${i.open ? 'c' : 'g'}`}><i></i>{i.open ? t('admin.status_board.open') : t('admin.status_board.resolved')}</span></b></div>)}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
