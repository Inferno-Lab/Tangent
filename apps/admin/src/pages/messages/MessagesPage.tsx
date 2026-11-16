import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ThreadDetail, ThreadRow } from '@tangent/contracts';
import { Checkbox, Dialog, Field, FilePick, Segmented, Select, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { uploadFile } from '@tangent/api-client';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, Avatar, Ico, problem, stamp, useOpenParam } from '../../app/kit';
import { fmtDate } from '@tangent/contracts';

const BACK = 'caretLeft';
const SEND = 'send';
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return fmtDate(iso, 'day');
};
const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['messages', 'shell'].includes(String(q.queryKey[0])) });

export function MessagesPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  // The open conversation is in the address (?open=<conversation>).
  const [sel, setSel] = useOpenParam();
  const [filter, setFilter] = useState<'open' | 'unread' | 'closed'>('open');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [starting, setStarting] = useState(false);
  const list = useQuery({ queryKey: ['messages'], queryFn: app.api.messages.list, refetchInterval: 20_000 });
  const term = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((t) => (filter === 'closed' ? t.status === 'closed' : filter === 'unread' ? t.unread > 0 && t.status === 'open' : t.status === 'open'))
    .filter((t) => (!mine || t.assignedToId === app.user.id) && (!term || `${t.subject} ${t.guardianName} ${t.studentName ?? ''} ${t.lastBody}`.toLowerCase().includes(term)));
  const canWrite = app.user.permissions.includes('messages.write');
  const all = list.data ?? [];
  const unread = all.filter((t) => t.unread > 0).length;
  useEffect(() => { if (!sel && rows[0] && window.matchMedia('(min-width: 900px)').matches) setSel(rows[0].id); }, [rows, sel]);
  return (
    <Page title={tr('admin.messages_page.messages')} sub={all.length ? tr('admin.messages_page.conversations', { p0: unread ? tr('admin.messages_page.n_waiting_for_a_reply', { n: unread }) : tr('admin.messages_page.all_caught_up'), length: all.length }) : tr('admin.messages_page.what_families_write_to_the')} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={canWrite ? <AddBtn onClick={() => setStarting(true)}>{tr('admin.messages_page.new_message')}</AddBtn> : undefined}
      overlays={starting && <Start onClose={() => setStarting(false)} onDone={(t) => { setStarting(false); refresh(qc); setFilter('open'); setSel(t.id); say(tr('admin.messages_page.message_sent_the_family_gets')); }} />}>
      {all.length === 0 ? (
        <div><EmptyState scene="messages" onAction={canWrite ? () => setStarting(true) : undefined} /></div>
      ) : (
        <section className={`msg ${sel ? 'has' : ''}`}>
          <div className="card msl rise" style={{ padding: 0 }}>
            <div style={{ padding: '16px 16px 10px', display: 'grid', gap: 10 }}>
              <Segmented value={filter} onChange={(v) => { setFilter(v); setSel(null); }} label={tr('admin.messages_page.show')} options={[{ value: 'open', label: tr('admin.messages_page.open') }, { value: 'unread', label: tr('admin.messages_page.unread'), count: unread || undefined }, { value: 'closed', label: tr('admin.messages_page.closed') }]} />
              <Field label={tr('admin.messages_page.search_conversations')} value={q} onChange={setQ} placeholder={tr('admin.messages_page.family_student_or_words')} />
              <Checkbox checked={mine} onChange={setMine} label={tr('admin.messages_page.only_the_ones_with_me')} />
            </div>
            <div className="lscroll" style={{ maxHeight: 'min(68dvh,640px)' }}>
              {rows.length === 0 && <div style={{ padding: '4px 16px 16px' }}><EmptyNote icon={term ? 'search' : 'messages'} title={term || mine ? tr('admin.messages_page.nothing_matches') : filter === 'unread' ? tr('admin.messages_page.nothing_unread') : filter === 'closed' ? tr('admin.messages_page.no_closed_conversations') : tr('admin.messages_page.no_open_conversations')}
                body={term || mine ? tr('admin.messages_page.try_another_name_or_clear') : filter === 'unread' ? tr('admin.messages_page.you_have_read_every_message') : filter === 'closed' ? tr('admin.messages_page.a_conversation_you_close_moves') : tr('admin.messages_page.a_family_s_message_starts')} /></div>}
              {rows.map((t) => <ThreadItem key={t.id} t={t} on={t.id === sel} onOpen={() => setSel(t.id)} />)}
            </div>
          </div>
          <div className="card mst rise" style={{ '--d': '.06s', padding: 0 } as React.CSSProperties}>
            {sel ? <Conversation key={sel} id={sel} canWrite={canWrite} onBack={() => setSel(null)} onChanged={(m) => { refresh(qc); if (m) say(m); }} /> : <div className="help" style={{ padding: 32, textAlign: 'center' }}>{tr('admin.messages_page.choose_a_conversation')}</div>}
          </div>
        </section>
      )}
    </Page>
  );
}

