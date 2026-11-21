import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportInputIn } from '@tangent/api-client';
import { IMPORT_KINDS, IMPORT_SOURCES, type ImportBatchRow, type ImportColumn, type ImportKind, type ImportPreview, type MigrationView, type SchoolDetail } from '@tangent/contracts';
import { Dialog, EmptyCard, Field, FilePick, Select, EmptyNote, t as tr } from '@tangent/web-ui';
import { RecordsTab } from './IntegrationsTab';
import { useApp } from '../../app/context';
import { when } from '../../app/format';

type Say = (text: string, tone?: 'ok' | 'bad') => void;
/** What is being imported: a file (CSV text or an .xlsx as a data URL), or rows typed or fixed in the grid. */
type Source = { kind: 'file'; fileName: string; content: string; uploadId?: string } | { kind: 'rows'; fileName: string; rows: Record<string, string>[]; uploadId?: string };

const SOURCES = IMPORT_SOURCES;
const SHOWN = 100;
const blank = (k: ImportKind) => Object.fromEntries(k.columns.map((c) => [c.key, '']));
const readFile = (f: File) => (/\.(csv|txt)$/i.test(f.name) ? f.text() : new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error(tr('console.data_tab.that_file_could_not_be'))); r.readAsDataURL(f); }));
const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

/**
 * A school's data: Tangent's onboarding team imports what the school sent, checks it adds up and undoes what was wrong; the
 * export of everything; leavers past retention; and, at the bottom, erasing the school.
 */
