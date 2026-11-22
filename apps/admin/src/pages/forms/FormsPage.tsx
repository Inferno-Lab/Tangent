import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FORM_AUDIENCES, FormInput, listLabel, schoolToday, type FieldDef, type FormCondition, type FormRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, EmptyNote, EmptyState, Field, FieldListEditor, Segmented, Select, SelectField, currentLanguage, useShake, t, Skeleton } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, problem, stamp, useSetting } from '../../app/kit';

const AUDIENCE = { families: t('admin.forms_page.families'), staff: t('admin.forms_page.staff'), link: t('admin.forms_page.anyone_with_the_link') } as const;
const STATE = { draft: { label: t('admin.forms_page.draft'), tone: '' }, open: { label: t('admin.forms_page.open'), tone: 'g' }, closed: { label: t('admin.forms_page.closed'), tone: 'a' } } as const;

/** The school's own forms (consent, surveys, data updates): built here, answered in the app or by link, answers read here. */
export function FormsPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const list = useQuery({ queryKey: ['forms'], queryFn: app.api.forms.list });
  const [editing, setEditing] = useState<FormRow | 'new' | null>(null);
  const [reading, setReading] = useState<FormRow | null>(null);
  const done = (m: string) => { setEditing(null); void qc.invalidateQueries({ queryKey: ['forms'] }); say(m); };
  const link = (f: FormRow) => `${window.location.origin}${window.location.pathname.replace(/\/forms.*$/, '')}/form/${f.token}`;
  return (
    <Page title={t('admin.forms_page.forms')} sub={t('admin.forms_page.consent_forms_surveys')} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={<AddBtn onClick={() => setEditing('new')}>{t('admin.forms_page.make_a_form')}</AddBtn>}
      overlays={<>
        {editing && <FormDialog form={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={done} />}
        {reading && <Answers form={reading} onClose={() => setReading(null)} say={say} />}
      </>}>
      {!(list.data ?? []).length ? <EmptyState scene="forms" onAction={() => setEditing('new')} /> : <Card style={{ padding: 0 }}>
        {(list.data ?? []).map((f) => (
          <div key={f.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b style={{ font: '700 14px/1.3 var(--fb)' }}>{f.title}</b>
              <small className="help" style={{ display: 'block', margin: 0 }}>{AUDIENCE[f.audience]}{f.perChild ? ` · ${t('admin.forms_page.each_child')}` : ''} · {stamp(f.createdAt)}{f.closesOn ? ` · ${t('admin.forms_page.closes', { day: f.closesOn })}` : ''}</small>
            </span>
            <span className={`chip ${STATE[f.status].tone}`}>{STATE[f.status].label}</span>
            <button className="btn sm" onClick={() => setReading(f)}>{t('admin.forms_page.answers', { n: f.responses })}</button>
            {f.audience === 'link' && f.status === 'open' && <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(link(f)); say(t('admin.forms_page.link_copied')); }}>{t('admin.forms_page.copy_link')}</button>}
            <button className="btn sm" onClick={() => setEditing(f)}>{t('admin.forms_page.edit')}</button>
          </div>
        ))}
      </Card>}
    </Page>
  );
}

