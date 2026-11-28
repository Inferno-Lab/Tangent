import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { MODULES } from '@tangent/config-engine';
import { fmtNumber, PERMISSION_CATALOG, SETTINGS_META, permissionAvailable, settingOwner, type EffectiveConfig, type RoleDefSave, type RoleRow, type SettingsResponse } from '@tangent/contracts';
import { Checkbox, EmptyCard, ErrorLine, Field, Icon, Segmented, useShake, useToast, t, Skeleton } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page } from '../../app/Page';
import { SettingsEditor } from '../../app/SettingsView';
import { usePageTabs } from '../../app/tabs';
import { AskTangent } from './AskTangent';

/**
 * Who the school is: its identity (its own to change), what its plan includes, its roles and its data. How people sign in,
 * what the app shows each role, how messages travel and the privacy notice are Tangent's to set, so they are not here:
 * "Ask Tangent" asks for a change. Module settings live on each module's own Settings tab.
 */
const AREA: Record<string, string> = { data: t('admin.profile_page.your_data'), identity: t('admin.profile_page.school_identity'), plan: t('admin.profile_page.plan_and_modules'), roles: t('admin.profile_page.roles') };
const editable = (...groups: string[]) => Object.entries(SETTINGS_META).filter(([k, m]) => groups.includes(m.group) && settingOwner(k) === 'school').map(([k]) => k);

export function ProfilePage() {
  const app = useApp();
  const { toast, say } = useToast();
  const { tab, tabs } = usePageTabs('/profile');
  const [asking, setAsking] = useState(false);
  const doc = useQuery({ queryKey: ['settings'], queryFn: app.api.settings.get });
  const cfg = useQuery({ queryKey: ['config'], queryFn: app.api.config, staleTime: 60_000 });
  const err = [doc, cfg].find((q) => q.isError && !q.data);
  const d = doc.data;
  const c = cfg.data;
  return (
    <Page title={t('admin.profile_page.school_profile')} sub={t('admin.profile_page.who_your_school_is_and')} toast={toast} loading={doc.isLoading || cfg.isLoading}
      error={err ? { message: (err.error as Error).message, retry: () => void err.refetch() } : null}
      tabs={tabs} actions={<><button className="btn pri" onClick={() => setAsking(true)}>{t('admin.profile_page.ask_tangent_to_change_this')}</button></>}
      overlays={asking && <AskTangent area={AREA[tab] ?? t('admin.profile_page.school_profile')} onClose={() => setAsking(false)} onDone={() => { setAsking(false); say(t('admin.profile_page.sent_to_tangent_the_answer')); }} />}>
      {d && c && (
        <div className="stack" style={{ gap: 16 }}>
          {tab === 'identity' && <>
            <SettingsEditor title={t('admin.profile_page.the_school')} keys={editable('School identity')} say={say} />
            <Card title={t('admin.profile_page.addresses')}>
              <div className="kv"><span>{t('admin.profile_page.the_admin')}</span><b>{`${window.location.host}${app.base}`}</b></div>
              <div className="kv"><span>{t('admin.profile_page.school_code_families_type_it')}</span><b>{app.slug.toUpperCase()}</b></div>
            </Card>
          </>}
          {tab === 'plan' && <Plan doc={d} cfg={c} />}
          {tab === 'roles' && <Roles cfg={c} say={say} />}
          {tab === 'data' && <YourData say={say} />}
        </div>
      )}
    </Page>
  );
}

