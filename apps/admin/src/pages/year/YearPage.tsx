import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PromotionPreview, YearRow } from '@tangent/contracts';
import { fmtMoney, schoolToday } from '@tangent/contracts';
import { DateField, Dialog, EmptyCard, Field, Select, useShake, EmptyNote, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { StudentPick, dateLabel, problem, stamp } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';
import { useSetupSections } from './SetupSections';

const STATUS: Record<YearRow['status'], { text: string; tone: string }> = { current: { text: t('admin.year_page.current'), tone: 'g' }, draft: { text: t('admin.year_page.draft'), tone: 'a' }, archived: { text: t('admin.year_page.archived'), tone: '' } };
const rupees = (n: number) => fmtMoney(n);
type Kid = { id: string; name: string; className: string };

/** Which of the school's setup records each tab of Academic year lists (config-engine: the school module's year page). */
const KINDS: Record<string, string[]> = { terms: ['years', 'terms'], holidays: ['holidays'], classes: ['classes'], subjects: ['subjects'], bells: ['periods'] };
const SUBS: Record<string, string> = {
  terms: t('admin.year_page.the_school_s_years_and'), holidays: t('admin.year_page.days_the_school_is_closed'),
  classes: t('admin.year_page.every_class_and_its_class'), subjects: t('admin.year_page.what_is_taught_and_how'), bells: t('admin.year_page.when_each_period_break_and'),
};

export function YearPage() {
  const { tab, tabs } = usePageTabs('/year');
  const { toast, say } = useToast();
  const setup = useSetupSections(KINDS[tab] ?? [], say);
  if (tab === 'year-end') return <YearEnd tabs={tabs} />;
  return <Page title={t('admin.year_page.academic_year')} sub={SUBS[tab] ?? ''} toast={toast} tabs={tabs} overlays={setup.overlay}>{setup.view}</Page>;
}

/** Drafting the next year, promoting students into it, and starting it. */
function YearEnd({ tabs }: { tabs: React.ReactNode }) {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [dlg, setDlg] = useState<'year' | 'promote' | null>(null);
  // Starting a year, removing a draft, undoing a promotion and bringing a leaver back each ask first.
  const [sure, setSure] = useState<{ what: 'start' | 'remove' | 'undo' | 'rejoin'; id: string; text: string } | null>(null);
  const view = useQuery({ queryKey: ['year'], queryFn: app.api.year.view });
  const can = app.user.permissions.includes('year.manage');
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => ['year', 'students', 'classes', 'shell'].includes(String(q.queryKey[0])) });
  const done = (m: string) => { setDlg(null); refresh(); say(m); };
  const act = useMutation({
    mutationFn: async (a: { what: 'start' | 'remove' | 'undo' | 'rejoin'; id: string }) => {
      if (a.what === 'start') { await app.api.year.start(a.id); return t('admin.year_page.the_new_year_has_started'); }
      if (a.what === 'remove') { await app.api.year.remove(a.id); return t('admin.year_page.the_draft_year_was_removed'); }
      if (a.what === 'undo') { await app.api.year.undo(a.id); return t('admin.year_page.every_student_is_back_where'); }
      await app.api.year.rejoin(a.id); return t('admin.year_page.the_student_is_back_on');
    },
    onSuccess: (m) => { refresh(); say(m); }, onError: (e) => say((e as Error).message, 'bad'),
  });
  const v = view.data;
  const draft = v?.years.find((y) => y.status === 'draft');
  const latestRun = v?.runs[0];
  return (
    <Page title={t('admin.year_page.academic_year')} sub={t('admin.year_page.promote_students_start_the_new')} toast={toast} loading={view.isLoading && !v}
      error={view.isError && !v ? { message: (view.error as Error).message, retry: () => void view.refetch() } : null}
      tabs={tabs} actions={<>{can && <button className="btn pri" disabled={!draft} data-tip={draft ? undefined : t('admin.year_page.draft_the_next_year_first')} onClick={() => setDlg('promote')}>{t('admin.year_page.promote_students')}</button>}</>}
      overlays={v && <>
        {dlg === 'year' && <NewYear years={v.years} onClose={() => setDlg(null)} onDone={done} />}
        {dlg === 'promote' && <Promote years={v.years} onClose={() => setDlg(null)} onDone={done} />}
        {sure && (
          <Dialog title={t('admin.year_page.are_you_sure')} onClose={() => setSure(null)} width={460}>
            <p style={{ margin: 0, font: '400 14px/1.5 var(--fb)' }}>{sure.text}</p>
            <div className="tgrow" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn" onClick={() => setSure(null)}>{t('admin.year_page.not_now')}</button>
              <button className="btn pri" disabled={act.isPending} onClick={() => { act.mutate({ what: sure.what, id: sure.id }); setSure(null); }}>{t('admin.year_page.yes')}</button>
            </div>
          </Dialog>
        )}
      </>}>
      {v && <>
        <section className="grid" data-even="">
          <Card span="s6" title={t('admin.year_page.academic_years')} chip={can && !draft ? <button className="btn sm" onClick={() => setDlg('year')}>{t('admin.year_page.draft_next_year')}</button> : undefined}>
            {!v.years.length && <EmptyNote icon="year" title={t('admin.year_page.no_year_is_set_up')} body={t('admin.year_page.tangent_adds_the_first_one')} />}
            {v.years.map((y) => (
              <div key={y.id} className="kv" style={{ alignItems: 'center' }}>
                <span style={{ minWidth: 0 }}><b style={{ color: 'var(--ink)' }}>{y.label}</b><br /><small className="help">{dateLabel(y.startsOn)} {y.startsOn.slice(0, 4)} {t('admin.year_page.to')}{' '}{dateLabel(y.endsOn)} {y.endsOn.slice(0, 4)}{y.status === 'current' ? t('admin.year_page.classes_students', { classes: y.classes, students: y.students }) : ''}</small></span>
                <b style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>
                  <span className={`chip ${STATUS[y.status].tone}`}>{STATUS[y.status].text}</span>
                  {can && y.status === 'draft' && <><button className="btn sm pri" disabled={act.isPending || !v.runs.some((r) => r.toYear === y.id && !r.undoneAt)} data-tip={v.runs.some((r) => r.toYear === y.id && !r.undoneAt) ? undefined : t('admin.year_page.promote_students_into_it_first')} onClick={() => setSure({ what: 'start', id: y.id, text: t('admin.year_page.start_the_year_now_running', { label: y.label }) })}>{t('admin.year_page.start')}</button><button className="btn sm" disabled={act.isPending} onClick={() => setSure({ what: 'remove', id: y.id, text: t('admin.year_page.remove_the_draft', { label: y.label }) })}>{t('admin.year_page.remove')}</button></>}
                </b>
              </div>
            ))}
            <div className="help" style={{ marginTop: 10 }}>{t('admin.year_page.order_of_things_draft_the')}</div>
          </Card>
          <Card span="s6" title={t('admin.year_page.promotions')} chip={latestRun && !latestRun.undoneAt && can ? <button className="btn sm" disabled={act.isPending} onClick={() => setSure({ what: 'undo', id: latestRun.id, text: t('admin.year_page.undo_the_latest_promotion_students', { students: latestRun.students }) })}>{t('admin.year_page.undo_the_latest')}</button> : undefined}>
            {!v.runs.length ? <EmptyNote icon="up" title={t('admin.year_page.no_promotion_has_run_yet')} body={t('admin.year_page.promote_students_shows_where_each')} />
              : v.runs.map((r) => (
                <div key={r.id} className="kv" style={{ alignItems: 'center' }}>
                  <span>{r.students} {t('admin.year_page.students_to')}{' '}{r.toYear}<br /><small className="help">{stamp(r.createdAt)}</small></span>
                  <b>{r.undoneAt ? <span className="chip">{t('admin.year_page.undone')}</span> : <span className="chip g">{t('admin.year_page.applied')}</span>}</b>
                </div>
              ))}
          </Card>
        </section>
        <Card title={t('admin.year_page.students_who_left')}>
          <p className="help" style={{ margin: 0 }}>{v.leavers.length ? t('admin.year_page.left', { length: v.leavers.length, p1: v.leavers.length === 1 ? 'student has' : 'students have' }) : t('admin.year_page.nobody_has_left_yet')} {t('admin.year_page.their_records_are_kept_for')}{' '}{Math.round(v.retentionMonths / 12)} {v.retentionMonths === 12 ? 'year' : 'years'}{t('admin.year_page.then_erased_they_are_listed')}</p>
          {v.leavers.length > 0 && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => app.go('/students')}>{t('admin.year_page.open_students')}</button>}
        </Card>
      </>}
    </Page>
  );
}