/** Building a form: what it asks (the school's field kinds), which questions depend on an earlier answer, who answers and until when. */
function FormDialog({ form, onClose, onDone }: { form: FormRow | null; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const offered = useSetting<string[]>('app.languages', []);
  const own = useSetting<string>('school.language', 'en');
  const languages = offered.filter((l) => l !== own);
  const [f, setF] = useState<FormInput>(() => form ? { title: form.title, intro: form.intro, fields: form.fields, conditions: form.conditions, audience: form.audience, perChild: form.perChild, status: form.status, closesOn: form.closesOn }
    : { title: '', intro: '', fields: [{ key: 'field_1', label: t('admin.forms_page.first_question'), kind: 'text', required: true }], conditions: {}, audience: 'families', perChild: false, status: 'draft', closesOn: null });
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const answered = (form?.responses ?? 0) > 0;
  const put = (p: Partial<FormInput>) => { setF({ ...f, ...p }); setErr({}); };
  // A question can depend on a choice or yes/no question before it.
  const setCondition = (key: string, c: FormCondition | null) => { const next = { ...f.conditions }; if (c) next[key] = c; else delete next[key]; put({ conditions: next }); };
  const answersOf = (q: FieldDef | undefined) => (!q ? [] : q.kind === 'yesno' ? [{ value: 'yes', label: t('admin.forms_page.yes') }, { value: 'no', label: t('admin.forms_page.no') }]
    : (q.options ?? []).map((o) => ({ value: o.key, label: listLabel(q.options, o.key, currentLanguage()) })));
  const save = useMutation({
    mutationFn: () => {
      // Conditions on questions that were taken away, or that now come first, go with them.
      const keys = f.fields.map((x) => x.key);
      const conditions = Object.fromEntries(Object.entries(f.conditions).filter(([k, c]) => keys.indexOf(c.key) >= 0 && keys.indexOf(c.key) < keys.indexOf(k)));
      const body = FormInput.parse({ ...f, title: f.title.trim(), intro: f.intro.trim(), conditions });
      return form ? app.api.forms.save(form.id, body) : app.api.forms.add(body);
    },
    onSuccess: (r) => onDone(form ? t('admin.forms_page.saved', { title: r.title }) : t('admin.forms_page.made', { title: r.title })),
    onError: (e) => { const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      setErr(issues ? { _: issues[0]!.message } : problem(e)); shake.hit(); },
  });
  const del = useMutation({ mutationFn: () => app.api.forms.remove(form!.id), onSuccess: () => onDone(t('admin.forms_page.removed', { title: form!.title })), onError: (e) => { setConfirm(false); setErr(problem(e)); shake.hit(); } });
  return (
    <Dialog title={form ? t('admin.forms_page.edit_form') : t('admin.forms_page.make_a_form')} onClose={onClose} width={760} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.forms_page.title')} value={f.title} onChange={(v) => put({ title: v })} error={err.title} maxLength={100} />
        <AreaField label={t('admin.forms_page.intro_optional')} value={f.intro} onChange={(v) => put({ intro: v })} rows={2} maxLength={1000} />
        <div className="two">
          <SelectField label={t('admin.forms_page.who_answers')} value={f.audience} disabled={answered} onChange={(v) => put({ audience: v as FormInput['audience'] })} options={FORM_AUDIENCES.map((a) => ({ value: a, label: AUDIENCE[a] }))} />
          <DateField label={t('admin.forms_page.closes_after_optional')} value={f.closesOn ?? ''} min={schoolToday()} onChange={(v) => put({ closesOn: v || null })} error={err.closesOn} />
        </div>
        {f.audience === 'families' && <Checkbox checked={f.perChild} disabled={answered} label={t('admin.forms_page.once_for_each_child')} onChange={(on) => put({ perChild: on })} />}
        {answered && <div className="help" style={{ marginTop: 0 }}>{t('admin.forms_page.answered_locked')}</div>}
        <div className="lbl" style={{ marginTop: 6 }}>{t('admin.forms_page.questions')}</div>
        <FieldListEditor list={f.fields} setList={(fields) => put({ fields })} languages={languages} disabled={false} inApp={false} max={40} />
        {f.fields.length > 1 && (
          <div className="fld">
            <label>{t('admin.forms_page.ask_only_when')}</label>
            {f.fields.slice(1).map((q, i) => {
              const before = f.fields.slice(0, i + 1).filter((x) => x.kind === 'yesno' || x.kind === 'choice' || x.kind === 'multi');
              const c = f.conditions[q.key];
              return (
                <div key={q.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  <span style={{ minWidth: 160, flex: 1 }}>{q.label}</span>
                  <div style={{ width: 220 }}><Select compact aria-label={t('admin.forms_page.depends_on', { q: q.label })} value={c?.key ?? ''} disabled={!before.length}
                    onChange={(k) => setCondition(q.key, k ? { key: k, equals: answersOf(before.find((x) => x.key === k))[0]?.value ?? '' } : null)}
                    options={[{ value: '', label: t('admin.forms_page.always') }, ...before.map((x) => ({ value: x.key, label: t('admin.forms_page.when_q', { q: x.label }) }))]} /></div>
                  {c && <div style={{ width: 180 }}><Select compact aria-label={t('admin.forms_page.answer_is', { q: q.label })} value={c.equals} onChange={(v) => setCondition(q.key, { ...c, equals: v })} options={answersOf(f.fields.find((x) => x.key === c.key))} /></div>}
                </div>
              );
            })}
          </div>
        )}
        <Segmented label={t('admin.forms_page.state')} value={f.status} onChange={(v) => put({ status: v })} options={(['draft', 'open', 'closed'] as const).map((s) => ({ value: s, label: STATE[s].label }))} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {form && !answered && (confirm
          ? <span style={{ marginInlineEnd: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dngf" disabled={del.isPending} onClick={() => del.mutate()}>{t('admin.forms_page.yes_remove')}</button><button className="btn sm" onClick={() => setConfirm(false)}>{t('admin.forms_page.keep')}</button></span>
          : <button className="btn dng" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirm(true)}>{t('admin.forms_page.remove')}</button>)}
        <button className="btn" onClick={onClose}>{t('admin.forms_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || f.title.trim().length < 3} onClick={() => save.mutate()}>{save.isPending ? t('admin.forms_page.saving') : t('admin.forms_page.save')}</button>
      </div>
    </Dialog>
  );
}

/** A form's answers: who, for which child, when, and each answer; downloaded as a spreadsheet. */
function Answers({ form, onClose, say }: { form: FormRow; onClose: () => void; say: (m: string, tone?: 'ok' | 'bad') => void }) { const app = useApp();
  const r = useQuery({ queryKey: ['forms', form.id, 'answers'], queryFn: () => app.api.forms.responses(form.id) });
  const show = (v: unknown, q: FieldDef) => (v === null || v === undefined ? '–' : typeof v === 'boolean' ? (v ? t('admin.forms_page.yes') : t('admin.forms_page.no'))
    : Array.isArray(v) ? v.map((x) => listLabel(q.options, String(x), currentLanguage())).join(', ') : q.kind === 'choice' ? listLabel(q.options, String(v), currentLanguage()) : String(v));
  const download = async () => {
    try {
      const csv = await app.api.forms.csv(form.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `${form.title}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { say((e as Error).message, 'bad'); }
  };
  return (
    <Dialog title={form.title} tag={{ text: t('admin.forms_page.answers', { n: form.responses }), tone: 'v' }} onClose={onClose} width={760}>
      {!r.data ? <Skeleton kind="table" rows={5} /> : !r.data.rows.length
        ? <EmptyNote icon="file" title={t('admin.forms_page.no_answers_yet')} body={t('admin.forms_page.no_answers_body')} />
        : <div className="lscroll" style={{ maxHeight: 'min(56dvh,480px)', border: '1px solid var(--line)', borderRadius: 16, padding: '4px 16px' }}>
            {r.data.rows.map((x) => (
              <div key={x.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <b style={{ font: '700 13px var(--fb)' }}>{x.by}{x.studentName ? ` · ${x.studentName}` : ''}</b> <small className="help" style={{ margin: 0 }}>{stamp(x.createdAt)}</small>
                {r.data!.form.fields.map((q) => <div key={q.key} className="kv"><span>{q.label}</span><b>{show(x.answers[q.key], q)}</b></div>)}
              </div>
            ))}
          </div>}
      <div className="tgrow" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" disabled={!r.data?.rows.length} onClick={() => void download()}>{t('admin.forms_page.download')}</button>
        <button className="btn pri" onClick={onClose}>{t('admin.forms_page.close')}</button>
      </div>
    </Dialog>
  );
}
