import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError, uploadFile } from '@tangent/api-client';
import { schoolToday, type Category, type NoticeRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Field, SelectField, TimeField, useShake, Icon, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { Attach, useGrades, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';
import { fmtDate, schoolInstant, schoolNow, type NoticeTargets } from '@tangent/contracts';

const TONE: Record<NoticeRow['status'], string> = { draft: 'n', pending: 'a', scheduled: 'v', published: 'g' };
const LABEL: Record<NoticeRow['status'], string> = { draft: t('admin.notices_page.draft'), pending: t('admin.notices_page.waiting_for_approval'), scheduled: t('admin.notices_page.scheduled'), published: t('admin.notices_page.sent') };
const AUDIENCE: Record<string, string> = { everyone: t('admin.notices_page.everyone'), parents: t('admin.notices_page.parents'), students: t('admin.notices_page.students'), staff: t('admin.notices_page.staff'), class: 'One class' };
const when = (iso: string | null) => (iso ? fmtDate(iso, 'stamp') : '');

/**
 * What the school tells families, students and staff: written here or by teachers in the app, sent now or at a set time,
 * approved where the school asks, corrected or taken down later. Each sent notice shows how many opened it and, when it asked,
 * who has not acknowledged it yet.
 */
export function NoticesPage() {
  const { tabs } = usePageTabs('/notices');
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [dlg, setDlg] = useState<{ kind: 'new' } | { kind: 'edit'; n: NoticeRow } | { kind: 'down'; n: NoticeRow } | { kind: 'acks'; n: NoticeRow } | null>(() =>
    new URLSearchParams(window.location.search).get('new') ? { kind: 'new' } : null);
  const list = useQuery({ queryKey: ['notices'], queryFn: app.api.notices.list });
  const cats = useSetting<Category[]>('notices.categories', []);
  const rows = list.data ?? [];
  const canWrite = app.user.permissions.includes('notices.write');
  const mayChange = (n: NoticeRow) => canWrite && (n.authorId === app.user.id || app.user.permissions.includes('notices.publish'));
  const done = (msg: string) => { setDlg(null); void qc.invalidateQueries({ predicate: (q) => ['notices', 'dashboard', 'shell'].includes(String(q.queryKey[0])) }); say(msg); };
  return (
    <Page title={t('admin.notices_page.notices')} sub={t('admin.notices_page.what_the_school_tells_families')} tabs={tabs} toast={toast} loading={list.isLoading}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={canWrite ? <button className="btn pri" onClick={() => setDlg({ kind: 'new' })}><Icon name="plus" />{t('admin.notices_page.new_notice')}</button> : undefined}
      overlays={<>
        {(dlg?.kind === 'new' || dlg?.kind === 'edit') && <Compose n={dlg.kind === 'edit' ? dlg.n : undefined} onClose={() => setDlg(null)} onDone={done} />}
        {dlg?.kind === 'down' && <TakeDown n={dlg.n} onClose={() => setDlg(null)} onDone={done} />}
        {dlg?.kind === 'acks' && <NotAcked n={dlg.n} onClose={() => setDlg(null)} />}
      </>}>
      {rows.length === 0 ? (
        <div><EmptyState scene="notices" onAction={canWrite ? () => setDlg({ kind: 'new' }) : undefined} /></div>
      ) : (
        <section className="card rise">
          {rows.map((n) => {
            const cat = cats.find((c) => c.key === n.category);
            return (
              <article className="ntc" key={n.id}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {n.pinned && <span className="chip k">{t('admin.notices_page.pinned')}</span>}
                  <b>{n.title}</b>
                  <span className={`st ${TONE[n.status]}`}><i></i>{LABEL[n.status]}{n.status === 'scheduled' ? ` · ${when(n.publishAt)}` : ''}</span>
                  {cat && <span className={`chip ${cat.tone}`}>{cat.name}</span>}
                  <span className="chip">{n.audience === 'class' ? t('admin.notices_page.class', { p0: n.className ?? '' }) : AUDIENCE[n.audience] ?? n.audience}</span>
                  <span style={{ marginInlineStart: 'auto', font: '600 12px var(--fb)', color: 'var(--ink3)' }}>{n.author} · {when(n.publishedAt ?? n.createdAt)}{n.editedAt ? t('admin.notices_page.edited') : ''}</span>
                </div>
                <p>{n.body}</p>
                {n.files.length > 0 && <div className="help" style={{ margin: 0 }}>{t('admin.notices_page.attached')}{' '}{n.files.map((f) => f.name).join(', ')}</div>}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  {n.status === 'published' && <span className="help" style={{ margin: 0 }}>{t('admin.notices_page.opened_by')}{' '}{n.reach.read} {t('admin.notices_page.of')}{' '}{n.reach.audience}{n.needsAck ? t('admin.notices_page.acknowledged_by', { acked: n.reach.acked }) : ''}</span>}
                  <span style={{ flex: 1 }} />
                  {n.status === 'published' && n.needsAck && n.reach.acked < n.reach.audience && <button className="btn sm" onClick={() => setDlg({ kind: 'acks', n })}>{t('admin.notices_page.who_has_not_acknowledged')}</button>}
                  {mayChange(n) && <button className="btn sm" onClick={() => setDlg({ kind: 'edit', n })}>{n.status === 'published' ? t('admin.notices_page.correct') : t('admin.notices_page.change')}</button>}
                  {mayChange(n) && <button className="btn sm" onClick={() => setDlg({ kind: 'down', n })}>{n.status === 'published' ? t('admin.notices_page.take_down') : t('admin.notices_page.delete')}</button>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </Page>
  );
}

/** The school's today, for the earliest day a notice can be scheduled. */
const today = () => schoolToday();

function Compose({ n, onClose, onDone }: { n?: NoticeRow; onClose: () => void; onDone: (msg: string) => void }) {
  const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const cats = useSetting<Category[]>('notices.categories', []);
  const canPublish = app.user.permissions.includes('notices.publish');
  const canPin = app.user.permissions.includes('notices.pin');
  const at = n?.publishAt ? schoolNow(new Date(n.publishAt)).toISOString() : ''; // the time on the school's clock
  const [f, setF] = useState({
    title: n?.title ?? '', body: n?.body ?? '', audience: n?.audience ?? (canPublish ? 'everyone' : 'class'), classId: n?.classId ?? '', category: n?.category ?? cats[0]?.key ?? 'academic',
    pinned: n?.pinned ?? false, needsAck: n?.needsAck ?? false, later: !!n?.publishAt, day: at.slice(0, 10), time: at.slice(11, 16) || '08:00', tellAgain: false,
  });
  const [err, setErr] = useState<Record<string, string>>({});
  // Narrowing who it reaches (someone who publishes to the school): year groups, houses, and staff roles.
  const grades = useGrades();
  const houses = useSetting<{ name: string }[]>('people.houses', []);
  const roles = useQuery({ queryKey: ['roles'], queryFn: app.api.roles.list, staleTime: 60_000, enabled: canPublish });
  const [targets, setTargets] = useState<NoticeTargets>(n?.targets ?? {});
  const toggle = <K extends keyof NoticeTargets>(k: K, v: NonNullable<NoticeTargets[K]>[number], on: boolean) => {
    const cur = (targets[k] ?? []) as (typeof v)[];
    setTargets({ ...targets, [k]: on ? [...cur, v] : cur.filter((x) => x !== v) });
  };
  const shake = useShake();
  const [files, setFiles] = useState<File[]>([]);
  const published = n?.status === 'published';
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const body = {
        title: f.title.trim(), body: f.body.trim(), audience: f.audience as 'everyone', classId: f.audience === 'class' ? f.classId : undefined, category: f.category || cats[0]?.key || 'academic',
        pinned: f.pinned, needsAck: f.needsAck, publish, publishAt: f.later && !published ? schoolInstant(f.day, f.time).toISOString() : null, fileIds: [],
        // Roles only narrow a notice to staff; year groups and houses only one to families and students.
        targets: canPublish && f.audience !== 'class' ? {
          grades: f.audience === 'staff' ? [] : targets.grades ?? [], houses: f.audience === 'staff' ? [] : targets.houses ?? [],
          roles: f.audience === 'staff' || f.audience === 'everyone' ? targets.roles ?? [] : [],
        } : {},
      };
      const saved = n ? await app.api.notices.update(n.id, { ...body, tellAgain: f.tellAgain }) : await app.api.notices.create(body);
      const failed: string[] = [];
      for (const file of files) await uploadFile(app.api, 'notice_attachment', saved.id, file).catch(() => failed.push(file.name));
      return { saved, failed };
    },
    onSuccess: ({ saved, failed }) => onDone(`${published ? (f.tellAgain ? t('admin.notices_page.corrected_and_everyone_it_is') : t('admin.notices_page.corrected_it_shows_as_edited'))
      : saved.status === 'published' ? t('admin.notices_page.sent_to_everyone_it_is') : saved.status === 'pending' ? t('admin.notices_page.saved_and_sent_for_approval') : saved.status === 'scheduled' ? t('admin.notices_page.scheduled_for', { when: when(saved.publishAt) }) : t('admin.notices_page.saved_as_a_draft')}${failed.length ? t('admin.notices_page.could_not_be_attached', { p0: failed.join(', ') }) : ''}`),
    onError: (e) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); },
  });
  const go = (publish: boolean) => {
    const p: Record<string, string> = {};
    if (f.title.trim().length < 3) p.title = t('admin.notices_page.give_the_notice_a_title');
    if (f.body.trim().length < 3) p.body = t('admin.notices_page.write_the_notice');
    if (f.audience === 'class' && !f.classId) p.classId = t('admin.notices_page.pick_the_class');
    if (f.later && !published && (!f.day || schoolInstant(f.day, f.time) <= new Date())) p.day = t('admin.notices_page.choose_a_time_that_has');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate(publish);
  };
  const audiences = Object.entries(AUDIENCE).filter(([k]) => canPublish || k === 'class');
  return (
    <Dialog title={n ? (published ? t('admin.notices_page.correct_a_notice') : t('admin.notices_page.change_a_notice')) : t('admin.notices_page.new_notice')} onClose={onClose} width={600} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.notices_page.title')} value={f.title} onChange={set('title')} error={err.title} maxLength={120} />
        <div className="fld">
          <label htmlFor="ntc-body">{t('admin.notices_page.notice')}</label>
          <div className={`inp ${err.body ? 'err shake' : ''}`} style={{ height: 'auto' }}>
            <textarea id="ntc-body" className="ta" value={f.body} onChange={(e) => set('body')(e.target.value)} maxLength={4000} aria-invalid={!!err.body} />
          </div>
          {err.body && <div className="emsg" role="alert">{err.body}</div>}
        </div>
        <div className="two">
          <SelectField label={t('admin.notices_page.who_it_is_for')} value={f.audience} onChange={set('audience')} options={audiences.map(([value, label]) => ({ value, label }))} />
          {f.audience === 'class' && <SelectField label={t('admin.notices_page.class_2')} value={f.classId} onChange={set('classId')} options={[{ value: '', label: t('admin.notices_page.pick_a_class') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.notices_page.class_3', { name: c.name }) }))]} error={err.classId} />}
        </div>
        {!canPublish && <div className="help">{t('admin.notices_page.you_write_to_the_classes')}</div>}
        {canPublish && f.audience !== 'class' && (
          <div className="fld">
            <label>{t('admin.notices_page.only_some_of_them')}</label>
            <div className="help" style={{ marginTop: 0 }}>{t('admin.notices_page.none_ticked_everyone')}</div>
            {f.audience !== 'staff' && grades.length > 1 && <div className="tgrow">{grades.map((g) => <Checkbox key={g.value} label={g.label} checked={!!targets.grades?.includes(Number(g.value))} onChange={(on) => toggle('grades', Number(g.value), on)} />)}</div>}
            {f.audience !== 'staff' && houses.length > 0 && <div className="tgrow">{houses.map((h) => <Checkbox key={h.name} label={h.name} checked={!!targets.houses?.includes(h.name)} onChange={(on) => toggle('houses', h.name, on)} />)}</div>}
            {(f.audience === 'staff' || f.audience === 'everyone') && (roles.data?.length ?? 0) > 0 && <div className="tgrow">{roles.data!.map((r) => <Checkbox key={r.key} label={r.name} checked={!!targets.roles?.includes(r.key)} onChange={(on) => toggle('roles', r.key, on)} />)}</div>}
            {err.targets && <div className="emsg" role="alert">{err.targets}</div>}
          </div>
        )}
        <SelectField label={t('admin.notices_page.category')} value={f.category} onChange={set('category')} error={err.category} options={cats.map((c) => ({ value: c.key, label: c.name }))} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {canPin && <Checkbox checked={f.pinned} onChange={set('pinned')} label={t('admin.notices_page.pin_to_the_top')} />}
          <Checkbox checked={f.needsAck} onChange={set('needsAck')} label={t('admin.notices_page.ask_families_to_acknowledge_it')} />
          {!published && <Checkbox checked={f.later} onChange={set('later')} label={t('admin.notices_page.send_it_later')} />}
          {published && <Checkbox checked={f.tellAgain} onChange={set('tellAgain')} label={t('admin.notices_page.tell_everyone_again')} />}
        </div>
        {f.later && !published && <div className="two"><DateField label={t('admin.notices_page.day')} value={f.day} min={today()} onChange={set('day')} error={err.day} /><TimeField label={t('admin.notices_page.time')} value={f.time} onChange={set('time')} /></div>}
        <Attach files={files} onChange={setFiles} />
        {n && n.files.length > 0 && <div className="help">{t('admin.notices_page.already_attached')}{' '}{n.files.map((x) => x.name).join(', ')}</div>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{t('admin.notices_page.cancel')}</button>
        {!published && <button className="btn" disabled={save.isPending} onClick={() => go(false)}>{t('admin.notices_page.save_as_draft')}</button>}
        <button className="btn pri" disabled={save.isPending} onClick={() => go(true)}>{published ? t('admin.notices_page.save_the_correction') : f.later ? (canPublish ? t('admin.notices_page.schedule') : t('admin.notices_page.schedule_after_approval')) : canPublish ? t('admin.notices_page.send_now') : t('admin.notices_page.send_for_approval')}</button>
      </div>
    </Dialog>
  );
}

function TakeDown({ n, onClose, onDone }: { n: NoticeRow; onClose: () => void; onDone: (msg: string) => void }) {
  const app = useApp();
  const go = useMutation({ mutationFn: () => app.api.notices.remove(n.id), onSuccess: () => onDone(n.status === 'published' ? t('admin.notices_page.was_taken_down_it_no', { title: n.title }) : t('admin.notices_page.was_deleted', { title: n.title })) });
  return (
    <Dialog title={n.status === 'published' ? t('admin.notices_page.take_this_notice_down') : t('admin.notices_page.delete_this_notice')} onClose={onClose} width={460}>
      <p className="help" style={{ margin: 0 }}>{n.status === 'published' ? t('admin.notices_page.it_leaves_every_phone_at') : t('admin.notices_page.it_was_never_sent_so')}</p>
      {go.isError && <div className="emsg" role="alert" style={{ marginTop: 12 }}>{(go.error as Error).message}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.notices_page.keep_it')}</button>
        <button className="btn dng" disabled={go.isPending} onClick={() => go.mutate()}>{n.status === 'published' ? t('admin.notices_page.take_down') : t('admin.notices_page.delete')}</button>
      </div>
    </Dialog>
  );
}

function NotAcked({ n, onClose }: { n: NoticeRow; onClose: () => void }) {
  const app = useApp();
  const q = useQuery({ queryKey: ['notice-acks', n.id], queryFn: () => app.api.notices.notAcknowledged(n.id) });
  return (
    <Dialog title={t('admin.notices_page.who_has_not_acknowledged')} tag={{ text: t('admin.notices_page.people', { length: (q.data ?? []).length }), tone: 'a' }} onClose={onClose} width={480}>
      <div className="help" style={{ marginTop: 0 }}>{n.title}</div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        {q.isLoading ? <div className="help">{t('admin.notices_page.loading')}</div> : (q.data ?? []).map((p) => <div key={p.id} className="kv">{p.name}<b className="num">{p.phone ?? '–'}</b></div>)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn" onClick={onClose}>{t('admin.notices_page.close')}</button></div>
    </Dialog>
  );
}
