import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { Dialog, Field, NumberField, NumberInput, Select, useShake, Icon, EmptyState, t, EmptyNote, useUnsaved, busyFor } from '@tangent/web-ui';
import type { PolicyDoc, ReleaseRow } from '@tangent/contracts';
import { Card, Page, Tiles, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { ago } from '../../app/format';
import { url } from '../../app/base';
import { usePageTabs } from '../../app/tabs';
import { MigrationsTab } from './MigrationsTab';

const TONE: Record<ReleaseRow['status'], string> = { draft: 'n', rolling: 'v', paused: 'a', halted: 'c', done: 'g', rolled_back: 'a' };
const LABEL: Record<ReleaseRow['status'], string> = { draft: t('console.releases_page.ready_to_start'), rolling: t('console.releases_page.rolling_out'), paused: t('console.releases_page.paused'), halted: t('console.releases_page.halted'), done: t('console.releases_page.finished'), rolled_back: t('console.releases_page.rolled_back') };
const SCHOOL: Record<string, string> = { pending: 'n', rolling: 'v', done: 'g', failed: 'c', rolled_back: 'a' };
const WAVE: Record<string, string> = { pending: 'waiting', rolling: t('console.releases_page.checking_schools'), done: t('console.releases_page.signed_off'), halted: 'stopped', paused: 'paused', rolled_back: t('console.releases_page.marked_rolled_back') };
const WAVE_KINDS = [['internal', t('console.releases_page.our_own_schools')], ['pilot', t('console.releases_page.pilot_schools')], ['rest', t('console.releases_page.everyone_else')]] as const;

/** Releases, how they roll out, and the database changes they carry. */
export function ReleasesPage() {
  const { tab, tabs } = usePageTabs('/releases');
  const { toast, say } = useToast();
  if (tab === 'database') return <MigrationsTab tabs={tabs} />;
  if (tab === 'rules') return <Page title={t('console.releases_page.releases')} sub={t('console.releases_page.how_a_release_rolls_out')} toast={toast} tabs={tabs}><RolloutRules say={say} /></Page>;
  return <ReleasesList tabs={tabs} toast={toast} say={say} />;
}

function ReleasesList({ tabs, toast, say }: { tabs: React.ReactNode; toast: ReturnType<typeof useToast>['toast']; say: ReturnType<typeof useToast>['say'] }) {
  const app = useApp();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [back, setBack] = useState<ReleaseRow | null>(null);
  const list = useQuery({ queryKey: ['releases'], queryFn: app.api.releases.list, refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'rolling') ? 3000 : 20_000) });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => ['releases', 'fleet', 'schools'].includes(String(q.queryKey[0])) });
  const start = useMutation({ mutationFn: (id: string) => app.api.releases.start(id), onSuccess: () => { refresh(); say(t('console.releases_page.checking_schools_in_waves_it')); }, onError: (e) => say((e as Error).message, 'bad') });
  const pause = useMutation({ mutationFn: (b: { id: string; paused: boolean }) => app.api.releases.pause(b.id, b.paused), onSuccess: refresh, onError: (e) => say((e as Error).message, 'bad') });
  const rollback = useMutation({ mutationFn: (id: string) => app.api.releases.rollback(id), onSuccess: () => { setBack(null); refresh(); say(t('console.releases_page.marked_as_rolled_back_to')); }, onError: (e) => say((e as Error).message, 'bad') });
  const rows = list.data ?? [];
  const canWrite = app.can('releases.write');
  return (
    <Page title={t('console.releases_page.releases')} sub={t('console.releases_page.a_release_signs_schools_off')} toast={toast} loading={list.isLoading} error={list.isError ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      tabs={tabs} actions={<>{canWrite && <button className="btn pri" onClick={() => setCreating(true)}><Icon name="plus" />{t('console.releases_page.new_release')}</button>}</>}
      overlays={<>
        {creating && <CreateDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); refresh(); say(t('console.releases_page.release_created_start_it_when')); }} />}
        {back && (
          <Dialog title={t('console.releases_page.mark_as_rolled_back', { version: back.version })} tag={{ text: t('console.releases_page.the_code_does_not_change'), tone: 'a' }} onClose={() => setBack(null)} width={460}>
            <p>{t('console.releases_page.schools_signed_off_on')}{' '}{back.version} {t('console.releases_page.are_marked_with_the_version')}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button className="btn" onClick={() => setBack(null)}>{t('console.releases_page.keep_it')}</button><button className="btn dngf" disabled={rollback.isPending} onClick={() => rollback.mutate(back.id)}>{t('console.releases_page.mark_as_rolled_back_2')}</button></div>
          </Dialog>
        )}
      </>}>
      {rows.length === 0 ? (
        <div><EmptyState scene="releases" onAction={canWrite ? () => setCreating(true) : undefined} /></div>
      ) : [<Tiles key="tiles" items={[
        { label: t('console.releases_page.releases'), value: rows.length, note: t('console.releases_page.rolling_out_now', { length: rows.filter((r) => r.status === 'rolling').length }), tone: 'v' },
        { label: t('console.releases_page.latest'), value: rows[0]!.version, note: LABEL[rows[0]!.status], tone: 'a' },
        { label: t('console.releases_page.schools_on_it'), value: t('console.releases_page.of', { length: rows[0]!.waves.flatMap((w) => w.schools).filter((s) => s.state === 'done').length, length1: rows[0]!.waves.flatMap((w) => w.schools).length }), note: t('console.releases_page.updated_so_far'), tone: 'i' },
      ]} />, ...rows.map((r) => {
        const all = r.waves.flatMap((w) => w.schools);
        const done = all.filter((s) => s.state === 'done').length;
        const live = ['rolling', 'paused', 'halted', 'done'].includes(r.status);
        return (
          <Card key={r.id} title={r.version} chip={<span className={`st ${TONE[r.status]}`}><i></i>{LABEL[r.status]}</span>}>
            <div className="help">{r.notes || t('console.releases_page.no_notes')} {t('console.releases_page.by')}{' '}{r.createdBy} · {ago(r.createdAt)}</div>
            {r.haltReason && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{r.haltReason}</div>}
            {all.length > 0 && (
              <div className="us" style={{ margin: '12px 0 4px' }}>
                <div className="r">{t('console.releases_page.schools_updated')}<b>{done} {t('console.releases_page.of_2')}{' '}{all.length}</b></div>
                <div className="bar"><i style={{ width: `${(done / all.length) * 100}%` }}></i></div>
              </div>
            )}
            <div className="grid" style={{ marginTop: 12 }}>
              {r.waves.map((w) => (
                <div key={w.name} className="s4" style={{ minWidth: 0 }}>
                  <div className="lbl" style={{ marginBottom: 6 }}>{w.name} · {WAVE[w.status] ?? w.status}</div>
                  <div className="tgrow">{w.schools.map((s) => <span key={s.id} className={`st ${SCHOOL[s.state]}`}><i></i>{s.name}</span>)}{w.schools.length === 0 && <EmptyNote icon="search" title={t('console.releases_page.no_schools_match')} />}</div>
                </div>
              ))}
            </div>
            {canWrite && (
              <div className="tgrow" style={{ marginTop: 16 }}>
                {r.status === 'draft' && <button className="btn pri" onClick={() => start.mutate(r.id)} disabled={busyFor(start, r.id)}>{t('console.releases_page.start_rollout')}</button>}
                {(r.status === 'rolling' || r.status === 'paused') && <button className="btn" onClick={() => pause.mutate({ id: r.id, paused: r.status === 'rolling' })} disabled={busyFor(pause, r.id)}>{r.status === 'rolling' ? t('console.releases_page.pause') : t('console.releases_page.resume')}</button>}
                {live && r.status !== 'rolled_back' && <button className="btn dng" onClick={() => setBack(r)}>{t('console.releases_page.mark_as_rolled_back_3')}</button>}
              </div>
            )}
          </Card>
        );
      })]}
    </Page>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const now = new Date();
  const [version, setVersion] = useState(`${now.getFullYear()}.${now.getMonth() + 1}.1`);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  const create = useMutation({
    mutationFn: () => app.api.releases.create({ version: version.trim(), notes: notes.trim() }),
    onSuccess: onDone,
    onError: (e) => { setErr(e instanceof HttpError ? (e.fields.version ?? e.message) : (e as Error).message); shake.hit(); },
  });
  return (
    <Dialog title={t('console.releases_page.new_release')} onClose={onClose} width={480} shake={shake.cls}>
      <Field label={t('console.releases_page.version')} value={version} onChange={(v) => { setVersion(v); setErr(''); }} error={err} hint={t('console.releases_page.year_month_and_a_number')} />
      <Field label={t('console.releases_page.what_changed')} value={notes} onChange={setNotes} placeholder={t('console.releases_page.faster_attendance_fee_receipts_in')} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}><button className="btn" onClick={onClose}>{t('console.releases_page.cancel')}</button><button className="btn pri" disabled={create.isPending} onClick={() => create.mutate()}>{t('console.releases_page.create')}</button></div>
    </Dialog>
  );
}

