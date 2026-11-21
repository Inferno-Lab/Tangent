import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_DIARY_KINDS, addDays, listOptions, schoolToday, type DiaryInput, type DiaryRow, type ListItem } from '@tangent/contracts';
import { uploadFile } from '@tangent/api-client';
import { DateField, Dialog, EmptyNote, EmptyState, Select, SelectField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, Attach, dateLabel, problem, useSetting } from '../../app/kit';

/** The class diary: what each class did, what to bring, notes to families and remarks for one child, with who acknowledged. */
export function DiaryPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const reads = app.user.permissions.includes('diary.read');
  const writes = app.user.permissions.includes('diary.write');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(addDays(schoolToday(), -7));
  const [editing, setEditing] = useState<DiaryRow | 'new' | null>(null);
  const [acks, setAcks] = useState<DiaryRow | null>(null);
  // Whoever reads every class picks from all of them; a teacher from the classes they write for.
  const all = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, enabled: reads });
  const mine = useQuery({ queryKey: ['diary-classes'], queryFn: app.api.diary.classes, enabled: writes });
  const classes = reads ? (all.data ?? []).map((c) => ({ id: c.id, name: c.name })) : (mine.data ?? []).map((c) => ({ id: c.classId, name: c.className }));
  const list = useQuery({ queryKey: ['diary', classId, from], queryFn: () => app.api.diary.list({ classId: classId || undefined, from, to: addDays(from, 21) }) });
  const remove = useMutation({ mutationFn: (id: string) => app.api.diary.remove(id), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['diary'] }); say(t('admin.diary.removed')); }, onError: (e) => say((e as Error).message, 'bad') });
  const rows = list.data ?? [];
  return (
    <Page title={t('admin.diary.diary')} sub={t('admin.diary.sub')} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={writes && classes.length ? <AddBtn onClick={() => setEditing('new')}>{t('admin.diary.write_an_entry')}</AddBtn> : undefined}
      filters={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ width: 200 }}><Select compact aria-label={t('admin.diary.class')} value={classId} onChange={setClassId} options={[{ value: '', label: t('admin.diary.every_class') }, ...classes.map((c) => ({ value: c.id, label: c.name }))]} /></div>
        <div style={{ width: 190 }}><DateField compact label={t('admin.diary.from')} value={from} onChange={(v) => v && setFrom(v)} /></div>
      </div>}
      overlays={<>
        {editing && <EntryDialog entry={editing === 'new' ? null : editing} classes={reads ? classes.map((c) => ({ ...c, subjects: null })) : (mine.data ?? []).map((c) => ({ id: c.classId, name: c.className, subjects: c.classTeacher ? null : c.subjects }))}
          onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); void qc.invalidateQueries({ queryKey: ['diary'] }); say(m); }} />}
        {acks && <AcksDialog entry={acks} onClose={() => setAcks(null)} />}
      </>}>
      {/* The scene only on the first view; a chosen class or an earlier week with nothing keeps the note. */}
      {!rows.length && !classId && from === addDays(schoolToday(), -7) ? <EmptyState scene="diary" onAction={writes && classes.length ? () => setEditing('new') : undefined} /> : <Card style={{ padding: 0 }}>
        {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="edit" title={t('admin.diary.nothing_written')} body={t('admin.diary.nothing_written_body')}
          action={writes && classes.length ? <button className="btn sm" onClick={() => setEditing('new')}>{t('admin.diary.write_an_entry')}</button> : undefined} /></div>
          : rows.map((r) => (
            <div key={r.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', height: 'auto', minHeight: 56, padding: '12px 20px', flexWrap: 'wrap' }}>
              <span style={{ flex: '0 0 120px' }}><b style={{ font: '700 13px/1.3 var(--fb)' }}>{dateLabel(r.date)}</b><small className="help" style={{ display: 'block', margin: 0 }}>{r.className}</small></span>
              <span style={{ flex: 1, minWidth: 220 }}>
                <span className="chip v" style={{ marginInlineEnd: 6 }}>{r.kindName}</span>{r.subjectName && <span className="chip">{r.subjectName}</span>}
                <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.text}</div>
                <small className="help" style={{ display: 'block', margin: '4px 0 0' }}>
                  {r.by}{r.remarks.length ? ` · ${t('admin.diary.n_remarks', { n: r.remarks.length })}` : ''}{r.files.length ? ` · ${t('admin.diary.n_files', { n: r.files.length })}` : ''}
                </small>
              </span>
              <button className="btn sm" onClick={() => setAcks(r)}>{t('admin.diary.acks', { n: r.acks, of: r.families })}</button>
              {writes && (r.byId === app.user.id || reads) && <>
                <button className="btn sm" onClick={() => setEditing(r)}>{t('admin.diary.edit')}</button>
                <button className="btn sm" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>{t('admin.diary.remove')}</button>
              </>}
            </div>
          ))}
      </Card>}
    </Page>
  );
}

type ClassChoice = { id: string; name: string; subjects: { id: string; name: string }[] | null };

