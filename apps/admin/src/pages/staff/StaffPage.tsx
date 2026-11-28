import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomFieldsSetting, CustomValues, StaffRow } from '@tangent/contracts';
import { CustomFieldInputs, Dialog, Field, PhoneField, Segmented, Select, SelectField, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, Avatar, Ico, problem, useCountry, useSchoolConfig, useSetting } from '../../app/kit';
import { ImportDialog } from '../students/StudentDialogs';

const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['staff', 'dashboard', 'shell', 'roles', 'activation'].includes(String(q.queryKey[0])) });
const SEARCH = 'search';
type Show = 'all' | 'active' | 'waiting' | 'off';
/** Where a person stands: switched off, or active and signed in, invited, or not invited yet. */
const standing = (r: StaffRow) => r.status !== 'active' ? { label: tr('admin.staff_page.off'), tone: 'n' } : r.access === 'signed_in' ? { label: tr('admin.staff_page.active'), tone: 'g' } : r.access === 'invited' ? { label: tr('admin.staff_page.invited_badge'), tone: 'a' } : { label: tr('admin.staff_page.not_invited'), tone: 'a' };
const names = (list: string[]) => list.length > 3 ? tr('admin.staff_page.and_more', { p0: list.slice(0, 3).join(', '), p1: list.length - 3 }) : list.join(', ');

