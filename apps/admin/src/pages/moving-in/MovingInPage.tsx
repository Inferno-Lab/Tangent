import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IMPORT_KINDS } from '@tangent/contracts';
import { Field, FilePick, Select, EmptyState, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { problem, stamp, useSchoolConfig } from '../../app/kit';
import { TypeRows } from './TypeRows';

const STATUS = { new: { label: tr('admin.moving_in_page.with_tangent'), tone: 'a' }, imported: { label: tr('admin.moving_in_page.imported'), tone: 'g' }, set_aside: { label: tr('admin.moving_in_page.set_aside'), tone: '' } } as const;
const save = (blob: Blob, name: string) => { const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
// Sheets go as text when they are text; anything else (Excel, PDF, a photo) as the file itself.
const read = (f: File) => /\.(csv|txt)$/i.test(f.name) ? f.text() : new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error(tr('admin.moving_in_page.could_not_be_read', { name: f.name }))); r.readAsDataURL(f); });

/** Bringing the school's records in: files for Tangent's team to import, blank sheets to fill, and what was imported. */
export function MovingInPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const cfg = useSchoolConfig();
  const uploads = useQuery({ queryKey: ['uploads'], queryFn: app.api.movingIn.uploads });
  const batches = useQuery({ queryKey: ['import-batches'], queryFn: app.api.movingIn.batches });
  // Only the kinds of record the school's modules keep.
  const kinds = IMPORT_KINDS.filter((k) => k.module === 'core' || !!cfg?.modules.includes(k.module) || !!cfg?.features.includes(k.module));
  const [picked, setPicked] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('students');
  const [err, setErr] = useState('');
  const fail = (e: unknown) => say(Object.values(problem(e))[0] ?? tr('admin.moving_in_page.something_went_wrong'), 'bad');
  const send = useMutation({ mutationFn: async () => { const big = picked.find((f) => f.size > 18_000_000);
      if (big) throw new Error(tr('admin.moving_in_page.is_over_18_mb_split', { name: big.name }));
      // One at a time, so a failure says which file and the ones before it are kept.
      let next;
      for (const f of picked) next = await app.api.movingIn.upload({ fileName: f.name, note: note.trim(), content: await read(f) });
      return next!;
    },
    onSuccess: (next) => { qc.setQueryData(['uploads'], next); const n = picked.length; setPicked([]); setNote(''); say(tr('admin.moving_in_page.sent_to_tangent_the_team', { n })); },
    onError: (e) => setErr(Object.values(problem(e))[0] ?? '') });
  const [typing, setTyping] = useState(false);
  const typed = useMutation({ mutationFn: ({ csv, count }: { csv: string; count: number }) => { const k = IMPORT_KINDS.find((x) => x.key === kind)!;
      return app.api.movingIn.upload({ fileName: tr('admin.moving_in_page.typed_csv', { label: k.label }), note: tr('admin.moving_in_page.typed_in_the_admin', { count }), content: csv });
    },
    onSuccess: (next) => { qc.setQueryData(['uploads'], next); setTyping(false); say(tr('admin.moving_in_page.sent_to_tangent_the_team_2')); },
    onError: fail });
  // An .xlsx with the columns, an example row, dropdowns where the values are fixed, and a sheet that explains each column.
  const tpl = useMutation({ mutationFn: (k: string) => app.api.movingIn.template(k), onSuccess: (b, k) => save(b, `${k}-template.xlsx`), onError: fail });
  const template = () => tpl.mutate(kind);
  return (
    <Page title={tr('admin.moving_in_page.moving_in')} sub={tr('admin.moving_in_page.bring_your_records_into_tangent')} toast={toast} loading={uploads.isLoading && !uploads.data}
      error={uploads.isError && !uploads.data ? { message: (uploads.error as Error).message, retry: () => void uploads.refetch() } : null}>
      <div className="stack" style={{ gap: 16 }}>
        {uploads.data?.length === 0 && !batches.data?.length && <EmptyState scene="moving" onAction={() => document.querySelector<HTMLInputElement>('main input[type=file]')?.click()} onLink={template} />}
        <Card title={tr('admin.moving_in_page.send_us_your_files')} chip={<span className="chip">{uploads.data?.length ?? 0} {tr('admin.moving_in_page.sent')}</span>}>
          <p className="help" style={{ marginTop: 0 }}>{tr('admin.moving_in_page.excel_sheets_exports_from_your')}</p>
          <div className="stack">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <FilePick multiple onPickAll={(f) => { setPicked(f); setErr(''); }}>{picked.length ? tr('admin.moving_in_page.choose_other_files') : tr('admin.moving_in_page.choose_files')}</FilePick>
              {picked.length > 0 && <b style={{ font: '700 14px var(--fb)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={picked.map((f) => f.name).join(', ')}>{picked.length === 1 ? picked[0]!.name : tr('admin.moving_in_page.files', { length: picked.length, p1: picked.map((f) => f.name).join(', ') })}</b>}
            </div>
            <Field label={tr('admin.moving_in_page.what_is_in_it_optional')} value={note} onChange={setNote} maxLength={500} placeholder={tr('admin.moving_in_page.for_example_fees_paid_this')} />
            {err && <div className="emsg" role="alert">{err}</div>}
            <div><button className="btn pri" disabled={!picked.length || send.isPending} onClick={() => send.mutate()}>{send.isPending ? tr('admin.moving_in_page.sending') : tr('admin.moving_in_page.send_to_tangent')}</button></div>
          </div>
          {(uploads.data ?? []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              {uploads.data!.map((u) => (
                <div key={u.id} className="rw" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 6, height: 'auto', padding: '10px 0', cursor: 'default' }}>
                  <span style={{ minWidth: 0, flex: '1 1 220px' }}><b style={{ font: '700 14px var(--fb)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={u.fileName}>{u.fileName}</b><small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{u.note || (u.rows ? tr('admin.moving_in_page.rows', { rows: u.rows }) : tr('admin.moving_in_page.a_file_to_read'))}</small>{u.status === 'set_aside' && u.setAsideReason && <small style={{ display: 'block', color: 'var(--warn)', font: '600 12px var(--fb)', marginTop: 4 }}>{tr('admin.moving_in_page.set_aside_2')}{' '}{u.setAsideReason}</small>}</span>
                  <span style={{ color: 'var(--ink2)', font: '600 13px var(--fb)' }}>{u.uploadedBy} · {stamp(u.at)}</span>
                  <span className={`st ${STATUS[u.status].tone}`}><i></i>{STATUS[u.status].label}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 16 }}>
            <div className="fld" style={{ minWidth: 220, flex: '1 1 220px', maxWidth: 360 }}><label htmlFor="tpl">{tr('admin.moving_in_page.blank_sheet_to_fill_in')}</label><Select id="tpl" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k.key, label: k.label }))} /></div>
            <button className="btn" disabled={tpl.isPending} onClick={template}>{tpl.isPending ? tr('admin.moving_in_page.preparing') : tr('admin.moving_in_page.download_sheet')}</button>
            {!typing && <button className="btn" onClick={() => setTyping(true)}>{tr('admin.moving_in_page.type_it_in_instead')}</button>}
          </div>
          {typing && <TypeRows key={kind} kind={IMPORT_KINDS.find((x) => x.key === kind)!} busy={typed.isPending} onSend={(csv, count) => typed.mutate({ csv, count })} onCancel={() => setTyping(false)} />}
        </Card>

        {(batches.data ?? []).length > 0 && (
          <Card title={tr('admin.moving_in_page.what_tangent_imported')} chip={<span className="chip">{batches.data!.filter((b) => !b.undoneAt).length}</span>}>
            <p className="help" style={{ marginTop: 0 }}>{tr('admin.moving_in_page.each_import_with_its_totals')}</p>
            {batches.data!.map((b) => (
              <div key={b.id} className="rw" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 16, rowGap: 6, height: 'auto', padding: '12px 0', cursor: 'default' }}>
                <span style={{ minWidth: 0, flex: '1 1 220px' }}>
                  <b style={{ font: '700 14px var(--fb)' }}>{IMPORT_KINDS.find((k) => k.key === b.kind)?.label ?? b.kind}</b>
                  <small style={{ display: 'block', color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{b.fileName || tr('admin.moving_in_page.typed_in')} · {stamp(b.at)}</small>
                  {b.notes.map((n) => <small key={n} style={{ display: 'block', color: 'var(--warn)', font: '600 12px var(--fb)', marginTop: 4 }}>{n}</small>)}
                </span>
                <span className="tgrow" style={{ gap: 6, flex: '1 1 260px' }}>
                  {b.undoneAt ? <span className="chip">{tr('admin.moving_in_page.undone')}</span> : <><span className="chip g">{b.created} {tr('admin.moving_in_page.added')}</span><span className="chip">{b.updated} {tr('admin.moving_in_page.updated')}</span>{b.skipped > 0 && <span className="chip a">{b.skipped} {tr('admin.moving_in_page.left_out')}</span>}</>}
                  {!b.undoneAt && b.totals.map((t) => <span key={t.label} className="chip">{t.label}: {t.value}</span>)}
                </span>
              </div>
            ))}
          </Card>
        )}

      </div>
    </Page>
  );
}
