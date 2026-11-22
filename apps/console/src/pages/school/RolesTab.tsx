import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { PERMISSION_CATALOG, permissionAvailable, type RoleDef } from '@tangent/contracts';
import { Checkbox, Dialog, EmptyCard, ErrorLine, Field, Select, useShake, Icon, useMore, EmptyNote, t as tr, busyFor, Skeleton } from '@tangent/web-ui';
import { url } from '../../app/base';
import { useApp } from '../../app/context';

type Say = (text: string, tone?: 'ok' | 'bad') => void;

/** Roles at one school: what each can open and do (the school can change them too, unless roles.schoolEdits is off); and who holds which role. */
export function RolesTab({ schoolId, say }: { schoolId: string; say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['config', schoolId], queryFn: () => app.api.config.get(schoolId) });
  const can = app.can('schools.configure');
  const [sel, setSel] = useState<string>('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<Record<string, string>>({});
  const [sure, setSure] = useState(false);
  const [find, setFind] = useState('');
  const [moving, setMoving] = useState<{ userId: string; name: string; roleId: string } | null>(null);
  const templates = useQuery({ queryKey: ['role-templates'], queryFn: app.api.roleTemplates.get, staleTime: 5 * 60_000 });
  const shake = useShake();
  const roles = q.data?.roles ?? [];
  const cur: RoleDef | undefined = roles.find((r) => r.id === sel);
  useEffect(() => { if (!sel && roles[0]) setSel(roles[0].id); }, [roles, sel]);
  useEffect(() => { if (cur) { setName(cur.name); setDesc(cur.description); setPerms(new Set(cur.permissions)); setErr({}); setSure(false); } }, [cur?.id, q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only permissions of modules the school has; a role keeps the others (unseen) so they come back with the module.
  const offered = useMemo(() => PERMISSION_CATALOG.filter((p) => permissionAvailable(p.key, { modules: q.data?.entitled ?? [], features: q.data?.features ?? [] })), [q.data]);
  const groups = useMemo(() => [...new Set(offered.map((p) => p.area))].map((a) => ({ area: a, items: offered.filter((p) => p.area === a) })), [offered]);
  const after = (m: string, r: RoleDef[], pick?: string) => { qc.setQueryData(['config', schoolId], { ...q.data!, roles: r }); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); if (pick) setSel(pick); say(m); };
  const fail = (e: unknown) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); };
  const body = () => ({ name: name.trim(), description: desc.trim(), permissions: [...perms] });
  const save = useMutation({
    mutationFn: () => (sel === 'new' ? app.api.config.createRole(schoolId, body()) : app.api.config.saveRole(schoolId, sel, body())),
    onSuccess: (r) => after(sel === 'new' ? tr('console.roles_tab.was_made_put_people_in', { p0: name.trim() }) : tr('console.roles_tab.was_saved_people_in_it', { p0: name.trim() }), r, sel === 'new' ? r.find((x) => x.name === name.trim())?.id : undefined),
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => app.api.config.deleteRole(schoolId, sel), onSuccess: (r) => after(tr('console.roles_tab.role_deleted'), r, r[0]?.id ?? ''), onError: fail });
  const assign = useMutation({
    mutationFn: (b: { userId: string; roleId: string }) => app.api.config.setStaffRole(schoolId, b.userId, b.roleId),
    onSuccess: () => { setMoving(null); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); say(tr('console.roles_tab.role_changed_they_get_it')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });

  const people = (q.data?.staff ?? []).filter((s) => !find.trim() || `${s.name} ${s.designation}`.toLowerCase().includes(find.trim().toLowerCase()));
  const [shownPeople, morePeople] = useMore(people);

  if (q.isLoading) return <Skeleton kind="table" rows={6} />;
  if (q.isError || !q.data) return <EmptyCard error title={tr('console.roles_tab.roles')} chip={{ text: tr('console.roles_tab.couldn_t_load'), tone: 'c' }} icon="lock" heading={tr('console.roles_tab.roles_didn_t_load')} body={(q.error as Error)?.message ?? ''} actions={<button className="btn pri" onClick={() => void q.refetch()}>{tr('console.roles_tab.try_again')}</button>} />;
  const readOnly = !can || !!cur?.locked;
  // A new role starts from one of the starting roles (Blueprints → Starting roles), or from nothing.
  const startNew = (from: string) => {
    const t = templates.data?.find((x) => x.key === from);
    setSel('new'); setName(t ? tr('console.roles_tab.copy', { name: t.name }) : ''); setDesc(t?.description ?? ''); setPerms(new Set(t?.permissions ?? [])); setErr({});
  };
  const options = roles.map((r) => ({ value: r.id, label: r.name }));
  return (
    <section className="grid">
      <div className={`card s12 rise ${shake.cls}`}>
        <div className="ch"><h2>{tr('console.roles_tab.roles')}</h2><span className="chip">{roles.length}</span></div>
        <div className="help">{tr('console.roles_tab.a_role_decides_which_modules')}{' '}<a href={url(`/schools/${schoolId}/configuration`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${schoolId}/configuration?group=app`); }}>{tr('console.roles_tab.configuration_the_app')}</a>.</div>
        <div className="tgrow" style={{ marginTop: 12 }}>
          {roles.map((r) => <button key={r.id} type="button" className={`chip ${r.id === sel ? 'v' : ''}`} aria-pressed={r.id === sel} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }}>{r.name} · {r.people}</button>)}
          {sel === 'new' && <span className="chip v">{name.trim() || tr('console.roles_tab.new_role')}</span>}
          {can && sel !== 'new' && <Select compact aria-label={tr('console.roles_tab.new_role')} value="" onChange={startNew} options={[{ value: '', label: tr('console.roles_tab.new_role_from') }, ...(templates.data ?? []).map((t) => ({ value: t.key, label: t.name })), { value: '_blank', label: tr('console.roles_tab.nothing_start_empty') }]} />}
        </div>
        {(cur || sel === 'new') && (
          <>
            <div className="two" style={{ marginTop: 12 }}>
              <Field label={tr('console.roles_tab.role_name')} value={name} onChange={(v) => { setName(v); setErr({}); }} error={err.name} disabled={readOnly} maxLength={40} />
              <Field label={tr('console.roles_tab.what_it_is_for')} value={desc} onChange={setDesc} disabled={readOnly} maxLength={160} />
            </div>
            {cur?.locked && <div className="help">{tr('console.roles_tab.the_principal_role_always_has')}</div>}
            <div className="rolh2" style={{ marginTop: 12 }}>
              {groups.map((g) => (
                <fieldset key={g.area} style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
                  <legend className="lbl" style={{ marginBottom: 6 }}>{g.area}</legend>
                  {g.items.map((p) => (
                    <label key={p.key} className="hwc" style={{ display: 'flex', whiteSpace: 'normal', alignItems: 'flex-start', padding: '4px 0' }}>
                      <Checkbox checked={perms.has(p.key)} disabled={readOnly} onChange={(c) => { const n = new Set(perms); if (c) n.add(p.key); else n.delete(p.key); setPerms(n); }} />
                      <span>{p.label}{p.sensitive && <span className="chip a" style={{ marginInlineStart: 6, height: 20, padding: '0 8px' }}>{tr('console.roles_tab.careful')}</span>}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            {err._ && <ErrorLine>{err._}</ErrorLine>}
            {!readOnly && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                {cur && !cur.people ? (sure
                  ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dng" onClick={() => remove.mutate()}>{tr('console.roles_tab.yes_delete')}</button><button className="btn sm" onClick={() => setSure(false)}>{tr('console.roles_tab.keep')}</button></span>
                  : <button className="btn dng" onClick={() => setSure(true)}>{tr('console.roles_tab.delete_role')}</button>) : <span className="help">{cur?.people ? tr('console.roles_tab.this_role', { people: cur.people }) : ''}</span>}
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {sel === 'new' && <button className="btn" onClick={() => setSel(roles[0]?.id ?? '')}>{tr('console.roles_tab.cancel')}</button>}
                  <button className="btn pri" disabled={save.isPending} onClick={() => { if (name.trim().length < 2) { setErr({ name: tr('console.roles_tab.name_the_role') }); shake.hit(); } else save.mutate(); }}>{save.isPending ? tr('console.roles_tab.saving') : tr('console.roles_tab.save_role')}</button>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card s12 rise">
        <div className="ch" style={{ flexWrap: 'wrap', gap: 10 }}><h2>{tr('console.roles_tab.who_has_which_role')}</h2><span className="chip">{q.data.staff.length} {tr('console.roles_tab.staff')}</span><span className="grow"></span>
          <div className="srch" style={{ minWidth: 200, height: 38 }}><Icon name="search" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tr('console.roles_tab.find_a_person')} aria-label={tr('console.roles_tab.find_a_person')} style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} /></div>
        </div>
        <div className="help">{tr('console.roles_tab.whether_the_school_may_also')}</div>
        {people.length === 0 && <EmptyNote icon={find.trim() ? 'search' : 'people'} title={find.trim() ? tr('console.roles_tab.no_one_matches') : tr('console.roles_tab.no_staff_yet')} body={find.trim() ? tr('console.roles_tab.search_by_name_or_designation') : tr('console.roles_tab.staff_the_school_adds_show')} />}
        {shownPeople.map((s) => (
          <div key={s.id} className="kv" style={{ gap: 12 }}>
            <span style={{ minWidth: 0 }}>{s.name}<small style={{ display: 'block', color: 'var(--ink3)' }}>{s.designation}</small></span>
            <b style={{ minWidth: 200 }}>
              <Select value={s.roleId ?? ''} onChange={(roleId) => setMoving({ userId: s.id, name: s.name, roleId })} disabled={!can || busyFor(assign, s.id)} aria-label={tr('console.roles_tab.role_for', { name: s.name })}
                options={[...(s.roleId ? [] : [{ value: '', label: tr('console.roles_tab.no_role_yet') }]), ...options]} />
            </b>
          </div>
        ))}
        {morePeople}
      </div>
      {moving && (
        <Dialog title={tr('console.roles_tab.put_in', { name: moving.name, p1: roles.find((r) => r.id === moving.roleId)?.name ?? tr('console.roles_tab.this_role_2') })} tag={{ text: tr('console.roles_tab.takes_effect_within_a_minute'), tone: 'v' }} onClose={() => setMoving(null)} width={460}>
          <p style={{ marginTop: 0 }}>{tr('console.roles_tab.what_they_can_open_and')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setMoving(null)}>{tr('console.roles_tab.cancel')}</button>
            <button className="btn pri" disabled={assign.isPending} onClick={() => assign.mutate({ userId: moving.userId, roleId: moving.roleId })}>{tr('console.roles_tab.change_role')}</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
