import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MODULES } from '@tangent/config-engine';
import { fmtNumber, PERMISSION_CATALOG, SETTINGS_META, SchoolSettingsSchema, type EffectiveConfig, type SettingMeta, type SettingsResponse } from '@tangent/contracts';
import { EmptyCard, Segmented, useToast } from '@tangent/web-ui';
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
const AREA: Record<string, string> = { data: 'Your data', identity: 'School identity', plan: 'Plan and modules', app: 'The app', roles: 'Roles', messages: 'Messages', privacy: 'Privacy notice', security: 'Sign-in and security' };

function show(m: SettingMeta, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return <span className="help">Not set</span>;
  const opt = (x: string) => m.options?.find((o) => o[0] === x)?.[1] ?? x;
  switch (m.kind) {
    case 'bool': return v ? 'Yes' : 'No';
    case 'enum': case 'language': return opt(String(v));
    case 'multi': case 'strings': return (v as string[]).map(opt).join(', ');
    case 'color': return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 7, background: String(v) }} />{String(v).toUpperCase()}</span>;
    case 'houses': return <span className="tgrow">{(v as { name: string; color: string }[]).map((h) => <span key={h.name} className="chip" style={{ background: h.color, color: 'var(--on-deep)' }}>{h.name}</span>)}</span>;
    case 'categories': return <span className="tgrow">{(v as { name: string; tone: string }[]).map((c) => <span key={c.name} className={`chip ${c.tone}`}>{c.name}</span>)}</span>;
    case 'gradingScale': return (v as { grade: string; minPct: number }[]).map((g) => `${g.grade} from ${g.minPct}%`).join(' · ');
    case 'logo': return 'Uploaded';
    case 'classes': return `${(v as string[]).length} chosen`;
    default: return typeof v === 'object' ? 'Set by Tangent' : String(v);
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
    <Page title="School profile" sub="Who your school is and how it works. Change what is yours; ask Tangent for the rest." toast={toast} loading={doc.isLoading || cfg.isLoading}
      error={err ? { message: (err.error as Error).message, retry: () => void err.refetch() } : null}
      tabs={tabs} actions={<><button className="btn pri" onClick={() => setAsking(true)}>Ask Tangent to change this</button></>}
      overlays={asking && <AskTangent area={AREA[tab] ?? 'School profile'} onClose={() => setAsking(false)} onDone={() => { setAsking(false); say('Sent to Tangent. The answer shows when you ask again.'); }} />}>
      {d && c && (
        <div className="stack" style={{ gap: 16 }}>
          {tab === 'identity' && <>
            <SettingsEditor title="The school" keys={editable('School identity', 'Look')} say={say} />
            <Card title="Addresses">
              <div className="kv"><span>The admin</span><b>{`${window.location.host}${app.base}`}</b></div>
              <div className="kv"><span>School code (families type it in the app)</span><b>{app.slug.toUpperCase()}</b></div>
            </Card>
          </>}
          {tab === 'security' && <SettingsEditor title="Sign-in and security" keys={editable('Sign-in and security')} say={say} />}
          {tab === 'plan' && <Plan doc={d} cfg={c} />}
          {tab === 'app' && <SettingsEditor title="The app" keys={editable('The app')} say={say} />}
          {tab === 'roles' && <Roles cfg={c} />}
          {tab === 'messages' && <><Channels /><SettingsEditor title="Messages" keys={editable('Messaging')} say={say} /></>}
          {tab === 'data' && <YourData say={say} />}
          {tab === 'privacy' && <SettingsEditor title="Privacy and consent" keys={editable('Privacy')} say={say} />}
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
    <Card title={`${u.plan.charAt(0).toUpperCase()}${u.plan.slice(1)} plan`}>
      <div className="kv"><span>Students</span><b>{fmtNumber(u.students)}{u.studentLimit ? ` of ${fmtNumber(u.studentLimit)}` : ''}</b></div>
      <div className="kv"><span>Staff</span><b>{fmtNumber(u.staff)}</b></div>
      <div className="kv"><span>Texts this month</span><b>{fmtNumber(u.smsUsed)} of {fmtNumber(u.smsLimit)}</b></div>
    </Card>
    {on.map((m) => {
      const keys = m.settings.filter((k) => k in SETTINGS_META);
      const feats = m.features.filter((f) => f.state !== 'planned');
      return (
        <Card key={m.key} title={m.name} chip={<span className="chip g">On</span>}>
          <p className="help" style={{ margin: '0 0 8px' }}>{m.blurb}</p>
          {feats.length > 0 && <div className="tgrow" style={{ marginBottom: 8 }}>{feats.map((f) => <span key={f.key} className={`chip ${cfg.features.includes(f.key) ? 'g' : ''}`} data-tip={cfg.features.includes(f.key) ? 'On' : 'Not in your plan'}>{f.name}</span>)}</div>}
          {keys.length > 0 && <Rows doc={doc} keys={keys} />}
        </Card>
      );
    })}
    {off.length > 0 && (
      <Card title="Not in your plan">
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
  if (roles.isError) return <EmptyCard error title="Roles" chip={{ text: 'Couldn’t load', tone: 'c' }} icon="lock" heading="You can’t see roles" body={(roles.error as Error).message} actions={<button className="btn pri" onClick={() => void roles.refetch()}>Try again</button>} />;
  const list = roles.data ?? [];
  const cur = list.find((r) => r.id === sel) ?? list[0];
  if (!cur) return <EmptyCard title="Roles" chip={{ text: '0', tone: 'v' }} icon="lock" heading="No roles yet" body="Tangent makes the school’s roles when it sets the school up." />;
  const has = { modules: cfg.modules, features: cfg.features };
  const allowed = PERMISSION_CATALOG.filter((p) => cur.permissions.includes(p.key) && (has.modules.length === 0 || true));
  const areas = [...new Set(allowed.map((p) => p.area))];
  return <>
    <Segmented label="Roles" value={cur.id} onChange={setSel} options={list.map((r) => ({ value: r.id, label: r.name, count: r.people }))} style={{ alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }} />
    <Card title={cur.name} chip={<span className="chip">{cur.people} {cur.people === 1 ? 'person' : 'people'}</span>}>
      {cur.description && <p className="help" style={{ margin: '0 0 8px' }}>{cur.description}</p>}
      {areas.map((a) => (
        <div key={a} className="kv" style={{ alignItems: 'flex-start', gap: 16 }}>
          <span>{a}</span>
          <b style={{ textAlign: 'right' }}>{allowed.filter((p) => p.area === a).map((p) => p.label).join(' · ')}</b>
        </div>
      ))}
      {!areas.length && <p className="help">This role can sign in and see the dashboard only.</p>}
    </Card>
  </>;
}

const STATE = { on: { text: 'On', tone: 'g' }, test: { text: 'Test mode', tone: 'a' }, sandbox: { text: 'Not connected yet', tone: '' } } as const;

/** Which services carry the school's messages: Tangent connects them, so this is read-only. */
function Channels() {
  const app = useApp();
  const ch = useQuery({ queryKey: ['settings', 'channels'], queryFn: app.api.settings.channels });
  return (
    <Card title="How messages travel">
      {ch.isError ? <p className="help">{(ch.error as Error).message}</p> : (ch.data?.channels ?? []).map((x) => (
        <div key={x.capability} className="kv"><span style={{ minWidth: 0 }}>{x.label}<small style={{ display: 'block', color: 'var(--ink3)' }}>{x.provider ?? (x.state === 'sandbox' ? 'Messages go to Tangent’s test inbox for now.' : '')}</small></span><b><span className={`chip ${STATE[x.state].tone}`}>{STATE[x.state].text}</span></b></div>
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
      say('Your export is downloading.');
    } catch (e) { say((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Card title="Everything, to take with you">
      <p className="help" style={{ marginTop: 0 }}>A ZIP with one sheet for each kind of record, in the same columns Tangent imports. Your data is yours: this is what you would take to another system.</p>
      <button className="btn" disabled={busy} onClick={() => void go()}>{busy ? 'Preparing…' : 'Download everything'}</button>
    </Card>
  );
}