function NewYear({ years, onClose, onDone }: { years: YearRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const cur = years.find((y) => y.status === 'current');
  const nextStart = cur ? `${Number(cur.endsOn.slice(0, 4))}-${cur.startsOn.slice(5)}` : schoolToday();
  const [f, setF] = useState({ label: cur ? `${Number(cur.label.slice(0, 4)) + 1}-${String(Number(cur.label.slice(0, 4)) + 2).slice(2)}` : '', startsOn: nextStart > (cur?.endsOn ?? '') ? nextStart : '', endsOn: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (x: string) => { setF((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const save = useMutation({ mutationFn: () => app.api.year.create(f), onSuccess: () => onDone(t('admin.year_page.is_drafted_promote_students_then', { label: f.label })), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  return (
    <Dialog title={t('admin.year_page.draft_next_year')} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.year_page.name')} value={f.label} onChange={set('label')} error={err.label} placeholder="2027-28" />
        <div className="two"><DateField label={t('admin.year_page.starts')} value={f.startsOn} onChange={set('startsOn')} error={err.startsOn} /><DateField label={t('admin.year_page.ends')} value={f.endsOn} onChange={set('endsOn')} error={err.endsOn} /></div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.year_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || !f.label || !f.startsOn || !f.endsOn} onClick={() => save.mutate()}>{save.isPending ? t('admin.year_page.saving') : t('admin.year_page.draft_year')}</button>
      </div>
    </Dialog>
  );
}

function Promote({ years, onClose, onDone }: { years: YearRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const preview = useQuery({ queryKey: ['year', 'preview'], queryFn: app.api.year.preview });
  const [moves, setMoves] = useState<PromotionPreview['classes']>([]);
  const [held, setHeld] = useState<Kid[]>([]);
  const [leaving, setLeaving] = useState<Kid[]>([]);
  const target = years.find((y) => y.status === 'draft');
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (preview.data) setMoves(preview.data.classes); }, [preview.data]);
  const run = useMutation({
    mutationFn: () => app.api.year.promote({ toYear: target!.id, moves: moves.map((m) => ({ fromClassId: m.fromClassId, toClassId: m.toClassId })), detained: held.map((k) => k.id), leaving: leaving.map((k) => k.id) }),
    onSuccess: (r) => onDone(t('admin.year_page.students_moved_up_and_left', { moved: r.moved, left: r.left })), onError: (e) => { setErr((e as Error).message); shake.hit(); },
  });
  const classes = preview.data?.classes ?? [];
  const total = moves.reduce((n, m) => n + m.students, 0);
  return (
    <Dialog title={t('admin.year_page.promote_students')} tag={target ? { text: t('admin.year_page.into', { label: target.label }), tone: 'v' } : undefined} onClose={onClose} width={640} shake={shake.cls}>
      {preview.isLoading ? <div className="skc" style={{ height: 220, borderRadius: 16 }} /> : !classes.length ? <EmptyCard title={t('admin.year_page.promotion')} chip={{ text: t('admin.year_page.0_classes'), tone: 'v' }} icon="people" heading={t('admin.year_page.no_classes_to_promote')} body={t('admin.year_page.classes_come_from_academic_year')} /> : (
        <div className="stack">
          <div className="help">{t('admin.year_page.each_class_moves_to_the')}</div>
          <div className="lscroll" style={{ maxHeight: 280 }}>
            {moves.map((m, i) => (
              <div key={m.fromClassId} className="kv" style={{ alignItems: 'center' }}>
                <span>{m.fromName} · {m.students}</span>
                <b style={{ minWidth: 200 }}><Select compact aria-label={t('admin.year_page.where_goes', { fromName: m.fromName })} value={m.toClassId ?? ''} onChange={(x) => setMoves((l) => l.map((y, j) => (j === i ? { ...y, toClassId: x || null } : y)))}
                  options={[{ value: '', label: t('admin.year_page.leaves_the_school') }, ...classes.map((c) => ({ value: c.fromClassId, label: c.fromName }))]} /></b>
              </div>
            ))}
          </div>
          <div>
            <StudentPick label={t('admin.year_page.detained_stay_in_their_class')} value={null} onChange={(s) => s && setHeld((l) => (l.some((x) => x.id === s.id) ? l : [...l, s]))} />
            {held.length > 0 && <div className="tgrow" style={{ marginTop: 8 }}>{held.map((k) => <button key={k.id} type="button" className="chip a" onClick={() => setHeld((l) => l.filter((x) => x.id !== k.id))}>{k.name} ×</button>)}</div>}
          </div>
          <div>
            <StudentPick label={t('admin.year_page.leaving_the_school_besides_the')} value={null} onChange={(s) => s && setLeaving((l) => (l.some((x) => x.id === s.id) ? l : [...l, s]))} />
            {leaving.length > 0 && <div className="tgrow" style={{ marginTop: 8 }}>{leaving.map((k) => <button key={k.id} type="button" className="chip c" onClick={() => setLeaving((l) => l.filter((x) => x.id !== k.id))}>{k.name} ×</button>)}</div>}
          </div>
          {!!preview.data?.dues && <div className="help">{rupees(preview.data.dues)} {t('admin.year_page.is_still_owed_by')}{' '}{preview.data.duesStudents} {t('admin.year_page.students_it_carries_forward_nothing')}</div>}
          {err && <div className="emsg" role="alert">{err}</div>}
        </div>
      )}
      {/* A last look at the numbers before anything moves. */}
      {checking && (() => {
        const tops = moves.filter((m) => m.toClassId === null).reduce((n, m) => n + m.students, 0);
        const out = tops + leaving.length;
        return <div className="card" style={{ padding: 16, marginTop: 16 }}><b style={{ font: '700 15px var(--fb)' }}>{Math.max(0, total - out - held.length)} {t('admin.year_page.move_up')}{' '}{held.length} {t('admin.year_page.stay_in_their_class')}{' '}{out} {t('admin.year_page.leave_the_school')}</b><p className="help" style={{ margin: '6px 0 0' }}>{t('admin.year_page.into_2')}{' '}{target?.label}{t('admin.year_page.undo_stays_on_this_page')}</p></div>;
      })()}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={checking ? () => setChecking(false) : onClose}>{checking ? t('admin.year_page.back') : t('admin.year_page.cancel')}</button>
        {checking
          ? <button className="btn pri" disabled={run.isPending || !target || !moves.length} onClick={() => run.mutate()}>{run.isPending ? t('admin.year_page.promoting') : t('admin.year_page.yes_promote')}</button>
          : <button className="btn pri" disabled={!target || !moves.length} onClick={() => setChecking(true)}>{t('admin.year_page.check_the_numbers')}</button>}
      </div>
    </Dialog>
  );
}