/** How a release rolls out: the waves, when it stops by itself, and the window it prefers. Moved here from Blueprints. */
function RolloutRules({ say }: { say: (m: string, tone?: 'ok' | 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ['policy'], queryFn: app.api.policy.get });
  const [pol, setPol] = useState<PolicyDoc | null>(null);
  useEffect(() => { if (policy.data) setPol(policy.data); }, [policy.data]);
  const save = useMutation({ mutationFn: (p: PolicyDoc) => app.api.policy.set(p), onSuccess: (p) => { qc.setQueryData(['policy'], p); say(t('console.releases_page.rollout_rules_saved')); }, onError: (e) => say((e as Error).message, 'bad') });
  const can = app.can('policy.write');
  useUnsaved(!!pol && JSON.stringify(pol) !== JSON.stringify(policy.data));
  if (!pol) return <div className="skc" style={{ height: 320, borderRadius: 28 }} />;
  const ok = pol.waves.length > 0 && pol.waves.at(-1)!.matches === 'rest' && pol.waves.every((w) => w.name.trim().length > 0 && w.batch >= 1);
  const dirty = JSON.stringify(pol) !== JSON.stringify(policy.data);
  return (
    <Card title={t('console.releases_page.waves')}>
      <div className="help" style={{ marginTop: 0 }}>{t('console.releases_page.a_release_signs_schools_off_2')}</div>
      <div className="lscroll" style={{ marginTop: 12 }}>
        {pol.waves.map((w, i) => (
          <div key={i} className="wvr">
            <span className="av" style={{ width: 28, height: 28, fontSize: 12, background: 'var(--s2)', color: 'var(--ink3)', boxShadow: 'none' }}>{i + 1}</span>
            <input className="hws wide" style={{ width: 'auto', textAlign: 'start', padding: '0 12px', flex: '1 1 160px' }} aria-label={t('console.releases_page.name_of_wave', { p0: i + 1 })} value={w.name} disabled={!can} onChange={(e) => setPol({ ...pol, waves: pol.waves.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <Select compact aria-label={t('console.releases_page.who_is_in_wave', { p0: i + 1 })} value={w.matches} disabled={!can} onChange={(v) => setPol({ ...pol, waves: pol.waves.map((x, j) => (j === i ? { ...x, matches: v as 'rest' } : x)) })} options={WAVE_KINDS.map(([value, label]) => ({ value, label }))} />
            <label className="hwc" style={{ whiteSpace: 'nowrap' }}>{t('console.releases_page.schools_at_a_time')}<NumberInput min={1} max={100} value={String(w.batch)} disabled={!can} aria-label={t('console.releases_page.schools_at_a_time')} onChange={(v) => setPol({ ...pol, waves: pol.waves.map((x, j) => (j === i ? { ...x, batch: Math.max(1, Number(v) || 1) } : x)) })} /></label>
            {can && <button className="btn sm dng" disabled={pol.waves.length < 2} aria-label={t('console.releases_page.remove_wave', { p0: i + 1 })} onClick={() => setPol({ ...pol, waves: pol.waves.filter((_, j) => j !== i) })}>{t('console.releases_page.remove')}</button>}
          </div>
        ))}
      </div>
      {!ok && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{t('console.releases_page.the_last_wave_must_be')}</div>}
      <div className="two" style={{ marginTop: 12 }}>
        <NumberField label={t('console.releases_page.stop_a_rollout_above_error')} min={0} max={100} value={String(pol.halt.errorRatePct)} disabled={!can} onChange={(v) => setPol({ ...pol, halt: { ...pol.halt, errorRatePct: Number(v) } })} />
        <NumberField label={t('console.releases_page.or_when_p95_passes_ms')} min={100} step={50} value={String(pol.halt.p95Ms)} disabled={!can} onChange={(v) => setPol({ ...pol, halt: { ...pol.halt, p95Ms: Number(v) } })} />
      </div>
      <Field label={t('console.releases_page.maintenance_window')} value={pol.maintenanceWindow} onChange={(v) => setPol({ ...pol, maintenanceWindow: v })} disabled={!can} hint={t('console.releases_page.shown_to_schools_releases_prefer')} />
      <div className="help">{t('console.releases_page.the_app_bundle_prefix_is')}{' '}<a href={url('/builds')} onClick={(e) => { e.preventDefault(); app.go('/builds'); }}>{t('console.releases_page.mobile_builds_build_settings')}</a>.</div>
      {can && (
        <div className="tgrow" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => setPol({ ...pol, waves: [...pol.waves.slice(0, -1), { name: t('console.releases_page.next_group'), matches: 'pilot', batch: 5 }, pol.waves.at(-1)!] })}>{t('console.releases_page.add_a_wave')}</button>
          <button className="btn pri" disabled={!dirty || !ok || save.isPending} onClick={() => save.mutate(pol)}>{t('console.releases_page.save_rollout_rules')}</button>
        </div>
      )}
    </Card>
  );
}
