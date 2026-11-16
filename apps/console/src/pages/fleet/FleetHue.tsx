import type { CSSProperties } from 'react';
import type { ActionRow, FleetSummary, SchoolRow } from '@tangent/contracts';
import { EmptyNote, EmptyState, Icon, PageScope, Presence, Roll, markStyle, rollDigits, t as tr } from '@tangent/web-ui';

// The console's front page as the Fleet board (design/hue/src/Fleet.html): the fleet on the deep colour, the schools by health,
// what waits for approval and the app rolling out. `v` is what FleetPage works out; the rest is its data.
type V = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HEALTH: Record<SchoolRow['health'], [string, string, number]> = { down: [tr('console.fleet_hue.action'), 'bad', 0], degraded: [tr('console.fleet_hue.watch'), 'warn', 1], unknown: [tr('console.fleet_hue.not_checked'), '', 2], ok: [tr('console.fleet_hue.healthy'), 'ok', 3] };

export function FleetHue({ v, f, schools, actions }: { v: V; f: FleetSummary; schools: SchoolRow[]; actions: ActionRow[] }) {
  const students = schools.reduce((n, s) => n + s.students, 0);
  const bad = Math.max(0, f.live - f.healthy - f.degraded);
  const rows = [...schools].sort((a, b) => HEALTH[a.health][2] - HEALTH[b.health][2] || a.name.localeCompare(b.name)).slice(0, 8);
  const waiting = actions.filter((a) => a.status === 'pending_approval');
  const rel = f.release;
  return (
    <PageScope page="fleet" overlays={<><Presence>{v.dialog}</Presence><Presence>{v.alertsDialog}</Presence></>}>
      <main className="mn hb">
        <header className="top">
          <div><h1>{tr('console.fleet_hue.fleet')}</h1><p>{f.live} {f.live === 1 ? 'school' : 'schools'} {tr('console.fleet_hue.live')}{' '}{f.onboarding} {tr('console.fleet_hue.onboarding')}{' '}{f.cells.length} {f.cells.length === 1 ? 'cell' : 'cells'}</p></div>
          <span className="sp" />
          <button className="search" onClick={v.openSearch}><Icon name="search" className="i" />{tr('console.fleet_hue.find_a_school_a_person')}<kbd>{tr('console.fleet_hue.ctrl_k')}</kbd></button>
          <button className="ib" aria-label={tr('console.fleet_hue.alerts')} data-tip={tr('console.fleet_hue.alerts')} onClick={v.openAlerts}><Icon name="notifications" className="i" />{v.alertCount > 0 && <span className="pip" />}</button>
          <button className="btn pri" onClick={v.onboard}><Icon name="plus" className="i" />{tr('console.fleet_hue.add_a_school')}</button>
        </header>

        {v.inc && (
          <section className={`card ${v.inc.cls === 'ok' ? '' : 'deep'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className={`tag ${v.inc.cls === 'ok' ? 'ok' : 'bad'}`}>{v.inc.tag}</span>
            <span className="grow"><b>{v.inc.title}</b><small style={{ display: 'block', opacity: 0.8 }}>{v.inc.body}</small></span>
            {v.inc.open && <button className="btn sm" onClick={v.inc.open}>{tr('console.fleet_hue.open_the_school')}</button>}
            <button className="btn sm" onClick={v.inc.dismiss}>{tr('console.fleet_hue.dismiss')}</button>
          </section>
        )}

        {schools.length === 0 ? <EmptyState scene="fleet" onAction={v.onboard} /> : (
          <>
            <section className="card deep" style={{ gap: 20 }}>
              <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 24 }}>
                <div className="vc" style={{ gap: 6 }}><span className="lbl">{tr('console.fleet_hue.schools_live')}</span><div className="fig" style={{ fontSize: 56 }}>{f.live}{f.onboarding > 0 && <small>+ {f.onboarding} {tr('console.fleet_hue.onboarding_2')}</small>}</div></div>
                <div className="vc" style={{ gap: 6 }}><span className="lbl">{tr('console.fleet_hue.students')}</span><div className="fig" style={{ fontSize: 56 }}><Roll digits={rollDigits(students.toLocaleString())} /></div></div>
                <div className="vc" style={{ gap: 6 }}><span className="lbl">{tr('console.fleet_hue.healthy_now')}</span><div className="fig" style={{ fontSize: 56 }}>{f.live ? Math.round((f.healthy / f.live) * 100) : 0}%</div></div>
                <div className="vc" style={{ gap: 6 }}><span className="lbl">{tr('console.fleet_hue.slowest_answers')}</span><div className="fig" style={{ fontSize: 56 }}>{f.p95Ms ? <>{f.p95Ms}<small>{tr('console.fleet_hue.ms_p95')}</small></> : '–'}</div></div>
              </div>
              <div className="bar" style={{ height: 12, borderRadius: 6 }} aria-hidden="true"><i style={{ flex: f.healthy || 0.0001, minWidth: 0, background: 'var(--bright)' }} /><i style={{ flex: f.degraded, minWidth: 0, background: 'var(--warn-d)' }} /><i style={{ flex: bad, minWidth: 0, background: 'var(--bad-d)' }} /></div>
              <div className="fx" style={{ gap: 20, fontSize: 14, flexWrap: 'wrap' }}>
                {[[tr('console.fleet_hue.healthy_2', { healthy: f.healthy }), '--bright'], [tr('console.fleet_hue.to_watch', { degraded: f.degraded }), '--warn-d'], [tr('console.fleet_hue.need_action', { bad }), '--bad-d']].map(([t, c]) => <span key={t} className="fx" style={{ gap: 7, color: 'var(--on-deep2)' }}><i className="dot" style={{ '--c': `var(${c})` } as CSSProperties} />{t}</span>)}
                <span className="sp" /><button className="btn bri sm" onClick={v.openHealth}>{tr('console.fleet_hue.open_health')}</button>
              </div>
            </section>

            <div className="g" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(280px,320px)' }}>
              <section className="card flush">
                <div className="ch" style={{ padding: '20px 20px 8px' }}><h2>{tr('console.fleet_hue.schools')}</h2><small>{tr('console.fleet_hue.by_health_then_name')}</small><a href="#" onClick={(e) => { e.preventDefault(); v.openSchools(); }}>{tr('console.fleet_hue.all')}{' '}{schools.length}<Icon name="next" size={14} className="i" /></a></div>
                <div className="scroll-x">
                  <div style={{ minWidth: 640 }}>
                    <div className="trow h" style={{ '--cols': 'minmax(0,1.8fr) 70px 90px 110px 70px' } as CSSProperties}><span>{tr('console.fleet_hue.school')}</span><span>{tr('console.fleet_hue.plan')}</span><span className="r">{tr('console.fleet_hue.students')}</span><span>{tr('console.fleet_hue.health')}</span><span>{tr('console.fleet_hue.app')}</span></div>
                    {rows.map((s) => {
                      const [t, c] = HEALTH[s.health];
                      return (
                        <a key={s.id} className="trow" href={v.schoolHref(s.id)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); v.goSchool(s.id); }} style={{ '--cols': 'minmax(0,1.8fr) 70px 90px 110px 70px' } as CSSProperties}>
                          <span className="fx" style={{ gap: 12, minWidth: 0 }}><span className="crest" style={{ ...markStyle(s.color), width: 32, height: 32, fontSize: 15 }}>{(s.logoText || s.name[0] || '').toUpperCase()}</span><span className="grow"><b className="cut" style={{ display: 'block' }}>{s.name}</b><small>{s.region || tr('console.fleet_hue.cell', { cell: s.cell })}</small></span></span>
                          <span><span className={`tag ${s.plan.toLowerCase() === 'plus' ? 'br' : ''}`}>{s.plan}</span></span>
                          <span className="num r">{s.students.toLocaleString()}</span>
                          <span><span className={`tag ${c}`}>{t}</span></span>
                          <span className="num t2">{s.versions.app}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
                <div className="t2" style={{ fontSize: 13, padding: '14px 20px' }}>{tr('console.fleet_hue.showing')}{' '}{rows.length} {tr('console.fleet_hue.of')}{' '}{schools.length}</div>
              </section>
              <div className="vc" style={{ gap: 20 }}>
                <section className="card">
                  <div className="ch"><h2>{tr('console.fleet_hue.approvals')}</h2>{waiting.length > 0 && <span className="tag warn">{waiting.length} {tr('console.fleet_hue.waiting')}</span>}</div>
                  {waiting.length ? waiting.slice(0, 3).map((a) => (
                    <div key={a.id} className="row"><span className="av sm">{(a.schoolName ?? 'G')[0]}</span><span className="grow"><b>{a.summary}</b><small>{a.schoolName ?? tr('console.fleet_hue.every_school')} {tr('console.fleet_hue.asked_by')}{' '}{a.requestedBy}</small></span></div>
                  )) : <EmptyNote icon="approvals" title={tr('console.fleet_hue.nothing_waits_for_a_second')} body={tr('console.fleet_hue.a_change_that_needs_another')} />}
                  {waiting.length > 0 && <button className="btn ton" onClick={v.openApprovals}>{tr('console.fleet_hue.review')}{' '}{waiting.length === 1 ? 'it' : waiting.length === 2 ? 'both' : tr('console.fleet_hue.all_2', { length: waiting.length })}</button>}
                </section>
                <section className="card">
                  <div className="ch"><h2>{rel ? tr('console.fleet_hue.release', { version: rel.version }) : tr('console.fleet_hue.releases')}</h2><small>{v.relState}</small></div>
                  {rel ? (
                    <>
                      <div className="fig" style={{ fontSize: 56 }}>{v.done}<small>{tr('console.fleet_hue.of')}{' '}{v.total} {tr('console.fleet_hue.schools_2')}</small></div>
                      <div className="bar"><i style={{ width: `${v.total ? (v.done / v.total) * 100 : 0}%` }} /></div>
                      <span className="t2" style={{ fontSize: 13 }}>{v.relLine}</span>
                      <div className="fx" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {v.canPause && <button className="btn sm" disabled={v.busy} onClick={v.pause}><Icon name={v.pauseIc} size={16} className="i" />{v.pauseLabel}</button>}
                        {v.canRollback && <button className="btn sm dng" disabled={v.busy} onClick={v.rollback}>{tr('console.fleet_hue.roll_back')}</button>}
                        <button className="btn sm quiet" onClick={v.openReleases}>{v.relCta}</button>
                      </div>
                    </>
                  ) : <><p className="t2" style={{ fontSize: 14 }}>{v.relLine}</p><button className="btn ton" onClick={v.openReleases}>{v.relCta}</button></>}
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </PageScope>
  );
}