/** A count against its limit: a bar when there is a limit, the number alone when there is none. */
function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="us" data-tip={limit ? t('admin.profile_page.used_pct', { pct }) : undefined}>
      <div className="r"><span>{label}</span><b>{limit ? t('admin.profile_page.used_of', { used: fmtNumber(used), limit: fmtNumber(limit) }) : fmtNumber(used)}</b></div>
      {!!limit && <div className={`bar ${pct >= 90 ? 'warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

/**
 * What the school's plan gives it, in its own words: how much of it is used, and each part of Tangent it has with what that
 * part does for it. Nothing here is a setting: the school asks Tangent to add a part or change the plan.
 */
function Plan({ doc, cfg }: { doc: SettingsResponse; cfg: EffectiveConfig }) {
  const u = doc.usage;
  const on = MODULES.filter((m) => m.state !== 'planned' && (m.core || cfg.modules.includes(m.key)));
  return <>
    <Card title={t('admin.profile_page.plan', { p0: u.plan.charAt(0).toUpperCase(), p1: u.plan.slice(1) })}>
      <div className="grid" style={{ gap: 20 }}>
        <div className="s4"><Usage label={t('admin.profile_page.students')} used={u.students} limit={u.studentLimit || null} /></div>
        <div className="s4"><Usage label={t('admin.profile_page.texts_this_month')} used={u.smsUsed} limit={u.smsLimit || null} /></div>
        <div className="s4"><Usage label={t('admin.profile_page.staff')} used={u.staff} limit={null} /></div>
      </div>
    </Card>
    <Card title={t('admin.profile_page.what_your_school_has')} chip={<span className="chip">{fmtNumber(on.length)}</span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px,100%),1fr))', gap: 12 }}>
        {on.map((m) => {
          const feats = m.features.filter((f) => cfg.features.includes(f.key));
          return (
            <div key={m.key} style={{ padding: 16, borderRadius: 18, background: 'var(--s2)', minWidth: 0 }}>
              <b style={{ display: 'block', font: '700 15px var(--fb)' }}>{m.name}</b>
              <small style={{ display: 'block', font: '500 13px/1.45 var(--fb)', color: 'var(--ink3)', marginTop: 4 }}>{m.blurb}</small>
              {feats.length > 0 && <div className="tgrow" style={{ marginTop: 10, gap: 6 }}>{feats.map((f) => <span key={f.key} className="chip g">{f.name}</span>)}</div>}
            </div>
          );
        })}
      </div>
      <p className="help" style={{ marginBottom: 0 }}>{t('admin.profile_page.to_add_a_part')}</p>
    </Card>
  </>;
}

/** The school's roles: it makes and changes them (unless Tangent holds them), with only the permissions its plan includes. */
function Roles({ cfg, say }: { cfg: EffectiveConfig; say: (m: string, tone?: 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: app.api.roles.list });
  const [sel, setSel] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<Record<string, string>>({});
  const [sure, setSure] = useState(false);
  const shake = useShake();
  const list = roles.data ?? [];
  const cur = sel === 'new' ? undefined : list.find((r) => r.id === sel) ?? list[0];
  useEffect(() => { if (cur) { setName(cur.name); setDesc(cur.description); setPerms(new Set(cur.permissions)); setErr({}); setSure(false); } }, [cur?.id, roles.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only permissions of modules the school has; a role keeps the others (unseen) so they come back with the module.
  const offered = PERMISSION_CATALOG.filter((p) => permissionAvailable(p.key, cfg));
  const areas = [...new Set(offered.map((p) => p.area))];
  const held = cfg.settings['roles.schoolEdits'] === false;
  const can = app.user.permissions.includes('settings.manage') && !held;
  const after = (m: string, r: RoleRow[], pick: string) => { qc.setQueryData(['roles'], r); setSel(pick); say(m); };
  const fail = (e: unknown) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); };
  const body = (): RoleDefSave => ({ name: name.trim(), description: desc.trim(), permissions: [...perms] as RoleDefSave['permissions'] });
  const save = useMutation({
    mutationFn: () => (cur ? app.api.roles.save(cur.id, body()) : app.api.roles.create(body())),
    onSuccess: (r) => after(cur ? t('admin.profile_page.role_saved', { name: name.trim() }) : t('admin.profile_page.role_made', { name: name.trim() }), r, r.find((x) => x.name === name.trim())?.id ?? ''),
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => app.api.roles.remove(cur!.id), onSuccess: (r) => after(t('admin.profile_page.role_deleted'), r, ''), onError: fail });
  const startNew = () => { setSel('new'); setName(''); setDesc(''); setPerms(new Set()); setErr({}); setSure(false); };

  if (roles.isLoading) return <Skeleton kind="rows" rows={4} />;
  if (roles.isError) return <EmptyCard error title={t('admin.profile_page.roles')} chip={{ text: t('admin.profile_page.couldn_t_load'), tone: 'c' }} icon="lock" heading={t('admin.profile_page.you_can_t_see_roles')} body={(roles.error as Error).message} actions={<button className="btn pri" onClick={() => void roles.refetch()}>{t('admin.profile_page.try_again')}</button>} />;
  if (!list.length && sel !== 'new') return <EmptyCard title={t('admin.profile_page.roles')} chip={{ text: '0', tone: 'v' }} icon="lock" heading={t('admin.profile_page.no_roles_yet')} body={can ? t('admin.profile_page.make_a_role_for_each') : t('admin.profile_page.tangent_makes_the_school_s')} actions={can ? <button className="btn pri" onClick={startNew}>{t('admin.profile_page.new_role')}</button> : undefined} />;
  const readOnly = !can || !!cur?.locked;
  return <>
    <div className="tgrow">
      <Segmented label={t('admin.profile_page.roles')} value={cur?.id ?? 'new'} onChange={setSel} options={[...list.map((r) => ({ value: r.id, label: r.name, count: r.people })), ...(sel === 'new' ? [{ value: 'new', label: name.trim() || t('admin.profile_page.new_role') }] : [])]} style={{ maxWidth: '100%', overflowX: 'auto' }} />
      {can && sel !== 'new' && <button className="btn" onClick={startNew}><Icon name="plus" />{t('admin.profile_page.new_role')}</button>}
    </div>
    <div className={shake.cls}>
      <Card title={cur?.name ?? t('admin.profile_page.new_role')} chip={cur ? <span className="chip">{t('admin.profile_page.n_people', { n: cur.people })}</span> : undefined}>
        {!can && <p className="help" style={{ marginTop: 0 }}>{held ? t('admin.profile_page.tangent_holds_your_roles') : t('admin.profile_page.only_people_who_manage_settings')}</p>}
        {cur?.locked && <p className="help" style={{ marginTop: 0 }}>{t('admin.profile_page.the_principal_role_has_everything')}</p>}
        <div className="two">
          <Field label={t('admin.profile_page.role_name')} value={name} onChange={(v) => { setName(v); setErr({}); }} error={err.name} disabled={readOnly} maxLength={40} />
          <Field label={t('admin.profile_page.what_it_is_for')} value={desc} onChange={setDesc} disabled={readOnly} maxLength={160} />
        </div>
        {areas.map((a) => (
          <fieldset key={a} style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
            <legend className="lbl" style={{ marginBottom: 6 }}>{a}</legend>
            {offered.filter((p) => p.area === a).map((p) => (
              <label key={p.key} className="hwc" style={{ display: 'flex', whiteSpace: 'normal', alignItems: 'flex-start', padding: '4px 0' }}>
                <Checkbox checked={perms.has(p.key)} disabled={readOnly} onChange={(c) => { const x = new Set(perms); if (c) x.add(p.key); else x.delete(p.key); setPerms(x); }} />
                <span>{p.label}{p.sensitive && <span className="chip a" style={{ marginInlineStart: 6 }}>{t('admin.profile_page.careful')}</span>}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {cur && !cur.people ? (sure
              ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dng" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('admin.profile_page.yes_delete')}</button><button className="btn sm" onClick={() => setSure(false)}>{t('admin.profile_page.keep')}</button></span>
              : <button className="btn dng" onClick={() => setSure(true)}>{t('admin.profile_page.delete_role')}</button>) : <span className="help">{cur?.people ? t('admin.profile_page.move_people_first', { people: cur.people }) : ''}</span>}
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {sel === 'new' && <button className="btn" onClick={() => setSel('')}>{t('admin.profile_page.cancel')}</button>}
              <button className="btn pri" disabled={save.isPending} onClick={() => { if (name.trim().length < 3) { setErr({ name: t('admin.profile_page.name_the_role') }); shake.hit(); } else save.mutate(); }}>{save.isPending ? t('admin.profile_page.saving') : t('admin.profile_page.save_role')}</button>
            </span>
          </div>
        )}
      </Card>
    </div>
  </>;
}

/** Everything the school has, in the import templates: what it would take to another system. Its data is its own. */
function YourData({ say }: { say: (m: string, tone?: 'bad') => void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const b = await app.api.movingIn.exportAll();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${app.slug}-export.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      say(t('admin.profile_page.your_export_is_downloading'));
    } catch (e) { say((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Card title={t('admin.profile_page.everything_to_take_with_you')}>
      <p className="help" style={{ marginTop: 0 }}>{t('admin.profile_page.a_zip_with_one_sheet')}</p>
      <button className="btn" disabled={busy} onClick={() => void go()}>{busy ? t('admin.profile_page.preparing') : t('admin.profile_page.download_everything')}</button>
    </Card>
  );
}