function EntryDialog({ entry, classes, onClose, onDone }: { entry: DiaryRow | null; classes: ClassChoice[]; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const kinds = listOptions(useSetting<ListItem[]>('diary.kinds', DEFAULT_DIARY_KINDS), entry?.kind);
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects });
  const [f, setF] = useState<DiaryInput>(() => entry
    ? { classId: entry.classId, date: entry.date, kind: entry.kind, subjectId: entry.subjectId, text: entry.text, fileIds: entry.files.map((x) => x.id), remarks: entry.remarks.map((r) => ({ studentId: r.studentId, text: r.text })) }
    : { classId: classes[0]?.id ?? '', date: schoolToday(), kind: kinds[0]?.key ?? 'classwork', subjectId: null, text: '', fileIds: [], remarks: [] });
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  const students = useQuery({ queryKey: ['class-students', f.classId], queryFn: () => app.api.students.list({ classId: f.classId, limit: 100, sort: 'name' }), enabled: !!f.classId });
  const cls = classes.find((c) => c.id === f.classId);
  const subjectOptions = cls?.subjects ?? (subjects.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  const save = useMutation({
    mutationFn: async () => {
      const fileIds = [...f.fileIds];
      for (const file of files) fileIds.push((await uploadFile(app.api, 'diary_attachment', f.classId, file)).id);
      const body = { ...f, fileIds, remarks: f.remarks.filter((r) => r.studentId && r.text.trim()) };
      return entry ? app.api.diary.save(entry.id, body) : app.api.diary.add(body);
    },
    onSuccess: () => onDone(entry ? t('admin.diary.saved') : t('admin.diary.written')),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const put = (p: Partial<DiaryInput>) => { setF({ ...f, ...p }); setErr({}); };
  return (
    <Dialog title={entry ? t('admin.diary.edit_entry') : t('admin.diary.write_an_entry')} onClose={onClose} width={640} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <SelectField label={t('admin.diary.class')} value={f.classId} disabled={!!entry} error={err.classId} onChange={(v) => put({ classId: v, subjectId: null, remarks: [] })} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          <DateField label={t('admin.diary.day')} value={f.date} error={err.date} min={addDays(schoolToday(), -30)} max={addDays(schoolToday(), 30)} onChange={(v) => put({ date: v })} />
        </div>
        <div className="two">
          <SelectField label={t('admin.diary.kind')} value={f.kind} error={err.kind} onChange={(v) => put({ kind: v })} options={kinds.map((k) => ({ value: k.key, label: k.name }))} />
          <SelectField label={cls?.subjects ? t('admin.diary.subject') : t('admin.diary.subject_optional')} value={f.subjectId ?? ''} error={err.subjectId} onChange={(v) => put({ subjectId: v || null })}
            options={[...(cls?.subjects ? [] : [{ value: '', label: t('admin.diary.whole_class') }]), ...subjectOptions.map((s) => ({ value: s.id, label: s.name }))]} />
        </div>
        <AreaField label={t('admin.diary.entry')} value={f.text} onChange={(v) => put({ text: v })} rows={4} maxLength={2000} error={err.text} />
        <Attach files={files} onChange={setFiles} max={Math.max(0, 5 - f.fileIds.length)} />
        <div className="lbl">{t('admin.diary.remarks_for_one_child')}</div>
        {f.remarks.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ width: 200 }}><Select compact aria-label={t('admin.diary.student')} value={r.studentId} onChange={(v) => put({ remarks: f.remarks.map((x, j) => (j === i ? { ...x, studentId: v } : x)) })}
              options={[{ value: '', label: t('admin.diary.choose') }, ...(students.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))]} /></div>
            <div style={{ flex: 1, minWidth: 200 }}><AreaField label={t('admin.diary.remark')} value={r.text} rows={1} maxLength={500} onChange={(v) => put({ remarks: f.remarks.map((x, j) => (j === i ? { ...x, text: v } : x)) })} /></div>
            <button className="btn sm" onClick={() => put({ remarks: f.remarks.filter((_, j) => j !== i) })}>{t('admin.diary.remove')}</button>
          </div>
        ))}
        {f.remarks.length < 100 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => put({ remarks: [...f.remarks, { studentId: '', text: '' }] })}>{t('admin.diary.add_a_remark')}</button>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.diary.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || f.text.trim().length < 2 || !f.classId} onClick={() => save.mutate()}>{save.isPending ? t('admin.diary.saving') : t('admin.diary.save')}</button>
      </div>
    </Dialog>
  );
}

function AcksDialog({ entry, onClose }: { entry: DiaryRow; onClose: () => void }) { const app = useApp();
  const q = useQuery({ queryKey: ['diary-acks', entry.id], queryFn: () => app.api.diary.acks(entry.id) });
  const rows = q.data ?? [];
  return (
    <Dialog title={t('admin.diary.who_acknowledged')} tag={{ text: `${entry.className} · ${dateLabel(entry.date)}`, tone: 'v' }} onClose={onClose} width={520}>
      {!rows.length ? <EmptyNote icon="students" title={t('admin.diary.no_students')} /> : (
        <div className="stack" style={{ gap: 0 }}>
          {rows.map((r) => (
            <div key={r.studentId} className="rw" style={{ display: 'flex', justifyContent: 'space-between', height: 'auto', minHeight: 40, padding: '6px 0' }}>
              <span>{r.name}</span>
              <span className={`chip ${r.at ? 'g' : ''}`}>{r.at ? t('admin.diary.read') : t('admin.diary.not_yet')}</span>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
