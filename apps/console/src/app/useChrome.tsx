import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { tx, CONSOLE_ROLE_INFO, type ConsoleRole } from '@tangent/contracts';
import { Dialog, Dock, Field, MoreSheet, Presence, SearchDialog, Sidebar, WorkspaceHeader, tintFor, useShake, useTheme, type DockTab, type PaletteHit, Icon, t as tr } from '@tangent/web-ui';
import { PAGES, SCHOOL_TABS, activeNav, consoleNav, shortcutTargets } from './nav';
import { HttpError } from '@tangent/api-client';
import { useApp } from './context';
import { path } from './base';

const COLLAPSE_KEY = 'tangent.console.menu.collapsed';

/** What every console page shares: theme, menu, shortcuts and the search box. Called once, by the signed-in layout. */
export function useChrome() {
  const { api, user, go, can, signOut } = useApp();
  const theme = useTheme();
  const active = activeNav(path(useRouterState({ select: (s) => s.location.pathname })));
  const about = useQuery({ queryKey: ['about'], queryFn: api.about, staleTime: Infinity, retry: false });
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => api.schools(), staleTime: 20_000 });
  const actions = useQuery({ queryKey: ['actions'], queryFn: api.actions.list, staleTime: 20_000 });
  const requests = useQuery({ queryKey: ['change-requests', 'open'], queryFn: () => api.changeRequests.list('open'), staleTime: 20_000 });
  const policy = useQuery({ queryKey: ['policy'], queryFn: api.policy.get, staleTime: 60_000 });
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [account, setAccount] = useState(false);
  const [q, setQ] = useState('');
  // Search also finds the team and connections: loaded only once the box is open.
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list, staleTime: 60_000, enabled: open });
  const links = useQuery({ queryKey: ['integrations'], queryFn: api.integrations.view, staleTime: 60_000, enabled: open && can('integrations.read') });

  const pending = (actions.data ?? []).filter((a) => a.status === 'pending_approval').length;
  const onboarding = (schools.data ?? []).filter((s) => s.status === 'onboarding').length;
  const asked = (requests.data ?? []).length;
  const groups = useMemo(() => consoleNav(can, { onboarding, approvals: pending, requests: asked }), [can, onboarding, pending, asked]);
  const targets = useMemo(() => shortcutTargets(groups), [groups]);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    // "Search" on the not-found page lands here with ?search=1.
    const u = new URL(window.location.href);
    if (!u.searchParams.has('search')) return;
    setOpen(true);
    u.searchParams.delete('search');
    window.history.replaceState(window.history.state, '', u);
  }, []);

  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); return; }
      if (e.key === 'Escape') { setOpen(false); setMore(false); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setOpen(true); return; }
      if (Date.now() - armed < 1200) {
        const to = targets.get(e.key.toLowerCase());
        armed = 0;
        if (to) { e.preventDefault(); goRef.current(path(to)); }
      } else if (e.key.toLowerCase() === 'g') armed = Date.now();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targets]);

  const hits = useMemo<PaletteHit[]>(() => {
    const needle = q.trim().toLowerCase();
    const has = (...v: string[]) => v.some((x) => x.toLowerCase().includes(needle));
    const shown = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
    // Pages and their tabs ("Releases · Database changes"); the shortcut is listed beside each page, which is how it is learnt.
    const pages = PAGES.filter((p) => shown.has(p.id)).flatMap((p) => [
      { group: tr('console.use_chrome.go_to'), title: p.label, hint: '', href: p.to, keys: p.keys },
      ...(p.tabs ?? []).slice(1).filter((t) => !t.needs || can(t.needs)).map((t) => ({ group: tr('console.use_chrome.go_to'), title: `${p.label} · ${t.label}`, hint: '', href: `${p.to}/${t.key}` })),
    ]).filter((h) => !needle || has(h.title));
    if (!needle) return pages.filter((h) => 'keys' in h).slice(0, 12);
    // "greenfield roles" opens that school's Roles tab.
    const words = needle.split(/\s+/);
    const schoolHits = (schools.data ?? []).flatMap((s) => {
      const tab = SCHOOL_TABS.find((t) => words.length > 1 && t.label.toLowerCase().startsWith(words[words.length - 1]!) && (!t.needs || can(t.needs)));
      const name = tab ? words.slice(0, -1).join(' ') : needle;
      if (!s.name.toLowerCase().includes(name) && !s.slug.includes(name)) return [];
      return [tab ? { group: tr('console.use_chrome.schools'), title: `${s.name} · ${tab.label}`, hint: s.slug, href: `/schools/${s.id}/${tab.key}` } : { group: tr('console.use_chrome.schools'), title: s.name, hint: tr('console.use_chrome.cell', { slug: s.slug, cell: s.cell }), href: `/schools/${s.id}` }];
    }).slice(0, 6);
    const people = (team.data ?? []).filter((p) => has(p.name, p.email)).slice(0, 4).map((p) => ({ group: tr('console.use_chrome.team'), title: p.name, hint: p.email, href: '/team' }));
    const conns = (links.data?.connections ?? []).filter((c) => has(c.name, c.provider)).slice(0, 4).map((c) => ({ group: tr('console.use_chrome.connections'), title: c.name, hint: c.provider, href: '/integrations' }));
    const reqs = (requests.data ?? []).filter((r) => has(r.schoolName, r.area, r.message)).slice(0, 4).map((r) => ({ group: tr('console.use_chrome.open_requests'), title: `${r.schoolName}: ${r.area}`, hint: r.message.slice(0, 60), href: '/requests' }));
    return [...schoolHits, ...pages, ...reqs, ...people, ...conns].slice(0, 16);
  }, [q, groups, can, schools.data, team.data, links.data, requests.data]);

  const close = () => { setOpen(false); setQ(''); };
  const t = tintFor(user.name);
  const env = about.data?.environment ?? '';

  // On a phone: what is opened from a phone, the rest under More.
  const dockTabs: DockTab[] = [
    { id: 'fleet', label: tr('console.use_chrome.fleet'), icon: 'fleet', onPress: () => goRef.current('/') },
    { id: 'appr', label: tr('console.use_chrome.approvals'), icon: 'approvals', onPress: () => goRef.current('/approvals') },
    { id: 'health', label: tr('console.use_chrome.health'), icon: 'health', onPress: () => goRef.current('/health') },
    { id: 'more', label: tr('console.use_chrome.more'), icon: 'more', onPress: () => setMore(true) },
  ];
  const dockActive = ['fleet', 'appr', 'health'].includes(active) ? active : 'more';
  const aside: ReactNode = (
    <>
    <Sidebar
      label={tr('console.use_chrome.console_menu')} collapsed={collapsed} groups={groups} active={active}
      onNavigate={(href) => goRef.current(path(href))}
      header={<WorkspaceHeader env={env} envClass={env === 'Production' ? '' : 'safe'} collapsed={collapsed} onToggle={() => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ } return !c; })} />}
      me={{ initials: user.initials, name: user.name, role: roleLabel(user.roles[0]), bg: t.bg, fg: t.fg }}
      meMenu={[{ label: tr('console.use_chrome.my_account'), onPress: () => setAccount(true) }, { label: theme.theme === 'dark' ? tr('console.use_chrome.switch_to_light') : tr('console.use_chrome.switch_to_dark'), onPress: theme.toggle }, { label: tr('console.use_chrome.sign_out'), onPress: signOut }]}
    />
    <Dock tabs={dockTabs} active={dockActive} />
    </>
  );

  const overlays: ReactNode = (
    <>
    <Presence>{open && <SearchDialog hits={hits} query={q} onQuery={setQ} onPick={(h) => { close(); goRef.current(path(h.href)); }} onClose={close} placeholder={tr('console.use_chrome.find_a_school_a_page')} empty={tr('console.use_chrome.no_matches_for_try_a', { q })} />}</Presence>
    <Presence>{account && <AccountDialog onClose={() => setAccount(false)} />}</Presence>
    {/* While changes are frozen every page says so, with the reason and where it is lifted. */}
    {policy.data?.freeze && (
      <div className="sbar" role="status" style={{ position: 'fixed' }}>
        {tr('console.use_chrome.changes_are_frozen')}{' '}{policy.data.freezeReason || tr('console.use_chrome.no_reason_given')}
        <button onClick={() => goRef.current('/settings/rules')}>{can('policy.write') ? tr('console.use_chrome.lift') : tr('console.use_chrome.why')}</button>
      </div>
    )}
    <Presence>{more && (
      <MoreSheet title={tr('console.use_chrome.menu')} onClose={() => setMore(false)}>
        {groups.map((g) => (
          <div key={g.name}>
            <div className="sl">{tx(g.name)}</div>
            {g.items.map((n) => (
              <a key={n.id} className={`nvm ${n.id === active ? 'on' : ''}`} href={n.href} onClick={(e) => { e.preventDefault(); setMore(false); goRef.current(path(n.href)); }}>
                <Icon name={n.icon} />{n.label}
              </a>
            ))}
          </div>
        ))}
        <button className="btn" style={{ width: '100%', marginTop: 12 }} onClick={() => { setMore(false); setAccount(true); }}>{tr('console.use_chrome.my_account')}</button>
        <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => { setMore(false); signOut(); }}>{tr('console.use_chrome.sign_out')}</button>
      </MoreSheet>
    )}</Presence>
    </>
  );

  return { themeCls: theme.cls, aside, overlays, openSearch: () => setOpen(true), schools, actions, pending };
}

