import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError, type CellRow } from '@tangent/api-client';
import { DEPLOY_TARGET_LABELS, type SchoolRow } from '@tangent/contracts';
import { Dialog, Field, NumberField, SelectField, useShake, Icon, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { Card, Page, Tiles, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { url } from '../../app/base';
import { statusOf } from '../../app/format';

const TARGET: Record<string, string> = DEPLOY_TARGET_LABELS;
const fields = (e: unknown): Record<string, string> => (e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });

export function CellsPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [dlg, setDlg] = useState<{ kind: 'add' } | { kind: 'manage'; cell: CellRow } | { kind: 'move'; school: SchoolRow } | null>(null);
  const cells = useQuery({ queryKey: ['cells'], queryFn: app.api.cells });
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const list = cells.data ?? [];
  const canCells = app.can('policy.write');
  const canMove = app.can('schools.write');
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => ['cells', 'schools', 'fleet', 'actions'].includes(String(q.queryKey[0])) });
  return (
    <Page title={tr('console.cells_page.cells')} sub={tr('console.cells_page.where_schools_run_each_cell')} toast={toast} loading={cells.isLoading}
      error={cells.isError ? { message: (cells.error as Error).message, retry: () => void cells.refetch() } : null}
      actions={canCells ? <button className="btn pri" onClick={() => setDlg({ kind: 'add' })}><Icon name="plus" />{tr('console.cells_page.add_a_cell')}</button> : undefined}
      overlays={<>
        {dlg?.kind === 'add' && <AddCell onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); refresh(); say(m); }} />}
        {dlg?.kind === 'manage' && <ManageCell cell={dlg.cell} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); refresh(); say(m); }} />}
        {dlg?.kind === 'move' && <MoveSchool school={dlg.school} cells={list} onClose={() => setDlg(null)} onDone={(m) => { setDlg(null); refresh(); say(m); }} />}
      </>}>
      {list.length === 0 ? (
        <div>
          <EmptyState scene="cells" onAction={canCells ? () => setDlg({ kind: 'add' }) : undefined} />
        </div>
      ) : (
        <>
        <Tiles items={[
          { label: tr('console.cells_page.cells'), value: list.length, note: tr('console.cells_page.open_to_new_schools', { length: list.filter((c) => c.accepting).length }), tone: 'v' },
          { label: tr('console.cells_page.schools_placed'), value: list.reduce((n, c) => n + c.schools, 0), note: tr('console.cells_page.room_for', { p0: list.reduce((n, c) => n + c.maxSchools, 0) }), tone: 'a' },
          { label: tr('console.cells_page.space_used'), value: `${Math.round((list.reduce((n, c) => n + c.schools, 0) / Math.max(1, list.reduce((n, c) => n + c.maxSchools, 0))) * 100)}%`, note: tr('console.cells_page.across_every_cell'), tone: 'i' },
        ]} />
        <section className="grid" data-even="">
          {list.map((c) => {
            const here = (schools.data ?? []).filter((s) => s.cell === c.key);
            const full = c.maxSchools ? Math.round((c.schools / c.maxSchools) * 100) : 0;
            return (
              <Card key={c.key} title={tr('console.cells_page.cell', { key: c.key })} chip={<><span className="chip v">{TARGET[c.target] ?? c.target}</span>{!c.accepting && <span className="chip a">{tr('console.cells_page.closed_to_new_schools')}</span>}{canCells && <button className="btn sm" onClick={() => setDlg({ kind: 'manage', cell: c })}>{tr('console.cells_page.manage')}</button>}</>} span="s6">
                <div className="us">
                  <div className="r">{tr('console.cells_page.schools')}<b>{c.schools} {tr('console.cells_page.of')}{' '}{c.maxSchools}</b></div>
                  <div className={`bar ${full > 80 ? 'warn' : ''}`}><i style={{ width: `${full}%` }}></i></div>
                </div>
                <div className="kv" style={{ marginTop: 12 }}>{tr('console.cells_page.region')}<b>{c.region}</b></div>
                <div className="lbl" style={{ margin: '12px 0 4px' }}>{tr('console.cells_page.schools_here')}</div>
                {here.length === 0 && <EmptyNote icon="cells" title={tr('console.cells_page.no_schools_here_yet')} body={tr('console.cells_page.schools_placed_in_this_cell')} />}
                <div className="lscroll" data-even-scroll="" style={{ maxHeight: 260 }}>
                  {here.map((s) => {
                    const st = statusOf(s);
                    return (
                      <div key={s.id} className="kv" style={{ alignItems: 'center' }}>
                        <a href={url(`/schools/${s.id}`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${s.id}`); }} style={{ color: 'inherit', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</a>
                        <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className={`st ${st.tone}`}><i></i>{st.text}</span>{canMove && list.length > 1 && s.status === 'live' && <button className="btn sm" onClick={() => setDlg({ kind: 'move', school: s })}>{tr('console.cells_page.move')}</button>}</b>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </section>
        </>
      )}
    </Page>
  );
}

function AddCell({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  // Only the places this deployment can run a cell on, as the server says.
  const targets = useQuery({ queryKey: ['cell-targets'], queryFn: app.api.cellTargets, staleTime: Infinity });
  const [f, setF] = useState({ key: '', target: '', region: '', maxSchools: '25', connectionId: '' });
  const target = f.target || targets.data?.[0]?.key || '';
  const view = useQuery({ queryKey: ['integrations'], queryFn: app.api.integrations.view });
  const dbs = (view.data?.connections ?? []).filter((c) => (c.provider === 'postgres-server' || c.provider === 'neon') && c.state !== 'draft');
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const make = useMutation({ mutationFn: () => app.api.createCell({ key: f.key.trim().toLowerCase(), target: target as 'local', region: f.region.trim(), maxSchools: Number(f.maxSchools), connectionId: f.connectionId || null }), onSuccess: (r) => onDone(tr('console.cells_page.cell_added', { key: r.key, note: r.note })), onError: (e) => { setErr(fields(e)); shake.hit(); } });
  const go = () => {
    const p: Record<string, string> = {};
    if (!/^[a-z][a-z0-9-]{1,22}[a-z0-9]$/.test(f.key.trim().toLowerCase())) p.key = tr('console.cells_page.use_3_to_24_letters');
    if (f.region.trim().length < 2) p.region = tr('console.cells_page.name_the_place_like_frankfurt');
    if (!(Number(f.maxSchools) >= 1)) p.maxSchools = tr('console.cells_page.at_least_1');
    if (target === 'aws-cell' && !f.connectionId) p.connectionId = tr('console.cells_page.a_cloud_cell_needs_the');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else make.mutate();
  };
  return (
    <Dialog title={tr('console.cells_page.add_a_cell')} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <Field label={tr('console.cells_page.name')} value={f.key} onChange={set('key')} error={err.key} placeholder="eu-west-2" />
        <SelectField label={tr('console.cells_page.runs_on')} value={target} onChange={set('target')} options={(targets.data ?? []).map((t) => ({ value: t.key, label: t.label }))} />
        {targets.data?.find((t) => t.key === target) && <div className="help">{targets.data.find((t) => t.key === target)!.note}</div>}
        <div className="two"><Field label={tr('console.cells_page.region')} value={f.region} onChange={set('region')} error={err.region} placeholder={tr('console.cells_page.frankfurt')} /><NumberField label={tr('console.cells_page.most_schools')} min={1} value={f.maxSchools} onChange={set('maxSchools')} error={err.maxSchools} /></div>
        <SelectField label={target === 'aws-cell' ? tr('console.cells_page.where_its_schools_databases_are') : tr('console.cells_page.where_its_schools_databases_are_2')} value={f.connectionId} onChange={set('connectionId')} error={err.connectionId}
          options={[{ value: '', label: target === 'aws-cell' ? tr('console.cells_page.choose_a_school_databases_connection') : tr('console.cells_page.the_registry_s_own_server') }, ...dbs.map((c) => ({ value: c.id, label: c.name }))]} />
        {!dbs.length && <div className="help">{tr('console.cells_page.add_a_postgresql_server_or')}</div>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{tr('console.cells_page.cancel')}</button>
        <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? tr('console.cells_page.adding') : tr('console.cells_page.add_cell')}</button>
      </div>
    </Dialog>
  );
}

function ManageCell({ cell, onClose, onDone }: { cell: CellRow; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const [region, setRegion] = useState(cell.region);
  const [max, setMax] = useState(String(cell.maxSchools));
  const [accepting, setAccepting] = useState(cell.accepting);
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const save = useMutation({ mutationFn: () => app.api.patchCell(cell.key, { region: region.trim(), maxSchools: Number(max), accepting }), onSuccess: () => onDone(tr('console.cells_page.cell_was_updated', { key: cell.key })), onError: (e) => { setErr(fields(e)); shake.hit(); } });
  const [sure, setSure] = useState(false);
  const remove = useMutation({ mutationFn: () => app.api.removeCell(cell.key), onSuccess: () => onDone(tr('console.cells_page.cell_was_removed', { key: cell.key })), onError: (e) => { setErr(fields(e)); shake.hit(); } });
  return (
    <Dialog title={tr('console.cells_page.cell', { key: cell.key })} tag={{ text: TARGET[cell.target] ?? cell.target, tone: 'v' }} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <div className="two"><Field label={tr('console.cells_page.region')} value={region} onChange={setRegion} error={err.region} /><NumberField label={tr('console.cells_page.most_schools')} min={Math.max(1, cell.schools)} value={max} onChange={(v) => { setMax(v); setErr({}); }} error={err.maxSchools} hint={tr('console.cells_page.run_here_now', { schools: cell.schools })} /></div>
        <div className="tgl" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}><b style={{ font: '700 14px var(--fb)' }}>{tr('console.cells_page.accept_new_schools')}</b><div className="help">{tr('console.cells_page.turn_this_off_to_drain')}</div></div>
          <button className={`sw ${accepting ? 'on' : ''}`} role="switch" aria-checked={accepting} aria-label={tr('console.cells_page.accept_new_schools')} onClick={() => setAccepting(!accepting)}></button>
        </div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {cell.schools === 0 ? (sure
          ? <span className="tgrow"><button className="btn sm dngf" disabled={remove.isPending} onClick={() => remove.mutate()}>{tr('console.cells_page.yes_remove_it')}</button><button className="btn sm" onClick={() => setSure(false)}>{tr('console.cells_page.keep')}</button></span>
          : <button className="btn dng" onClick={() => setSure(true)}>{tr('console.cells_page.remove_this_cell')}</button>) : <span className="help" style={{ margin: 0 }}>{tr('console.cells_page.an_empty_cell_can_be')}</span>}
        <span className="tgrow">
          <button className="btn" onClick={onClose}>{tr('console.cells_page.cancel')}</button>
          <button className="btn pri" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? tr('console.cells_page.saving') : tr('console.cells_page.save')}</button>
        </span>
      </div>
    </Dialog>
  );
}

function MoveSchool({ school, cells, onClose, onDone }: { school: SchoolRow; cells: CellRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const here = cells.find((c) => c.key === school.cell);
  const options = cells.filter((c) => c.key !== school.cell);
  const usable = (c: CellRow) => c.accepting && c.schools < c.maxSchools && c.target === here?.target;
  const [to, setTo] = useState(options.find(usable)?.key ?? options[0]?.key ?? '');
  const [err, setErr] = useState('');
  const move = useMutation({
    mutationFn: (dry: boolean) => app.api.actions.request({ action: 'school.move', schoolId: school.id, params: { cell: to }, dryRun: dry }),
    onSuccess: (r) => (r.status === 'failed' ? setErr(r.summary) : onDone(r.status === 'pending_approval' ? tr('console.cells_page.sent_for_approval_a_second') : r.summary)),
    onError: (e) => setErr((e as Error).message),
  });
  const target = cells.find((c) => c.key === to);
  const why = target && !usable(target) ? (!target.accepting ? tr('console.cells_page.that_cell_is_closed_to') : target.schools >= target.maxSchools ? tr('console.cells_page.that_cell_is_full') : tr('console.cells_page.that_cell_runs_on_a')) : '';
  return (
    <Dialog title={tr('console.cells_page.move_2', { name: school.name })} tag={{ text: tr('console.cells_page.from', { cell: school.cell }), tone: 'v' }} onClose={onClose} width={500}>
      <div className="stack">
        <SelectField label={tr('console.cells_page.move_to')} value={to} onChange={(v) => { setTo(v); setErr(''); }} options={options.map((c) => ({ value: c.key, label: tr('console.cells_page.of_schools', { key: c.key, schools: c.schools, maxSchools: c.maxSchools, p3: usable(c) ? '' : tr('console.cells_page.not_available') }) }))} />
        {why && <div className="emsg" role="alert">{why}</div>}
        <div className="help">{tr('console.cells_page.on_the_test_track_every')}</div>
        {err && <div className="emsg" role="alert">{err}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{tr('console.cells_page.cancel')}</button>
        <button className="btn" disabled={!to || move.isPending} onClick={() => move.mutate(true)}>{tr('console.cells_page.rehearse')}</button>
        <button className="btn pri" disabled={!to || !!why || move.isPending} onClick={() => move.mutate(false)}>{move.isPending ? tr('console.cells_page.asking') : tr('console.cells_page.move_school')}</button>
      </div>
    </Dialog>
  );
}
