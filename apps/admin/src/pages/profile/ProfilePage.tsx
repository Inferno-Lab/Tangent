import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MODULES } from '@tangent/config-engine';
import { fmtNumber, PERMISSION_CATALOG, SETTINGS_META, SchoolSettingsSchema, type EffectiveConfig, type SettingMeta, type SettingsResponse } from '@tangent/contracts';
import { EmptyCard, Segmented, useToast, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page } from '../../app/Page';
import { SettingsEditor } from '../../app/SettingsView';
import { usePageTabs } from '../../app/tabs';
import { AskTangent } from './AskTangent';

/**
 * Who the school is and how it works: the school changes its own settings here (identity, the app, messages, privacy,
 * sign-in) and each module's on that module's Settings tab; what Tangent sets (the plan, the app's look, locks) shows
 * read-only, and "Ask Tangent" asks for the rest. Every value comes from the settings and the module definitions.
 */
const dflt = (k: string): unknown => (SchoolSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { data?: unknown } }>)[k]?.safeParse(undefined).data;
const AREA: Record<string, string> = { data: t('admin.profile_page.your_data'), identity: t('admin.profile_page.school_identity'), plan: t('admin.profile_page.plan_and_modules'), app: t('admin.profile_page.the_app'), roles: t('admin.profile_page.roles'), messages: t('admin.profile_page.messages'), privacy: t('admin.profile_page.privacy_notice'), security: t('admin.profile_page.sign_in_and_security') };

function show(m: SettingMeta, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return <span className="help">{t('admin.profile_page.not_set')}</span>;
  const opt = (x: string) => m.options?.find((o) => o[0] === x)?.[1] ?? x;
  switch (m.kind) {
    case 'bool': return v ? t('admin.profile_page.yes') : t('admin.profile_page.no');
    case 'enum': case 'language': return opt(String(v));
    case 'multi': case 'strings': return (v as string[]).map(opt).join(', ');
    case 'color': return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 7, background: String(v) }} />{String(v).toUpperCase()}</span>;
    case 'houses': return <span className="tgrow">{(v as { name: string; color: string }[]).map((h) => <span key={h.name} className="chip" style={{ background: h.color, color: 'var(--on-deep)' }}>{h.name}</span>)}</span>;
    case 'categories': return <span className="tgrow">{(v as { name: string; tone: string }[]).map((c) => <span key={c.name} className={`chip ${c.tone}`}>{c.name}</span>)}</span>;
    case 'gradingScale': return (v as { grade: string; minPct: number }[]).map((g) => t('admin.profile_page.from', { grade: g.grade, minPct: g.minPct })).join(' · ');
    case 'logo': return t('admin.profile_page.uploaded');
    case 'classes': return t('admin.profile_page.chosen', { length: (v as string[]).length });
    default: return typeof v === 'object' ? t('admin.profile_page.set_by_tangent') : String(v);
  }
}

function Rows({ doc, keys }: { doc: SettingsResponse; keys: string[] }) {
  return (
    <div>
      {keys.map((k) => {
        const m = SETTINGS_META[k as keyof typeof SETTINGS_META];
        return (
          <div key={k} className="kv" style={{ alignItems: 'flex-start', gap: 16 }}>
            <span style={{ minWidth: 0 }}>{m.label}{m.help && <small style={{ display: 'block', color: 'var(--ink3)', font: '400 12px/1.4 var(--fb)' }}>{m.help}</small>}</span>
            <b style={{ textAlign: 'right', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{show(m, doc.values[k] !== undefined ? doc.values[k] : dflt(k))}</b>
          </div>
        );
      })}
    </div>
  );
}
const editable = (...groups: string[]) => Object.entries(SETTINGS_META).filter(([, m]) => groups.includes(m.group)).map(([k]) => k);

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
            <SettingsEditor title={t('admin.profile_page.the_school')} keys={editable('School identity', 'Look')} say={say} />
            <Card title={t('admin.profile_page.addresses')}>
              <div className="kv"><span>{t('admin.profile_page.the_admin')}</span><b>{`${window.location.host}${app.base}`}</b></div>
              <div className="kv"><span>{t('admin.profile_page.school_code_families_type_it')}</span><b>{app.slug.toUpperCase()}</b></div>
            </Card>
          </>}
          {tab === 'security' && <SettingsEditor title={t('admin.profile_page.sign_in_and_security')} keys={editable('Sign-in and security')} say={say} />}
          {tab === 'plan' && <Plan doc={d} cfg={c} />}
          {tab === 'app' && <SettingsEditor title={t('admin.profile_page.the_app')} keys={editable('The app')} say={say} />}
          {tab === 'roles' && <Roles cfg={c} />}
          {tab === 'messages' && <><Channels /><SettingsEditor title={t('admin.profile_page.messages')} keys={editable('Messaging')} say={say} /></>}
          {tab === 'data' && <YourData say={say} />}
          {tab === 'privacy' && <SettingsEditor title={t('admin.profile_page.privacy_and_consent')} keys={editable('Privacy')} say={say} />}
        </div>
      )}
    </Page>
  );
}