export function roleLabel(role: string | undefined): string {
  return CONSOLE_ROLE_INFO[role as ConsoleRole]?.label ?? tr('console.use_chrome.team');
}

/** My account: my own password and authenticator. Anyone else's are changed under Team by a super admin. */
function AccountDialog({ onClose }: { onClose: () => void }) {
  const { api, user, signOut } = useApp();
  const shake = useShake();
  const [f, setF] = useState({ current: '', next: '', again: '', password: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const fail = (e: unknown) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); };
  const pass = useMutation({ mutationFn: () => api.changePassword({ current: f.current, next: f.next }), onSuccess: () => { setF({ ...f, current: '', next: '', again: '' }); setDone(tr('console.use_chrome.password_changed_your_other_sessions')); }, onError: fail });
  const totp = useMutation({ mutationFn: () => api.resetAuthenticator(f.password), onSuccess: () => { setDone(tr('console.use_chrome.done_sign_in_again_to')); setTimeout(signOut, 1800); }, onError: fail });
  const change = () => {
    const p: Record<string, string> = {};
    if (!f.current) p.current = tr('console.use_chrome.type_your_current_password');
    if (f.next.length < 10) p.next = tr('console.use_chrome.use_at_least_10_characters');
    else if (f.next !== f.again) p.again = tr('console.use_chrome.the_two_do_not_match');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else pass.mutate();
  };
  return (
    <Dialog title={tr('console.use_chrome.my_account')} tag={{ text: user.email, tone: 'v' }} onClose={onClose} width={520} shake={shake.cls}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>{tr('console.use_chrome.password')}</h3>
        <Field label={tr('console.use_chrome.current_password')} type="password" value={f.current} onChange={set('current')} error={err.current} autoComplete="current-password" />
        <div className="two">
          <Field label={tr('console.use_chrome.new_password')} type="password" value={f.next} onChange={set('next')} error={err.next} autoComplete="new-password" hint={tr('console.use_chrome.at_least_10_characters')} />
          <Field label={tr('console.use_chrome.new_password_again')} type="password" value={f.again} onChange={set('again')} error={err.again} autoComplete="new-password" />
        </div>
        <div><button className="btn pri" disabled={pass.isPending} onClick={change}>{pass.isPending ? tr('console.use_chrome.saving') : tr('console.use_chrome.change_password')}</button></div>
        <h3 style={{ margin: '12px 0 0' }}>{tr('console.use_chrome.authenticator')}</h3>
        <div className="help" style={{ marginTop: 0 }}>{tr('console.use_chrome.a_new_phone_drop_the')}</div>
        <Field label={tr('console.use_chrome.your_password')} type="password" value={f.password} onChange={set('password')} error={err.password} autoComplete="current-password" />
        <div><button className="btn" disabled={totp.isPending || !f.password} onClick={() => totp.mutate()}>{tr('console.use_chrome.set_up_a_new_authenticator')}</button></div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
        {done && <div className="help" role="status" style={{ color: 'var(--ok)' }}>{done}</div>}
      </div>
    </Dialog>
  );
}