function ThreadItem({ t, on, onOpen }: { t: ThreadRow; on: boolean; onOpen: () => void }) {
  return (
    <button className={`mti ${on ? 'on' : ''}`} onClick={onOpen} aria-current={on}>
      <Avatar name={t.guardianName} size={38} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b data-tip={t.guardianName}>{t.guardianName}</b><small>{ago(t.lastAt)}</small></span>
        <span className="mts" data-tip={t.subject}>{t.subject}</span>
        <span className="mtp">{t.lastFrom === 'staff' ? tr('admin.messages_page.you') : ''}{t.lastBody}</span>
      </span>
      {t.unread > 0 && <span className="ct" aria-label={tr('admin.messages_page.unread_2', { unread: t.unread })} style={{ alignSelf: 'center', font: '700 11px var(--fb)', background: 'var(--brand)', color: 'var(--on-brand)', borderRadius: 999, padding: '2px 8px' }}>{t.unread}</span>}
    </button>
  );
}

function Conversation({ id, canWrite, onBack, onChanged }: { id: string; canWrite: boolean; onBack: () => void; onChanged: (m?: string) => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['messages', id], queryFn: () => app.api.messages.get(id), refetchInterval: 15_000 });
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState('');
  const staff = useQuery({ queryKey: ['messages', 'staff'], queryFn: app.api.messages.staff, enabled: canWrite, staleTime: 5 * 60_000 });
  const shake = useShake();
  const end = useRef<HTMLDivElement>(null);
  const t = q.data;
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['shell'] }); }, [qc, t?.messages.length]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [t?.messages.length]);
  const reply = useMutation({
    // Files go up first (to the conversation), then the reply names them.
    mutationFn: async () => {
      const fileIds: string[] = [];
      for (const f of files) fileIds.push((await uploadFile(app.api, 'chat', id, f)).id);
      return app.api.messages.reply(id, { body: body.trim(), fileIds });
    },
    onSuccess: (r) => { setBody(''); setFiles([]); setErr(''); qc.setQueryData(['messages', id], r); onChanged(); },
    onError: (e) => { setErr(problem(e)._ ?? tr('admin.messages_page.could_not_send')); shake.hit(); },
  });
  const patch = useMutation({ mutationFn: (b: { status?: 'open' | 'closed'; assignToMe?: boolean; assignTo?: string }) => app.api.messages.patch(id, b), onSuccess: (r, b) => { qc.setQueryData(['messages', id], r); onChanged(b.status === 'closed' ? tr('admin.messages_page.conversation_closed') : b.status === 'open' ? tr('admin.messages_page.conversation_reopened') : b.assignTo && b.assignTo !== app.user.id ? tr('admin.messages_page.handed_to', { assignedToName: r.assignedToName }) : tr('admin.messages_page.it_is_yours_now')); }, onError: (e) => setErr((e as Error).message) });
  if (!t) return <div className="skc" style={{ height: 360, borderRadius: 24, margin: 16 }} />;
  const send = () => { if (body.trim() || files.length) reply.mutate(); else { setErr(tr('admin.messages_page.write_a_reply_first')); shake.hit(); } };
  const open = (fileId: string) => void app.api.files.url(fileId, true).then((u) => window.open(u.url, '_blank', 'noopener')).catch((e: Error) => setErr(e.message));
  return (
    <div className="mcv">
      <header className="mch">
        <button className="btn sm mback" onClick={onBack} aria-label={tr('admin.messages_page.back_to_the_list')}><Ico d={BACK} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b className="fd" data-tip={t.subject} style={{ display: 'block', fontSize: 17, letterSpacing: '-.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</b>
          <small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{t.guardianName}{t.studentName ? tr('admin.messages_page.class', { studentName: t.studentName, className: t.className }) : ''}{t.assignedToName ? tr('admin.messages_page.with', { assignedToName: t.assignedToName }) : ''}</small>
        </div>
        {canWrite && <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {t.assignedToId !== app.user.id && <button className="btn sm" disabled={patch.isPending} onClick={() => patch.mutate({ assignToMe: true })}>{tr('admin.messages_page.take_it')}</button>}
          {(staff.data?.length ?? 0) > 1 && <Select compact aria-label={tr('admin.messages_page.hand_to')} value="" onChange={(to) => to && patch.mutate({ assignTo: to })} options={[{ value: '', label: tr('admin.messages_page.hand_to_2') }, ...(staff.data ?? []).filter((s) => s.id !== t.assignedToId).map((s) => ({ value: s.id, label: s.name }))]} />}
          <button className="btn sm" disabled={patch.isPending} onClick={() => patch.mutate({ status: t.status === 'open' ? 'closed' : 'open' })}>{t.status === 'open' ? tr('admin.messages_page.close') : tr('admin.messages_page.reopen')}</button>
        </span>}
      </header>
      <div className="mlist lscroll" style={{ ['--scbg' as string]: 'var(--s1)' }}>
        {t.messages.map((m) => (
          <div key={m.id} className={`mb ${m.from}`}>
            <div className="mbb">{m.deleted ? <i>{tr('admin.messages_page.this_message_was_deleted')}</i> : m.body}{m.files.length > 0 && <span className="tgrow" style={{ marginTop: m.body ? 8 : 0 }}>{m.files.map((f) => <button key={f.id} type="button" className="chip" onClick={() => open(f.id)}>{f.name}</button>)}</span>}</div>
            <small>{m.sender} · {stamp(m.at)}</small>
          </div>
        ))}
        <div ref={end} />
      </div>
      {canWrite ? (
        <footer className={`mcm ${shake.cls}`}>
          <AreaField label={tr('admin.messages_page.your_reply')} value={body} onChange={(v) => { setBody(v); setErr(''); }} rows={2} maxLength={1000} error={err} />
          <div className="tgrow">
            <FilePick className="btn sm" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={files.length >= 5} onPick={(f) => setFiles([...files, f])}>{tr('admin.messages_page.attach_a_file')}</FilePick>
            {files.map((f, i) => <button key={`${f.name}-${i}`} type="button" className="chip v" data-tip={tr('admin.messages_page.remove')} onClick={() => setFiles(files.filter((_, j) => j !== i))}>{f.name} ×</button>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="help">{tr('admin.messages_page.the_family_sees_this_in')}{t.status === 'closed' ? tr('admin.messages_page.replying_reopens_the_conversation') : ''}</span>
            <button className="btn pri" disabled={reply.isPending} onClick={send}><Ico d={SEND} />{reply.isPending ? tr('admin.messages_page.sending') : tr('admin.messages_page.send_reply')}</button>
          </div>
        </footer>
      ) : <footer className="mcm"><div className="help">{tr('admin.messages_page.you_can_read_messages_but')}</div></footer>}
    </div>
  );
}

function Start({ onClose, onDone }: { onClose: () => void; onDone: (t: ThreadDetail) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [stu, setStu] = useState<{ id: string; name: string; className: string } | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const found = useQuery({ queryKey: ['students', 'pick', term], queryFn: () => app.api.students.list({ query: term, limit: 6 }), enabled: term.length >= 2 && !stu });
  const make = useMutation({ mutationFn: () => app.api.messages.start({ studentId: stu!.id, subject: subject.trim(), body: body.trim() }), onSuccess: onDone, onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const go = () => {
    const p: Record<string, string> = {};
    if (!stu) p.studentId = tr('admin.messages_page.choose_the_student_whose_family');
    if (subject.trim().length < 3) p.subject = tr('admin.messages_page.write_a_subject');
    if (body.trim().length < 2) p.body = tr('admin.messages_page.write_a_message');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else make.mutate();
  };
  return (
    <Dialog title={tr('admin.messages_page.new_message')} onClose={onClose} width={540} shake={shake.cls}>
      <div className="stack">
        {stu ? (
          <div className="fld"><label>{tr('admin.messages_page.to_the_family_of')}</label><div className="tgrow"><span className="chip v" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>{stu.name} {tr('admin.messages_page.class_2')}{' '}{stu.className}</span><button className="btn sm" onClick={() => { setStu(null); setQ(''); }}>{tr('admin.messages_page.change')}</button></div></div>
        ) : (
          <div className="fld">
            <Field label={tr('admin.messages_page.to_the_family_of')} value={q} onChange={(v) => { setQ(v); setErr({ ...err, studentId: '' }); }} error={err.studentId} placeholder={tr('admin.messages_page.type_a_student_s_name')} />
            {found.data?.items.length ? <div className="pks">{found.data.items.map((s) => <button key={s.id} className="pk" onClick={() => setStu({ id: s.id, name: s.name, className: s.className })}><Avatar name={s.name} size={28} /><span><b>{s.name}</b><small>{tr('admin.messages_page.class_3')}{' '}{s.className} · {s.guardianName}</small></span></button>)}</div> : term.length >= 2 && found.data ? <div className="help">{tr('admin.messages_page.no_student_found')}</div> : null}
          </div>
        )}
        <Field label={tr('admin.messages_page.subject')} value={subject} onChange={(v) => { setSubject(v); setErr({ ...err, subject: '' }); }} error={err.subject} maxLength={100} />
        <AreaField label={tr('admin.messages_page.message')} value={body} onChange={(v) => { setBody(v); setErr({ ...err, body: '' }); }} error={err.body} rows={4} maxLength={1000} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{tr('admin.messages_page.cancel')}</button>
        <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? tr('admin.messages_page.sending') : tr('admin.messages_page.send_message')}</button>
      </div>
    </Dialog>
  );
}