function Plan({ doc, cfg }: { doc: SettingsResponse; cfg: EffectiveConfig }) {
  const u = doc.usage;
  const on = MODULES.filter((m) => m.core || cfg.modules.includes(m.key));
  const off = MODULES.filter((m) => !m.core && m.state !== 'planned' && !cfg.modules.includes(m.key));
  return <>
    <Card title={t('admin.profile_page.plan', { p0: u.plan.charAt(0).toUpperCase(), p1: u.plan.slice(1) })}>
      <div className="kv"><span>{t('admin.profile_page.students')}</span><b>{fmtNumber(u.students)}{u.studentLimit ? t('admin.profile_page.of', { fmtNumber: fmtNumber(u.studentLimit) }) : ''}</b></div>
      <div className="kv"><span>{t('admin.profile_page.staff')}</span><b>{fmtNumber(u.staff)}</b></div>
      <div className="kv"><span>{t('admin.profile_page.texts_this_month')}</span><b>{fmtNumber(u.smsUsed)} {t('admin.profile_page.of_2')}{' '}{fmtNumber(u.smsLimit)}</b></div>
    </Card>
    {on.map((m) => {
      const keys = m.settings.filter((k) => k in SETTINGS_META);
      const feats = m.features.filter((f) => f.state !== 'planned');
      return (
        <Card key={m.key} title={m.name} chip={<span className="chip g">{t('admin.profile_page.on')}</span>}>
          <p className="help" style={{ margin: '0 0 8px' }}>{m.blurb}</p>
          {feats.length > 0 && <div className="tgrow" style={{ marginBottom: 8 }}>{feats.map((f) => <span key={f.key} className={`chip ${cfg.features.includes(f.key) ? 'g' : ''}`} data-tip={cfg.features.includes(f.key) ? t('admin.profile_page.on') : t('admin.profile_page.not_in_your_plan')}>{f.name}</span>)}</div>}
          {keys.length > 0 && <Rows doc={doc} keys={keys} />}
        </Card>
      );
    })}
    {off.length > 0 && (
      <Card title={t('admin.profile_page.not_in_your_plan')}>
        {off.map((m) => <div key={m.key} className="kv" style={{ alignItems: 'flex-start' }}><span style={{ minWidth: 0 }}>{m.name}<small style={{ display: 'block', color: 'var(--ink3)' }}>{m.blurb}</small></span><b></b></div>)}
      </Card>
    )}
  </>;
}

function Roles({ cfg }: { cfg: EffectiveConfig }) {
  const app = useApp();
  const roles = useQuery({ queryKey: ['roles'], queryFn: app.api.roles.list });
  const [sel, setSel] = useState('');
  if (roles.isLoading) return <div className="skc" style={{ height: 240, borderRadius: 16 }} />;
  if (roles.isError) return <EmptyCard error title={t('admin.profile_page.roles')} chip={{ text: t('admin.profile_page.couldn_t_load'), tone: 'c' }} icon="lock" heading={t('admin.profile_page.you_can_t_see_roles')} body={(roles.error as Error).message} actions={<button className="btn pri" onClick={() => void roles.refetch()}>{t('admin.profile_page.try_again')}</button>} />;
  const list = roles.data ?? [];
  const cur = list.find((r) => r.id === sel) ?? list[0];
  if (!cur) return <EmptyCard title={t('admin.profile_page.roles')} chip={{ text: '0', tone: 'v' }} icon="lock" heading={t('admin.profile_page.no_roles_yet')} body={t('admin.profile_page.tangent_makes_the_school_s')} />;
  const has = { modules: cfg.modules, features: cfg.features };
  const allowed = PERMISSION_CATALOG.filter((p) => cur.permissions.includes(p.key) && (has.modules.length === 0 || true));
  const areas = [...new Set(allowed.map((p) => p.area))];
  return <>
    <Segmented label={t('admin.profile_page.roles')} value={cur.id} onChange={setSel} options={list.map((r) => ({ value: r.id, label: r.name, count: r.people }))} style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }} />
    <Card title={cur.name} chip={<span className="chip">{cur.people} {cur.people === 1 ? 'person' : 'people'}</span>}>
      {cur.description && <p className="help" style={{ margin: '0 0 8px' }}>{cur.description}</p>}
      {areas.map((a) => (
        <div key={a} className="kv" style={{ alignItems: 'flex-start', gap: 16 }}>
          <span>{a}</span>
          <b style={{ textAlign: 'right' }}>{allowed.filter((p) => p.area === a).map((p) => p.label).join(' · ')}</b>
        </div>
      ))}
      {!areas.length && <p className="help">{t('admin.profile_page.this_role_can_sign_in')}</p>}
    </Card>
  </>;
}

const STATE = { on: { text: t('admin.profile_page.on'), tone: 'g' }, test: { text: t('admin.profile_page.test_mode'), tone: 'a' }, sandbox: { text: t('admin.profile_page.not_connected_yet'), tone: '' } } as const;

/** Which services carry the school's messages: Tangent connects them, so this is read-only. */
function Channels() {
  const app = useApp();
  const ch = useQuery({ queryKey: ['settings', 'channels'], queryFn: app.api.settings.channels });
  return (
    <Card title={t('admin.profile_page.how_messages_travel')}>
      {ch.isError ? <p className="help">{(ch.error as Error).message}</p> : (ch.data?.channels ?? []).map((x) => (
        <div key={x.capability} className="kv"><span style={{ minWidth: 0 }}>{x.label}<small style={{ display: 'block', color: 'var(--ink3)' }}>{x.provider ?? (x.state === 'sandbox' ? t('admin.profile_page.messages_go_to_tangent_s') : '')}</small></span><b><span className={`chip ${STATE[x.state].tone}`}>{STATE[x.state].text}</span></b></div>
      ))}
    </Card>
  );
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