export function StaffPage() { const app = useApp();
  const qc = useQueryClient();
  const cfg = useSchoolConfig();
  const { toast, say } = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [editing, setEditing] = useState<StaffRow | 'new' | 'import' | null>(null);
  const list = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const canWrite = app.user.permissions.includes('staff.write');
  // Periods a week come from the timetable, so the column is there only when the school has it.
  const periods = !!cfg?.modules.includes('timetable');
  const all = list.data ?? [];
  const rows = useMemo(() => { const t = q.trim().toLowerCase();
    return all.filter((r) => (!role || r.roles.some((x) => x.id === role))
      && (show === 'all' || (show === 'off' ? r.status !== 'active' : r.status === 'active' && (show === 'active' || r.access !== 'signed_in')))
      && (!t || [r.name, r.email ?? '', r.designation, r.department ?? '', ...r.subjects.map((s) => s.name), ...r.roles.map((x) => x.name)].some((x) => x.toLowerCase().includes(t))));
  }, [all, q, role, show]);
  const roles = [...new Map(all.flatMap((r) => r.roles).map((r) => [r.id, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const waiting = all.filter((r) => r.status === 'active' && r.access !== 'signed_in');
  const notInvited = waiting.filter((r) => r.access === 'none').length;
  const invite = useMutation({ mutationFn: (remind: boolean) => app.api.movingIn.inviteStaff(remind),
    onSuccess: (r, remind) => { refresh(qc);
      const sent = r.sent ? remind ? tr('admin.staff_page.sent_a_new_first_password', { n: r.sent }) : tr('admin.staff_page.invited', { n: r.sent }) : remind ? tr('admin.staff_page.everyone_invited_has_signed_in') : tr('admin.staff_page.everyone_has_been_invited');
      say(r.skipped.length ? tr('admin.staff_page.no_email_or_phone_add', { sent, names: names(r.skipped), n: r.skipped.length }) : sent, r.skipped.length ? 'bad' : undefined);
    },
    onError: (e) => say(Object.values(problem(e))[0] ?? tr('admin.staff_page.something_went_wrong'), 'bad') });
  const download = async () => { try { const csv = await app.api.staff.exportCsv();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      a.download = 'staff.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { say((e as Error).message, 'bad'); }
  };
  const cols = `minmax(0,1.7fr) minmax(0,1.3fr) 160px ${periods ? '120px ' : ''}110px`;
  return (
    <Page title={tr('admin.staff_page.staff')} sub={all.length ? tr('admin.staff_page.active_in_all', { length: all.filter((s) => s.status === 'active').length, length1: all.length }) : tr('admin.staff_page.teachers_and_office_staff')} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={<>
        {canWrite && <button className="btn" onClick={() => setEditing('import')}>{tr('admin.staff_page.import')}</button>}
        {all.length > 0 && <button className="btn" onClick={() => void download()}>{tr('admin.staff_page.export')}</button>}
        {canWrite && <AddBtn onClick={() => setEditing('new')}>{tr('admin.staff_page.add_staff')}</AddBtn>}
      </>}
      overlays={<>
        {editing === 'import' && <ImportDialog kind="staff" onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); refresh(qc); if (msg) say(msg); }} />}
        {editing && editing !== 'import' && <StaffDialog person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); refresh(qc); say(msg); }} />}
      </>}>
      {all.length === 0 ? (
        <div><EmptyState scene="staff" onAction={canWrite ? () => setEditing('new') : undefined} onLink={canWrite ? () => setEditing('import') : undefined} /></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {canWrite && waiting.length > 0 && (
            <Card title={tr('admin.staff_page.not_signed_in_yet')} chip={<span className="chip a">{waiting.length}</span>}>
              <p className="help" style={{ marginTop: 0 }}>{notInvited ? tr('admin.staff_page.not_been_invited', { notInvited }) : ''}{waiting.length - notInvited ? tr('admin.staff_page.invited_not_signed_in', { p0: waiting.length - notInvited }) : ''}{tr('admin.staff_page.an_invite_carries_a_first')}</p>
              <div className="tgrow">
                {notInvited > 0 && <button className="btn pri" disabled={invite.isPending} onClick={() => invite.mutate(false)}>{tr('admin.staff_page.invite', { n: notInvited })}</button>}
                {waiting.length > notInvited && <button className="btn" disabled={invite.isPending} onClick={() => invite.mutate(true)}>{tr('admin.staff_page.remind_those_invited')}</button>}
                <button className="btn" onClick={() => setShow('waiting')}>{tr('admin.staff_page.show_who')}</button>
              </div>
            </Card>
          )}
          <section className="card tbl rise" style={{ padding: 0 }}>
            <div className="ch" style={{ padding: '24px 24px 16px', flexWrap: 'wrap', gap: 10 }}>
              <h2>{tr('admin.staff_page.everyone')}</h2>
              <span className="grow"></span>
              <Segmented label={tr('admin.staff_page.show')} value={show} onChange={setShow} options={[{ value: 'all', label: tr('admin.staff_page.all_2') }, { value: 'active', label: tr('admin.staff_page.active') }, { value: 'waiting', label: tr('admin.staff_page.not_signed_in'), count: waiting.length }, { value: 'off', label: tr('admin.staff_page.off') }]} />
              {roles.length > 1 && <Select compact aria-label={tr('admin.staff_page.role')} value={role} onChange={setRole} options={[{ value: '', label: tr('admin.staff_page.every_role') }, ...roles.map(([id, name]) => ({ value: id, label: name }))]} />}
              <div className="srch" style={{ minWidth: 220, height: 38 }}><Ico d={SEARCH} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('admin.staff_page.name_email_subject_or_role')} aria-label={tr('admin.staff_page.search_staff')} style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} /></div>
            </div>
            {rows.length === 0 ? <div style={{ padding: '0 24px 24px' }}><EmptyNote icon={q ? 'search' : 'people'} title={q ? tr('admin.staff_page.no_one_matches', { q }) : tr('admin.staff_page.no_one_here')} body={q ? tr('admin.staff_page.search_by_name_subject_or') : tr('admin.staff_page.people_in_this_group_show')} /></div> : (
              <div className="scroll-x lscroll" data-fill="">
                <div className="stfw" style={{ minWidth: periods ? 780 : 660 }}>
                  <div className="grd th stf" style={{ '--cols': cols } as React.CSSProperties}><span>{tr('admin.staff_page.person')}</span><span className="hs">{tr('admin.staff_page.teaches')}</span><span>{tr('admin.staff_page.role')}</span>{periods && <span className="hs">{tr('admin.staff_page.periods_a_week')}</span>}<span className="hs">{tr('admin.staff_page.status')}</span></div>
                  {rows.map((r) => { const st = standing(r);
                    return (
                      <button className="rowbtn" key={r.id} onClick={() => setEditing(r)} aria-label={tr('admin.staff_page.open', { name: r.name })}>
                        <div className="grd rw stf" style={{ '--cols': cols } as React.CSSProperties}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                            <Avatar name={r.name} />
                            <span style={{ minWidth: 0 }}><b data-tip={r.name} style={{ font: '700 14px var(--fb)', overflowWrap: 'anywhere' }}>{r.name}</b><small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{r.designation}{r.department ? ` · ${r.department}` : ''}</small></span>
                          </span>
                          <span className="tgrow hs" style={{ gap: 6 }}>{r.subjects.length ? r.subjects.map((s) => <span className="chip" key={s.id}>{s.name}</span>) : <span style={{ color: 'var(--ink3)', font: '600 13px var(--fb)' }}>–</span>}</span>
                          <span className="tgrow" style={{ gap: 6 }}>{r.roles.length ? r.roles.map((x) => <span className="chip v" key={x.id}>{x.name}</span>) : <span className="chip">{tr('admin.staff_page.no_role')}</span>}</span>
                          {periods && <span className="us hs" style={{ gap: 4 }}><div className="bar" style={{ height: 12 }}><i style={{ width: `${Math.min(100, Math.round((r.periodsPerWeek / Math.max(1, r.maxPeriods)) * 100))}%` }}></i></div><small style={{ font: '700 11px var(--fb)', color: 'var(--ink3)' }}>{r.periodsPerWeek} {tr('admin.staff_page.of')}{' '}{r.maxPeriods}</small></span>}
                          <span className={`st hs ${st.tone}`}><i></i>{st.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

function StaffDialog({ person, onClose, onDone }: { person: StaffRow | null; onClose: () => void; onDone: (msg: string) => void }) { const app = useApp();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects, staleTime: 10 * 60_000 });
  const roles = useQuery({ queryKey: ['roles'], queryFn: app.api.roles.list, staleTime: 60_000 });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const me = person?.id === app.user.id;
  const country = useCountry();
  const [f, setF] = useState({ name: person?.name ?? '', email: person?.email ?? '', phone: person?.phone ?? '', designation: person?.designation ?? tr('admin.staff_page.teacher'), department: person?.department ?? '', roleId: person?.roles[0]?.id ?? '', managerId: person?.managerId ?? '' });
  // A new person starts as a teacher where the school has that role, else in the first one.
  const roleId = f.roleId || (roles.data?.find((r) => r.key === 'teacher') ?? roles.data?.[0])?.id || '';
  const [subs, setSubs] = useState<string[]>(person?.subjects.map((s) => s.id) ?? []);
  const own = useSetting<CustomFieldsSetting>('fields.custom', {}).staff ?? [];
  const [custom, setCustom] = useState<CustomValues>(person?.custom ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const fail = (e: unknown) => { setErr(problem(e)); shake.hit(); };
  const save = useMutation({ mutationFn: () => { if (!person) return app.api.staff.create({ name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), designation: f.designation.trim() || tr('admin.staff_page.teacher'), department: f.department.trim() || undefined, subjectIds: subs, roleId, custom, managerId: f.managerId || null });
      // Only what changed: a person with two roles keeps both unless the role is changed here.
      const changed = <T,>(now: T, was: T) => (now !== was ? now : undefined);
      return app.api.staff.patch(person.id, { name: changed(f.name.trim(), person.name), email: changed(f.email.trim().toLowerCase(), person.email ?? ''), phone: changed(f.phone.trim(), person.phone ?? ''),
        designation: f.designation.trim(), department: f.department.trim() || null, subjectIds: subs, custom, managerId: changed(f.managerId || null, person.managerId), ...(me || roleId === person.roles[0]?.id ? {} : { roleId }) });
    },
    onSuccess: (r) => onDone(person ? tr('admin.staff_page.was_updated', { name: r.name }) : tr('admin.staff_page.was_added_invite_sent_to', { name: r.name, email: r.email })),
    onError: fail });
  const toggle = useMutation({ mutationFn: () => app.api.staff.patch(person!.id, { status: person!.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: (r) => onDone(r.status === 'active' ? tr('admin.staff_page.can_sign_in_again', { name: r.name }) : tr('admin.staff_page.was_switched_off_and_signed', { name: r.name })),
    onError: fail });
  const resend = useMutation({ mutationFn: () => app.api.staff.invite(person!.id), onSuccess: (r) => onDone(tr('admin.staff_page.invite_sent_to', { to: r.to })), onError: fail });
  // A lost phone: their authenticator is dropped, they are signed out, and they add a new one at their next sign-in.
  const renew = useMutation({ mutationFn: () => app.api.staff.patch(person!.id, { resetAuthenticator: true }), onSuccess: (r) => onDone(tr('admin.staff_page.new_authenticator_done', { name: r.name })), onError: fail });
  const go = () => { const p: Record<string, string> = {};
    if (f.name.trim().length < 2) p.name = tr('admin.staff_page.enter_the_name');
    if ((!person || f.email.trim()) && !/^\S+@\S+\.\S+$/.test(f.email.trim())) p.email = tr('admin.staff_page.enter_a_valid_email');
    if (!person && !f.phone.trim()) p.phone = tr('admin.staff_page.enter_a_phone_number');
    if (f.designation.trim().length < 2) p.designation = tr('admin.staff_page.enter_what_they_do_like');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate();
  };
  const st = person && standing(person);
  return (
    <Dialog title={person ? person.name : tr('admin.staff_page.add_staff')} tag={st ? { text: st.label, tone: st.tone === 'g' ? 'g' : 'a' } : undefined} onClose={onClose} width={580} shake={shake.cls}>
      <div className="stack">
        <Field label={tr('admin.staff_page.full_name')} value={f.name} onChange={set('name')} error={err.name} maxLength={80} />
        <div className="two">
          <Field label={tr('admin.staff_page.email')} type="email" value={f.email} onChange={set('email')} error={err.email} hint={tr('admin.staff_page.they_sign_in_with_this')} />
          <PhoneField country={country} label={tr('admin.staff_page.phone')} value={f.phone} onChange={set('phone')} error={err.phone} />
        </div>
        <div className="two">
          <Field label={tr('admin.staff_page.designation')} value={f.designation} onChange={set('designation')} error={err.designation} maxLength={60} />
          <Field label={tr('admin.staff_page.department_optional')} value={f.department} onChange={set('department')} maxLength={60} />
        </div>
        <SelectField label={tr('admin.staff_page.line_manager')} value={f.managerId} onChange={set('managerId')} error={err.managerId}
          options={[{ value: '', label: tr('admin.staff_page.no_line_manager') }, ...(staff.data ?? []).filter((x) => x.id !== person?.id && (x.status === 'active' || x.id === f.managerId)).map((x) => ({ value: x.id, label: `${x.name} · ${x.designation}` }))]} />
        <SelectField label={tr('admin.staff_page.role')} value={roleId} onChange={set('roleId')} disabled={me} error={err.roleId} options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
        {me && <div className="help">{tr('admin.staff_page.you_cannot_change_your_own')}</div>}
        {person && person.roles.length > 1 && !me && <div className="help">{tr('admin.staff_page.also')}{' '}{person.roles.slice(1).map((r) => r.name).join(', ')}{tr('admin.staff_page.choosing_a_role_here_replaces')}</div>}
        <div className="fld">
          <label>{tr('admin.staff_page.teaches')}</label>
          <div className="tgrow">
            {(subjects.data ?? []).map((s) => { const on = subs.includes(s.id);
              return <button type="button" key={s.id} className={`fp ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setSubs(on ? subs.filter((x) => x !== s.id) : [...subs, s.id])}>{s.name}</button>;
            })}
          </div>
        </div>
        <CustomFieldInputs defs={own} values={custom} onChange={setCustom} errors={err} />
        {person && person.status === 'active' && person.access !== 'signed_in' && !me && (
          <div className="help" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 240px' }}>{person.access === 'invited' ? tr('admin.staff_page.invited_not_signed_in_yet') : tr('admin.staff_page.not_invited_yet')}</span>
            <button className="btn sm" disabled={resend.isPending} onClick={() => resend.mutate()}>{person.access === 'invited' ? tr('admin.staff_page.send_a_new_invite') : tr('admin.staff_page.send_the_invite')}</button>
          </div>
        )}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {person && !me ? <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={`btn ${person.status === 'active' ? 'dng' : ''}`} disabled={toggle.isPending} onClick={() => toggle.mutate()}>{person.status === 'active' ? tr('admin.staff_page.switch_off') : tr('admin.staff_page.switch_on')}</button>
          {person.status === 'active' && person.access === 'signed_in' && <button className="btn" disabled={renew.isPending} onClick={() => renew.mutate()} data-tip={tr('admin.staff_page.new_authenticator_tip')}>{tr('admin.staff_page.new_authenticator')}</button>}
        </span> : <span />}
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={onClose}>{tr('admin.staff_page.cancel')}</button>
          <button className="btn pri" disabled={save.isPending} onClick={go}>{save.isPending ? tr('admin.staff_page.saving') : person ? tr('admin.staff_page.save') : tr('admin.staff_page.add_and_send_invite')}</button>
        </span>
      </div>
    </Dialog>
  );
}