export function DataTab({ d, say, danger }: { d: SchoolDetail; say: Say; danger: React.ReactNode }) {
  const schoolId = d.id;
  const app = useApp();
  const [undoing, setUndoing] = useState<ImportBatchRow | null>(null);
  const qc = useQueryClient();
  // While a big import runs in the background, the page looks again every few seconds.
  const q = useQuery({ queryKey: ['migration', schoolId], queryFn: () => app.api.migration.view(schoolId), refetchInterval: (x) => ((x.state.data?.runs ?? []).some((r) => r.status === 'running') ? 4000 : false) });
  const can = app.can('schools.configure');
  const [kindKey, setKindKey] = useState('');
  const [job, setJob] = useState<{ src: Source | null; mapping?: Record<string, string>; values?: Record<string, Record<string, string>>; rev: number }>({ src: null, rev: 0 });
  const { src, mapping, values } = job;
  // A new revision on every change: the query key stays small however big the file is.
  const change = (s: Source | null, m?: Record<string, string>, vals?: Record<string, Record<string, string>>) => setJob((j) => ({ src: s, mapping: m, values: vals, rev: j.rev + 1 }));
  const v = q.data;
  const kind = v?.kinds.find((k) => k.key === (kindKey || v.kinds[0]?.key));
  const input = (): ImportInputIn | null => (!src || !kind ? null : src.kind === 'file'
    ? { kind: kind.key, csv: src.content, fileName: src.fileName, uploadId: src.uploadId, mapping, values }
    : { kind: kind.key, rows: src.rows, fileName: src.fileName, uploadId: src.uploadId });
  const preview = useQuery({
    queryKey: ['import-preview', schoolId, kind?.key, src?.fileName, job.rev], enabled: !!src && !!kind,
    // The last preview stays on screen only while the same file of the same kind is checked again, never under another file.
    queryFn: () => app.api.migration.preview(schoolId, input()!), retry: false, staleTime: Infinity,
    placeholderData: (prev, last) => (last?.queryKey[2] === kind?.key && last?.queryKey[3] === src?.fileName ? prev : undefined),
  });
  const refresh = (next?: Partial<MigrationView>) => { if (next && v) qc.setQueryData(['migration', schoolId], { ...v, ...next }); void qc.invalidateQueries({ queryKey: ['migration', schoolId] }); void qc.invalidateQueries({ queryKey: ['school', schoolId] }); };
  const fail = (e: unknown) => say((e as Error).message, 'bad');
  const commit = useMutation({
    mutationFn: () => app.api.migration.commit(schoolId, input()!),
    onSuccess: (b) => { change(null); refresh(); if ('run' in b) { say(tr('console.data_tab.importing_in_background', { rows: b.run.rows })); return; } say(tr('console.data_tab.imported_added_updated', { p0: kind!.label.toLowerCase(), created: b.created, updated: b.updated, p3: b.skipped ? tr('console.data_tab.left_out_2', { skipped: b.skipped }) : '' })); },
    onError: fail,
  });
  const undo = useMutation({ mutationFn: (id: string) => app.api.migration.undo(schoolId, id), onSuccess: (batches) => { setUndoing(null); refresh({ batches }); say(tr('console.data_tab.undone_everything_it_changed_is')); }, onError: fail });
  // Setting a file aside says why: the school reads it under Moving in.
  const [asideFor, setAsideFor] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const aside = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => app.api.migration.setAside(schoolId, id, reason), onSuccess: (uploads) => { setAsideFor(null); setWhy(''); refresh({ uploads }); }, onError: fail });
  const open = useMutation({
    mutationFn: (id: string) => app.api.migration.upload(schoolId, id),
    onSuccess: (f, id) => change({ kind: 'file', fileName: f.fileName, content: f.content, uploadId: id }),
    onError: fail,
  });
  const exp = useMutation({ mutationFn: () => app.api.migration.exportAll(schoolId), onSuccess: (b) => save(b, `${schoolId}-export.zip`), onError: fail });
  const tpl = useMutation({ mutationFn: (k: string) => app.api.migration.template(schoolId, k), onSuccess: (blob, k) => save(blob, `${k}-template.xlsx`), onError: fail });

  if (q.isLoading) return <div className="skc" style={{ height: 420, borderRadius: 24 }} />;
  if (q.isError || !v) return <EmptyCard error title={tr('console.data_tab.data')} chip={{ text: tr('console.data_tab.couldn_t_load'), tone: 'c' }} icon="warning" heading={tr('console.data_tab.the_school_s_data_didn')} body={(q.error as Error)?.message ?? ''} actions={<button className="btn pri" onClick={() => void q.refetch()}>{tr('console.data_tab.try_again')}</button>} />;
  const pickKind = (k: string) => { setKindKey(k); change(null); };
  return (
    <section className="grid">
      {can && kind && (
        <div className="card s12 rise">
          <div className="ch" style={{ flexWrap: 'wrap', gap: 10 }}><h2>{tr('console.data_tab.import')}</h2><span className="grow"></span><button className="btn sm" disabled={tpl.isPending} onClick={() => tpl.mutate(kind.key)}>{tr('console.data_tab.blank_template')}</button></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="fld" style={{ flex: '1 1 240px', maxWidth: 360 }}><label htmlFor="imp-kind">{tr('console.data_tab.what_to_import')}</label><Select id="imp-kind" value={kind.key} onChange={pickKind} options={v.kinds.map((k, i) => ({ value: k.key, label: `${i + 1}. ${k.label}` }))} /></div>
            <FilePick accept=".csv,.txt,.xlsx,.xml,.mrc" onPick={(f) => void readFile(f).then((content) => change({ kind: 'file', fileName: f.name, content }), fail)}>{tr('console.data_tab.choose_a_file')}</FilePick>
            <button className="btn" onClick={() => change({ kind: 'rows', fileName: tr('console.data_tab.typed_in_the_console'), rows: Array.from({ length: 5 }, () => blank(kind)) })}>{tr('console.data_tab.type_rows')}</button>
          </div>
          <div className="help" style={{ marginTop: 8 }}>{kind.blurb} {tr('console.data_tab.import_in_the_order_of')}</div>
          {src && <PreviewPanel kind={kind} src={src} preview={preview.data} loading={preview.isFetching} error={preview.isError ? (preview.error as Error).message : ''}
            onMap={(m) => change(src, m, values)} onValues={(vals) => change(src, mapping, vals)} onRows={(rows) => change({ kind: 'rows', fileName: src.fileName, rows, uploadId: src.uploadId })}
            onCancel={() => change(null)} onCommit={() => commit.mutate()} committing={commit.isPending} />}
        </div>
      )}

      <div className="card s12 rise">
        <div className="ch"><h2>{tr('console.data_tab.imports')}</h2><span className="chip">{v.batches.length}</span></div>
        <div className="help">{tr('console.data_tab.each_import_is_one_batch')}</div>
        {v.runs.map((r) => (
          // A big file's result ("129,942 added, 0 changed, 0 left out") goes under its name on a phone instead of off the edge.
          <div key={r.id} className="kv" style={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
            <span>{IMPORT_KINDS.find((k) => k.key === r.kind)?.label ?? r.kind} · {r.fileName} · {tr('console.data_tab.rows_n', { n: r.rows })}<small style={{ display: 'block', color: r.error ? 'var(--bad)' : 'var(--ink3)' }}>{r.error ?? `${r.by} · ${when(r.startedAt)}`}</small></span>
            <b><span className={`chip ${r.status === 'done' ? 'g' : r.status === 'failed' ? 'c' : 'a'}`}>{r.status === 'running' ? tr('console.data_tab.running') : r.status === 'done' ? tr('console.data_tab.run_done', { created: r.created ?? 0, updated: r.updated ?? 0, skipped: r.skipped ?? 0 }) : tr('console.data_tab.run_failed')}</span></b>
          </div>
        ))}
        {v.batches.length === 0 ? <div style={{ marginTop: 10 }}><EmptyNote icon="upload" title={tr('console.data_tab.nothing_imported_yet')} body={tr('console.data_tab.each_import_shows_here_with')} /></div> : v.batches.map((b) => <BatchRow key={b.id} b={b} kinds={v.kinds} canUndo={can && b.canUndo} busy={undo.isPending} onUndo={() => setUndoing(b)} />)}
        {undoing && (
          <Dialog title={tr('console.data_tab.undo_this_import')} tag={{ text: v.kinds.find((k) => k.key === undoing.kind)?.label ?? undoing.kind, tone: 'a' }} onClose={() => setUndoing(null)} width={460}>
            <p style={{ marginTop: 0 }}>{tr('console.data_tab.it_updated_go_back_to', { created: undoing.created, updated: undoing.updated })}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn" onClick={() => setUndoing(null)}>{tr('console.data_tab.keep_it')}</button>
              <button className="btn dngf" disabled={undo.isPending} onClick={() => undo.mutate(undoing.id)}>{tr('console.data_tab.undo')}{' '}{undoing.created + undoing.updated} {tr('console.data_tab.rows')}</button>
            </div>
          </Dialog>
        )}
      </div>

      <div className="card s12 rise">
        <div className="ch"><h2>{tr('console.data_tab.files_from_the_school')}</h2><span className="chip">{v.uploads.filter((u) => u.status === 'new').length} {tr('console.data_tab.waiting')}</span></div>
        <div className="help">{tr('console.data_tab.what_the_school_sent_from')}</div>
        {v.uploads.length === 0 ? <div style={{ marginTop: 10 }}><EmptyNote icon="file" title={tr('console.data_tab.no_files_yet')} body={tr('console.data_tab.spreadsheets_the_school_sends_for')} /></div> : v.uploads.map((u) => (
          <div key={u.id} className="rw" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 8, height: 'auto', padding: '10px 0', cursor: 'default' }}>
            <span style={{ minWidth: 0, flex: '1 1 220px' }}><b style={{ font: '700 14px var(--fb)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={u.fileName}>{u.fileName}</b><small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{u.note || (u.rows ? tr('console.data_tab.rows_2', { rows: u.rows }) : tr('console.data_tab.read_by_eye'))}</small></span>
            <span style={{ color: 'var(--ink2)', font: '600 13px var(--fb)' }}>{u.uploadedBy} · {when(u.at)}{u.status === 'set_aside' && u.setAsideReason ? tr('console.data_tab.set_aside', { setAsideReason: u.setAsideReason }) : ''}</span>
            {asideFor === u.id && (
              <span style={{ flex: '1 1 100%', display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 260px' }}><Field label={tr('console.data_tab.why_the_school_reads_this')} value={why} onChange={setWhy} maxLength={200} placeholder={tr('console.data_tab.this_is_last_year_s')} /></span>
                <button className="btn sm pri" disabled={aside.isPending || why.trim().length < 3} onClick={() => aside.mutate({ id: u.id, reason: why.trim() })}>{tr('console.data_tab.set_aside_2')}</button>
                <button className="btn sm" onClick={() => setAsideFor(null)}>{tr('console.data_tab.cancel')}</button>
              </span>
            )}
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginInlineStart: 'auto' }}>
              {u.status === 'imported' ? <span className="chip g">{tr('console.data_tab.imported')}</span> : <>
                {can && /\.(csv|txt|xlsx)$/i.test(u.fileName) && <button className="btn sm" disabled={open.isPending} onClick={() => open.mutate(u.id)}>{tr('console.data_tab.open')}</button>}
                {can && <button className="btn sm" disabled={aside.isPending} onClick={() => (u.status === 'set_aside' ? aside.mutate({ id: u.id, reason: '' }) : setAsideFor(u.id))}>{u.status === 'set_aside' ? tr('console.data_tab.bring_back') : tr('console.data_tab.set_aside_2')}</button>}
              </>}
              <button className="btn sm" onClick={() => void app.api.migration.upload(schoolId, u.id).then((f) => save(f.content.startsWith('data:') ? dataBlob(f.content) : new Blob([f.content], { type: 'text/csv' }), f.fileName), fail)}>{tr('console.data_tab.download')}</button>
            </span>
          </div>
        ))}
      </div>

      {can && (
        <div className="card s12 rise">
          <div className="ch"><h2>{tr('console.data_tab.export')}</h2></div>
          <div className="help">{tr('console.data_tab.the_export_is_every_kind')}</div>
          <div style={{ marginTop: 12 }}><button className="btn" disabled={exp.isPending} onClick={() => exp.mutate()}>{exp.isPending ? tr('console.data_tab.preparing') : tr('console.data_tab.export_everything')}</button></div>
        </div>
      )}

      <RecordsTab d={d} say={say} />
      {danger}
    </section>
  );
}

function dataBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const bin = atob(body ?? '');
  return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream' });
}

function BatchRow({ b, kinds, canUndo, busy, onUndo }: { b: ImportBatchRow; kinds: ImportKind[]; canUndo: boolean; busy: boolean; onUndo: () => void }) {
  return (
    <div className="rw" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 16, rowGap: 8, height: 'auto', padding: '12px 0', cursor: 'default' }}>
      <span style={{ minWidth: 0, flex: '1 1 260px' }}>
        <b style={{ font: '700 14px var(--fb)' }}>{kinds.find((k) => k.key === b.kind)?.label ?? b.kind}</b>
        <small style={{ display: 'block', color: 'var(--ink3)', font: '600 12px var(--fb)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.fileName || tr('console.data_tab.typed')} · {SOURCES[b.source] ?? b.source} · {b.byName} · {when(b.at)}</small>
        {b.notes.map((n) => <small key={n} style={{ display: 'block', color: 'var(--warn)', font: '600 12px var(--fb)', marginTop: 4 }}>{n}</small>)}
      </span>
      <span className="tgrow" style={{ gap: 6, flex: '1 1 260px' }}>
        <span className="chip g">{b.created} {tr('console.data_tab.added')}</span><span className="chip">{b.updated} {tr('console.data_tab.updated')}</span>{b.skipped > 0 && <span className="chip a">{b.skipped} {tr('console.data_tab.left_out')}</span>}
        {b.totals.map((t) => <span key={t.label} className="chip">{t.label}: {t.value}</span>)}
      </span>
      <span>{b.undoneAt ? <span className="chip">{tr('console.data_tab.undone')}</span> : canUndo ? <button className="btn sm" disabled={busy} onClick={onUndo}>{tr('console.data_tab.undo')}</button> : null}</span>
    </div>
  );
}

