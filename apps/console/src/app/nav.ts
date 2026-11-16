import type { NavGroup, PageIcon } from '@tangent/web-ui';
import type { ConsolePermission } from '@tangent/contracts';
import { url } from './base';
import { t as tr } from '@tangent/web-ui';

export interface Tab { key: string; label: string; needs?: ConsolePermission }
interface Def { id: string; label: string; icon: PageIcon; keys: string; to: string; needs?: ConsolePermission; tabs?: Tab[] }

/** The console menu, grouped by what is being worked on (docs/product-map.md §4.1). A page's tabs each have an address. */
export const DEFS: { name: string; items: Def[] }[] = [
  { name: tr('console.nav.schools'), items: [
    { id: 'fleet', label: tr('console.nav.fleet'), icon: 'fleet', keys: 'G F', to: '/' },
    { id: 'onb', label: tr('console.nav.onboarding'), icon: 'onboarding', keys: 'G O', to: '/onboarding' },
    { id: 'req', label: tr('console.nav.requests'), icon: 'requests', keys: 'G Q', to: '/requests' },
    { id: 'sup', label: tr('console.nav.support_sessions'), icon: 'support', keys: 'G S', to: '/support', needs: 'support.access' },
  ] },
  { name: tr('console.nav.product'), items: [
    { id: 'mod', label: tr('console.nav.plans_and_modules'), icon: 'modules', keys: 'G M', to: '/modules', tabs: [{ key: 'schools', label: tr('console.nav.schools') }, { key: 'plans', label: tr('console.nav.plans') }, { key: 'planned', label: tr('console.nav.planned') }] },
    { id: 'bp', label: tr('console.nav.blueprints'), icon: 'blueprints', keys: 'G P', to: '/blueprints' },
    { id: 'flag', label: tr('console.nav.flags'), icon: 'flags', keys: 'G L', to: '/flags' },
  ] },
  { name: tr('console.nav.platform'), items: [
    { id: 'rel', label: tr('console.nav.releases'), icon: 'releases', keys: 'G R', to: '/releases', tabs: [{ key: 'releases', label: tr('console.nav.releases') }, { key: 'rules', label: tr('console.nav.rollout_rules') }, { key: 'database', label: tr('console.nav.database_changes') }] },
    { id: 'app', label: tr('console.nav.mobile_builds'), icon: 'builds', keys: 'G B', to: '/builds' },
    { id: 'int', label: tr('console.nav.integrations'), icon: 'integrations', keys: 'G I', to: '/integrations', needs: 'integrations.read', tabs: [
      { key: 'connections', label: tr('console.nav.connections') }, { key: 'routing', label: tr('console.nav.routing') }, { key: 'templates', label: tr('console.nav.approved_templates') },
      { key: 'activity', label: tr('console.nav.activity') }, { key: 'webhooks', label: tr('console.nav.webhooks') }, { key: 'inbox', label: tr('console.nav.test_inbox'), needs: 'sandbox.read' },
    ] },
    { id: 'cells', label: tr('console.nav.cells'), icon: 'cells', keys: 'G C', to: '/cells' },
    { id: 'health', label: tr('console.nav.health'), icon: 'health', keys: 'G H', to: '/health' },
  ] },
  { name: tr('console.nav.business'), items: [
    { id: 'bill', label: tr('console.nav.billing'), icon: 'billing', keys: 'G $', to: '/billing', needs: 'billing.read' },
    { id: 'comp', label: tr('console.nav.compliance'), icon: 'compliance', keys: 'G Y', to: '/compliance', tabs: [{ key: 'agreements', label: tr('console.nav.agreements') }, { key: 'breaches', label: tr('console.nav.breaches') }, { key: 'processors', label: tr('console.nav.sub_processors') }, { key: 'requests', label: tr('console.nav.data_requests') }] },
  ] },
  { name: tr('console.nav.console'), items: [
    { id: 'appr', label: tr('console.nav.approvals'), icon: 'approvals', keys: 'G A', to: '/approvals' },
    { id: 'team', label: tr('console.nav.team'), icon: 'team', keys: 'G T', to: '/team' },
    { id: 'set', label: tr('console.nav.console_settings'), icon: 'setup', keys: 'G ,', to: '/settings', tabs: [{ key: 'rules', label: tr('console.nav.rules_for_risky_changes') }] },
  ] },
];

/** A school's page: its tabs, each with its own address (`/schools/<id>/roles`), docs/product-map.md §4.2. */
export const SCHOOL_TABS: Tab[] = [
  { key: 'overview', label: tr('console.nav.overview') }, { key: 'plan', label: tr('console.nav.plan_and_modules') }, { key: 'configuration', label: tr('console.nav.configuration'), needs: 'schools.configure' },
  { key: 'roles', label: tr('console.nav.roles'), needs: 'schools.configure' }, { key: 'data', label: tr('console.nav.data') }, { key: 'messaging', label: tr('console.nav.messaging'), needs: 'integrations.read' },
  { key: 'technical', label: tr('console.nav.technical') }, { key: 'audit', label: tr('console.nav.audit'), needs: 'audit.read' },
];

/** Every page and its tabs, for the router: a page with tabs also answers at `<page>/<tab>`. */
export const PAGES = DEFS.flatMap((g) => g.items);

/** The tabs of a page this person may open. */
export function tabsOf(to: string, can: (p: string) => boolean): Tab[] {
  return (PAGES.find((p) => p.to === to)?.tabs ?? []).filter((t) => !t.needs || can(t.needs));
}

/** The console menu, limited to what the person's roles may open. Counts come from the data the shell already has. */
export function consoleNav(can: (p: string) => boolean, counts?: { onboarding?: number; approvals?: number; requests?: number }): NavGroup[] {
  return DEFS.map((g) => ({
    name: g.name,
    items: g.items.filter((i) => !i.needs || can(i.needs)).map((i) => ({
      id: i.id, label: i.label, icon: i.icon, keys: i.keys, href: url(i.to),
      count: i.id === 'onb' && counts?.onboarding ? String(counts.onboarding) : i.id === 'appr' && counts?.approvals ? String(counts.approvals) : i.id === 'req' && counts?.requests ? String(counts.requests) : undefined,
    })),
  })).filter((g) => g.items.length);
}

/** The menu item a path belongs to: its own, the closest one above it, and Fleet for a school's page. */
export function activeNav(path: string): string {
  if (path.startsWith('/schools')) return 'fleet';
  return PAGES.find((i) => i.to === path)?.id ?? PAGES.filter((i) => i.to !== '/' && path.startsWith(`${i.to}/`)).sort((a, b) => b.to.length - a.to.length)[0]?.id ?? '';
}

export function shortcutTargets(groups: NavGroup[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of groups) for (const i of g.items) m.set(i.keys.replace('G ', '').toLowerCase(), i.href);
  return m;
}