function PreviewPanel({ kind: base, src, preview: p, loading, error, onMap, onValues, onRows, onCancel, onCommit, committing }: {
  kind: ImportKind; src: Source; preview: ImportPreview | undefined; loading: boolean; error: string;
  onMap: (m: Record<string, string>) => void; onValues: (v: Record<string, Record<string, string>>) => void; onRows: (rows: Record<string, string>[]) => void; onCancel: () => void; onCommit: () => void; committing: boolean;
}) {
  // The school's own columns (its lists, its own fields) once the server has read the file.
  const kind = p?.columns ? { ...base, columns: p.columns } : base;
  const [onlyBad, setOnlyBad] = useState(true);
  const rows = useMemo(() => (p?.rows ?? []).map((r, i) => ({ ...r, i })), [p]);
  const bad = rows.filter((r) => r.errors.length);
  const shown = (onlyBad && bad.length ? bad : rows).slice(0, SHOWN);
  const options = [{ value: '', label: tr('console.data_tab.leave_out') }, ...kind.columns.map((c) => ({ value: c.key, label: `${c.label}${c.required ? ' *' : ''}` }))];
  // Fixing a cell turns the file into typed rows (already matched to the columns), checked again on every change.
  const edit = (i: number, key: string, value: string) => onRows(rows.map((r) => (r.i === i ? { ...r.values, [key]: value } : r.values)));
  const addRow = () => onRows([...(src.kind === 'rows' ? src.rows : rows.map((r) => r.values)), blank(kind)]);
  const grid = { '--cols': `56px ${kind.columns.map(() => 'minmax(110px,1fr)').join(' ')} minmax(160px,1.4fr)` } as React.CSSProperties;
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ font: '700 15px var(--fb)' }}>{src.fileName}</b>
        {p && <span className="chip v">{SOURCES[p.source] ?? p.source}</span>}
        {loading && <span className="chip">{tr('console.data_tab.checking')}</span>}
      </div>
      {error && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      {p && src.kind === 'file' && (
        <div style={{ marginTop: 12 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>{tr('console.data_tab.columns_in_the_file')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {p.headers.map((h) => (
              <div className="fld" key={h}><label htmlFor={`map-${h}`} data-tip={h} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h || tr('console.data_tab.no_heading')}</label>
                <Select id={`map-${h}`} compact value={p.mapping[h] ?? ''} onChange={(val) => onMap({ ...p.mapping, [h]: val })} options={options} /></div>
            ))}
          </div>
          {p.missing.length > 0 && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{tr('console.data_tab.match_a_column_to')}{' '}{p.missing.join(', ')}{tr('console.data_tab.these_are_needed')}</div>}
          <ValueMap columns={kind.columns} values={p.values} unmatched={p.unmatched} onChange={onValues} />
        </div>
      )}
      {p && (
        <>
          <div className="tgrow" style={{ gap: 6, marginTop: 12 }}>
            <span className="chip g">{p.counts.create} {tr('console.data_tab.to_add')}</span><span className="chip">{p.counts.update} {tr('console.data_tab.to_update')}</span>
            <span className={`chip ${p.counts.skip ? 'c' : ''}`}>{p.counts.skip} {tr('console.data_tab.with_problems')}</span>
            {p.totals.map((t) => <span key={t.label} className="chip">{t.label}: {t.value}</span>)}
          </div>
          {rows.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                {bad.length > 0 && <button className="btn sm" onClick={() => setOnlyBad(!onlyBad)}>{onlyBad ? tr('console.data_tab.show_every_row') : tr('console.data_tab.show_only_the_with_problems', { length: bad.length })}</button>}
                {rows.length > SHOWN && <span className="help">{tr('console.data_tab.showing')}{' '}{shown.length} {tr('console.data_tab.of')}{' '}{(onlyBad && bad.length ? bad : rows).length}.</span>}
                {src.kind === 'rows' && <button className="btn sm" onClick={addRow}>{tr('console.data_tab.add_a_row')}</button>}
              </div>
              <div className="scroll-x lscroll" style={{ marginTop: 8 }}>
                <div style={{ minWidth: 56 + kind.columns.length * 120 + 180 }}>
                  <div className="grd th" style={grid}><span>{tr('console.data_tab.line')}</span>{kind.columns.map((c) => <span key={c.key}>{c.label}</span>)}<span>{tr('console.data_tab.problem')}</span></div>
                  {shown.map((r) => (
                    <div key={r.i} className="grd rw" style={{ ...grid, height: 'auto', padding: '6px 0', gap: 6 }}>
                      <span style={{ font: '700 12px var(--fb)', color: 'var(--ink3)' }}>{r.line}</span>
                      {/* Keyed by the value too: a box typed in keeps nothing from another file's row at the same place. */}
                      {kind.columns.map((c) => <input key={`${c.key}|${r.values[c.key] ?? ''}`} className={`hws ${r.errors.length && c.required && !r.values[c.key] ? 'bad' : ''}`} style={{ width: '100%', textAlign: 'start' }} aria-label={tr('console.data_tab.line_2', { line: r.line, label: c.label })} placeholder={c.example} defaultValue={r.values[c.key] ?? ''}
                        onBlur={(e) => { if (e.target.value !== (r.values[c.key] ?? '')) edit(r.i, c.key, e.target.value); }} />)}
                      <span style={{ font: '600 12px var(--fb)', color: r.errors.length ? 'var(--bad)' : 'var(--ok)' }}>{r.errors.length ? r.errors.join(' ') : r.action === 'update' ? tr('console.data_tab.updates_what_is_there') : tr('console.data_tab.new')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onCancel}>{tr('console.data_tab.cancel')}</button>
        <button className="btn pri" disabled={!p || loading || committing || p.missing.length > 0 || p.counts.create + p.counts.update === 0} onClick={onCommit}>
          {committing ? tr('console.data_tab.importing') : p ? tr('console.data_tab.import_rows', { p0: p.counts.create + p.counts.update, p1: p.counts.skip ? tr('console.data_tab.leave_out_2', { skip: p.counts.skip }) : '' }) : tr('console.data_tab.import')}
        </button>
      </div>
    </div>
  );
}

/**
 * What the file's values mean: each value no choice of a column matches is offered the column's choices, and any other value
 * can be replaced ("VIII" is 8). Remembered with the column matching when the import goes ahead.
 */
function ValueMap({ columns, values, unmatched, onChange }: { columns: ImportColumn[]; values: Record<string, Record<string, string>>; unmatched: Record<string, string[]>; onChange: (v: Record<string, Record<string, string>>) => void }) {
  const [col, setCol] = useState(columns[0]?.key ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const put = (k: string, f: string, v: string) => {
    const m = { ...(values[k] ?? {}) };
    if (v) m[f] = v; else delete m[f];
    const next = { ...values, [k]: m };
    if (!Object.keys(m).length) delete next[k];
    onChange(next);
  };
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const kept = Object.entries(values).flatMap(([k, m]) => Object.entries(m).map(([f, v]) => ({ k, f, v })));
  return (
    <div style={{ marginTop: 14 }}>
      {Object.keys(unmatched).length > 0 && <>
        <div className="lbl" style={{ marginBottom: 6 }}>{tr('console.data_tab.values_to_match')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
          {Object.entries(unmatched).flatMap(([k, odd]) => odd.map((f) => (
            <div className="fld" key={`${k}|${f}`}><label data-tip={f} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(k)}: “{f}”</label>
              <Select compact aria-label={`${label(k)}: ${f}`} value="" onChange={(v) => put(k, f, v)}
                options={[{ value: '', label: tr('console.data_tab.leave_it_as_it_is') }, ...(columns.find((c) => c.key === k)?.options ?? []).map((o) => ({ value: o, label: o }))]} /></div>
          )))}
        </div>
      </>}
      <div className="lbl" style={{ margin: '12px 0 6px' }}>{tr('console.data_tab.values_replaced')}</div>
      <div className="tgrow">
        {kept.map((x) => <button key={`${x.k}|${x.f}`} type="button" className="chip v" data-tip={tr('console.data_tab.remove')} onClick={() => put(x.k, x.f, '')}>{label(x.k)}: {x.f} → {x.v} ×</button>)}
        {!kept.length && <span className="help" style={{ margin: 0 }}>{tr('console.data_tab.none_yet_values_are_read')}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
        <div style={{ width: 180 }}><Select compact aria-label={tr('console.data_tab.column')} value={col} onChange={setCol} options={columns.map((c) => ({ value: c.key, label: c.label }))} /></div>
        <div style={{ width: 150 }}><Field label={tr('console.data_tab.in_the_file')} value={from} onChange={setFrom} maxLength={200} placeholder="VIII" /></div>
        <div style={{ width: 150 }}><Field label={tr('console.data_tab.means')} value={to} onChange={setTo} maxLength={200} placeholder="8" /></div>
        <button type="button" className="btn sm" style={{ marginBottom: 6 }} disabled={!col || !from.trim() || !to.trim()} onClick={() => { put(col, from.trim(), to.trim()); setFrom(''); setTo(''); }}>{tr('console.data_tab.replace')}</button>
      </div>
    </div>
  );
}
