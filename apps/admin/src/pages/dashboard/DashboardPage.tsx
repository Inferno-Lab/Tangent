import { useMemo, useState } from 'react';
import { dashboardPieces } from '@tangent/config-engine';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtNumber, fmtMoneyShort, fmtMoney, type ApprovalRow, type DashboardData } from '@tangent/contracts';
import { Checkbox, Dialog, EmptyCard, IC, type PageIcon, PageScope, TONES, rollDigits, tintFor, useIsPhone, useToast, EmptyState, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { useShellChrome } from '../../app/Layout';
import { TodayView } from './TodayView';
import { DashboardSkeleton } from './DashboardSkeleton';
import { PhoneDashboard } from '../phone/PhoneDashboard';

// Only ranges the dashboard can count truly: a day and a school week.
const RANGES: [string, number][] = [[tr('admin.dashboard_page.today'), 1], [tr('admin.dashboard_page.this_week'), 6]];
// Each chart needs its module and the person's right to see it (a teacher does not see fee totals).
const TABS: [string, 'attendance' | 'fees' | 'homework', string][] = [[tr('admin.dashboard_page.attendance'), 'attendance', 'attendance.read'], [tr('admin.dashboard_page.fees'), 'fees', 'fees.read'], [tr('admin.dashboard_page.homework'), 'homework', 'homework.read']];
const KIND_WORD: Record<string, [string, string]> = { leave: [tr('admin.dashboard_page.leave_request'), tr('admin.dashboard_page.leave_requests')], staff_leave: [tr('admin.dashboard_page.leave_request'), tr('admin.dashboard_page.leave_requests')], fee_waiver: [tr('admin.dashboard_page.fee_waiver'), tr('admin.dashboard_page.fee_waivers')], notice: ['notice', 'notices'], admission: ['admission', 'admissions'], photo: [tr('admin.dashboard_page.new_photo'), tr('admin.dashboard_page.new_photos')], receipt_cancel: [tr('admin.dashboard_page.receipt_to_cancel'), tr('admin.dashboard_page.receipts_to_cancel')] };
// What "Needs you" can hold. A kind with nothing waiting shows as a clear line, so a quiet day says so instead of leaving a gap.
const CLEAR: { kind: string; module?: string; perms: string[]; t: string }[] = [
  { kind: 'leave', perms: ['approvals.decide'], t: tr('admin.dashboard_page.no_leave_requests_waiting') },
  { kind: 'fee_waiver', module: 'fees', perms: ['approvals.decide', 'fees.waive'], t: tr('admin.dashboard_page.no_fee_waivers_to_decide') },
  { kind: 'notice', module: 'notices', perms: ['approvals.decide', 'notices.publish'], t: tr('admin.dashboard_page.no_notices_waiting_to_go') },
  { kind: 'attendance', module: 'attendance', perms: ['attendance.read'], t: tr('admin.dashboard_page.every_class_has_taken_the') },
];
/** A long list of classes ("6 A · 7 C · …") names the first five and counts the rest. */
export const fewNames = (list: string) => { const names = list.split(' · ');
  return names.length > 6 ? tr('admin.dashboard_page.and_more', { p0: names.slice(0, 5).join(' · '), p1: names.length - 5 }) : list;
};
const H = 236;
const UP = 'upRight';
const DOWN = 'downRight';

const money = (n: number) => fmtMoneyShort(n);
/** A round top for the chart so the gridlines fall on friendly numbers. */
function niceMax(v: number): number { const steps = [20000, 40000, 100000, 200000, 400000, 1000000, 2000000, 4000000, 10000000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000000) * 1000000;
}
const trend = (pct: number) => ({ cls: pct >= 0 ? 'up' : 'dn', icon: pct >= 0 ? UP : DOWN, text: `${Math.abs(pct)}%` });
const greeting = () => { const h = (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 330) / 60 % 24; return h < 12 ? tr('admin.dashboard_page.good_morning') : h < 17 ? tr('admin.dashboard_page.good_afternoon') : tr('admin.dashboard_page.good_evening'); };

/** A phone gets its own home screen; everything wider gets the dashboard. */
export function DashboardPage() { return useIsPhone() ? <PhoneDashboard /> : <DashboardDesktop />;
}

function DashboardDesktop() { const app = useApp();
  const chrome = useShellChrome();
  const qc = useQueryClient();
  const [range, setRange] = useState(1);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [widgets, setWidgets] = useState(false);
  // The widgets this person hid, kept with their account so the choice follows them to any computer.
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: app.api.prefs.get, staleTime: 5 * 60_000 });
  const hidden = (prefs.data?.['dashboard.widgets'] as string[] | undefined) ?? [];
  const setHide = (id: string, off: boolean) => { const n = off ? [...new Set([...hidden, id])] : hidden.filter((x) => x !== id);
    qc.setQueryData(['prefs'], { ...prefs.data, 'dashboard.widgets': n });
    void app.api.prefs.put('dashboard.widgets', n).catch(() => say(tr('admin.dashboard_page.your_choice_could_not_be'), 'bad'));
  };
  // The classes in this person's roll-call widget (up to six); none chosen keeps the school's choice.
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000, enabled: widgets });
  const rollMine = (prefs.data?.['dashboard.rollClasses'] as string[] | undefined) ?? [];
  const setRoll = (id: string, on: boolean) => {
    const n = on ? [...rollMine, id].slice(0, 6) : rollMine.filter((x) => x !== id);
    qc.setQueryData(['prefs'], { ...prefs.data, 'dashboard.rollClasses': n });
    void app.api.prefs.put('dashboard.rollClasses', n).then(() => qc.invalidateQueries({ queryKey: ['dashboard'] })).catch(() => say(tr('admin.dashboard_page.your_choice_could_not_be'), 'bad'));
  };
  const { toast, say, clear } = useToast();
  const days = RANGES[range]![1];

  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => app.api.dashboard(days), refetchInterval: 20_000, placeholderData: keepPreviousData });


  const decide = useMutation({ mutationFn: async (a: { n: ApprovalRow; decision: 'approve' | 'undo' }) => { if (a.n.kind === 'attendance') return app.api.attendance.remind();
      return app.api.approvals.decide(a.n.id, { decision: a.decision });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }) });

  const d: DashboardData | undefined = q.data;
  const v = useMemo(() => (d ? build(d) : null), [d, range, tab, rangeOpen, newOpen, done, toast, chrome.shell, hidden, widgets]);

  function build(d: DashboardData) { const may = (p: string) => app.user.permissions.includes(p as never);
    const has = (m: string) => d.modules.includes(m);
    // Widgets and the New menu come from the module definitions: what the school has and what this person may do.
    const pieces = dashboardPieces({ modules: d.modules, features: chrome.shell?.features ?? [] }, app.user.permissions);
    const widgetsOn = pieces.filter((p) => p.kind === 'widget');
    const tabsOn = TABS.filter((x) => has(x[1]) && may(x[2]));
    const T = tabsOn[tab] ?? tabsOn[0] ?? TABS[0]!;
    // The board has a slot for each of these; a slot whose widget the school or person lacks stays hidden.
    const off = ['rolls', 'fees', 'day'].filter((k) => !widgetsOn.some((w) => w.key === k));
    const kind = T[1];
    const pts = kind === 'attendance' ? d.charts.attendance.points : kind === 'fees' ? d.charts.fees.points : d.charts.homework.points;
    const values = pts.map((p) => ('pct' in p ? p.pct : p.amount));
    const goal = d.charts[kind].goal;
    const max = kind === 'fees' ? niceMax(Math.max(goal, ...values) * 1.1) : 100;
    const fmt = (x: number) => (kind === 'fees' ? money(x) : `${x}%`);
    const dense = pts.length > 8;
    const cols = pts.map((p, i) => { const x = values[i]!;
      const prev = kind === 'attendance' ? (p as { previousPct: number | null }).previousPct : null;
      return { n: dense ? (i % 3 === 0 || p.isToday ? String(Number(p.date.slice(8))) : '') : p.label,
        v: fmt(x), full: kind === 'attendance' ? `${p.date}` : (p as { full: string }).full ?? p.date, prev: prev !== null ? fmt(prev) : '',
        h: Math.max(6, (x / max) * H), gh: prev !== null ? Math.max(6, (prev / max) * H) : 0,
        c: 'var(--brand-line)', today: p.isToday ? 'today' : '' };
    });
    const grid = [0, 1, 2, 3, 4].map((g) => ({ b: 30 + (g / 4) * H, l: kind === 'fees' ? (g === 0 ? '0' : money((max / 4) * g)) : `${(max / 4) * g}%` }));
    // Requests to decide first, then reminders (a class not marked yet): two kinds of thing, never mixed in one order.
    const needs = [...d.needsYou].sort((a, b) => Number(a.kind === 'attendance') - Number(b.kind === 'attendance')).map((n) => { const tone = TONES[n.tone] ?? TONES.violet!;
      const isDone = !!done[n.id];
      return { t: n.title, s: n.kind === 'attendance' ? tr('admin.dashboard_page.reminder', { fewNames: fewNames(n.subtitle) }) : n.subtitle, tip: fewNames(n.subtitle) !== n.subtitle ? n.subtitle.split(' · ').join(', ') : undefined, ini: n.initials, bg: tone.bg, fg: tone.fg, a: n.action, open: !isDone, done: isDone ? 'done' : '',
        view: n.kind === 'attendance' ? () => app.go('/attendance') : () => app.go('/approvals'),
        act: () => { setDone((s) => ({ ...s, [n.id]: true }));
          decide.mutate({ n, decision: 'approve' });
          say(n.doneText, 'ok', n.id === 'att_reminder' ? undefined : { label: tr('admin.dashboard_page.undo'),
            onPress: () => { setDone((s) => ({ ...s, [n.id]: false })); clear(); if (n.kind !== 'attendance') decide.mutate({ n, decision: 'undo' }); } });
        } };
    });
    const left = needs.filter((n) => n.open).length;
    const allClear = CLEAR.filter((c) => (!c.module || has(c.module)) && c.perms.every(may) && !d.needsYou.some((n) => n.kind === c.kind));
    const me = tintFor(app.user.name);
    const t = d.timeline;
    return { ...chrome, goto: app.go, money, allClear,
      remind: () => void app.api.attendance.remind().then(() => say(tr('admin.dashboard_page.reminders_sent_to_the_class'))).catch((e: Error) => say(e.message, 'bad')),
      hidden: [...hidden, ...off], openWidgets: () => setWidgets(true),
      has: { attendance: has('attendance') && may('attendance.read'), fees: has('fees') && may('fees.read'), chat: has('chat') && may('messages.read') }, showChart: tabsOn.length > 0,
      approvalKinds: (() => { const by = new Map<string, number>();
        for (const n of d.needsYou) if (n.kind !== 'attendance') by.set(n.kind, (by.get(n.kind) ?? 0) + 1);
        return [...by].map(([k, c]) => `${c} ${(KIND_WORD[k] ?? [k, k])[c === 1 ? 0 : 1]}`).join(', ') || tr('admin.dashboard_page.nothing_waiting');
      })(),
      widgetsDialog: widgets && (
        <Dialog title={tr('admin.dashboard_page.dashboard_widgets')} onClose={() => setWidgets(false)} width={460}>
          <p className="help" style={{ margin: '0 0 12px' }}>{tr('admin.dashboard_page.choose_what_this_dashboard_shows')}</p>
          <div className="stack">
            {widgetsOn.map(({ key: id, label: name, blurb }) => (
              <div className="tgl" key={id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ flex: 1 }}><b style={{ font: '700 14px var(--fb)' }}>{name}</b><div className="help">{blurb}</div></div>
                <button className={`sw ${hidden.includes(id) ? '' : 'on'}`} role="switch" aria-checked={!hidden.includes(id)} aria-label={name} onClick={() => setHide(id, !hidden.includes(id))}></button>
              </div>
            ))}
          </div>
          {!!classes.data?.length && (
            <div className="fld" style={{ marginTop: 12 }}>
              <label>{tr('admin.dashboard_page.classes_in_roll_call')}</label>
              <div className="help" style={{ marginTop: 0 }}>{tr('admin.dashboard_page.up_to_six_classes')}</div>
              <div className="tgrow" style={{ maxHeight: 180, overflow: 'auto' }}>
                {classes.data.map((c) => <Checkbox key={c.id} label={c.name} checked={rollMine.includes(c.id)} disabled={!rollMine.includes(c.id) && rollMine.length >= 6} onChange={(on) => setRoll(c.id, on)} />)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn pri" onClick={() => setWidgets(false)}>{tr('admin.dashboard_page.done')}</button></div>
        </Dialog>
      ), me: { name: app.user.name, initials: app.user.initials, role: app.user.roleNames[0] ?? 'Staff', ...me }, schoolName: chrome.shell?.school.shortName ?? d.schoolName,
      greeting: greeting(), subtitle: has('attendance') && may('attendance.read') ? tr('admin.dashboard_page.of_classes_have_marked_attendance', { p0: d.term.name ? `${d.term.name} · ` : '', marked: d.subtitle.marked, classes: d.subtitle.classes }) : d.term.name,
      rangeOpen, rangeLabel: RANGES[range]![0], setRangeOpen: (o: boolean) => { setRangeOpen(o); setNewOpen(false); },
      ranges: RANGES.map((r, i) => ({ t: r[0], on: i === range, sel: i === range ? 'true' : 'false', d: 50 + i * 45, pick: () => { setRange(i); setRangeOpen(false); } })),
      newOpen, setNewOpen: (o: boolean) => { setNewOpen(o); setRangeOpen(false); },
      news: pieces.filter((p) => p.kind === 'new').map((n, i) => ({ t: n.label, ic: ((n.icon && n.icon in IC ? n.icon : 'dashboard') as PageIcon), k: n.keys ?? '', d: 50 + i * 45, go: () => { setNewOpen(false); app.go(n.to ?? '/'); } })),
      dayLine: d.day.isToday ? `${d.day.label} · ${d.day.clock}` : tr('admin.dashboard_page.last_school_day', { label: d.day.label }),
      kPresent: rollDigits(fmtNumber(d.present.value)), totalStudents: fmtNumber(d.present.total),
      presentTrend: trend(d.present.deltaPct), presentVersus: d.present.versus,
      kFees: rollDigits(fmtNumber(d.fees.collected)), feeMonth: d.fees.monthLabel, feePct: d.fees.pct, feeDue: fmtMoney(d.fees.due), feeTrend: trend(d.fees.deltaPct),
      overdueLine: tr('admin.dashboard_page.overdue', { overdueFamilies: d.fees.overdueFamilies }),
      kLeft: rollDigits(String(left)), avatars: d.approvals.avatars.map((a) => ({ initials: a.initials, ...(TONES[a.tone] ?? TONES.violet!) })), moreAvatars: Math.max(0, d.approvals.count - 3),
      chartTitle: kind === 'attendance' ? tr('admin.dashboard_page.attendance_last_school', { length: pts.length }) : kind === 'fees' ? tr('admin.dashboard_page.fees_collected_each_day') : tr('admin.dashboard_page.homework_handed_in_on_time'),
      chartAlt: tr('admin.dashboard_page.for_the_last_school_days', { p0: T[0], length: pts.length }),
      tabs: tabsOn.map((x, i) => ({ n: x[0], on: x === T ? 'on' : '', sel: x === T ? 'true' : 'false', pick: () => setTab(i) })),
      grid, goalB: 30 + (goal / max) * H, goalL: kind === 'fees' ? tr('admin.dashboard_page.daily_target', { money: money(goal) }) : tr('admin.dashboard_page.goal', { goal }), cols,
      chartEmpty: values.every((x) => x === 0),
      chartEmptyText: kind === 'attendance' ? tr('admin.dashboard_page.attendance_appears_here_after_the') : kind === 'fees' ? tr('admin.dashboard_page.payments_appear_here_as_fees') : tr('admin.dashboard_page.homework_appears_here_once_teachers'),
      needs, leftLabel: left ? tr('admin.dashboard_page.open', { left }) : tr('admin.dashboard_page.clear'), allDone: left === 0,
      toast,
      rolls: d.classRolls.map((r) => ({ n: r.name, pct: r.unmarked === r.size ? tr('admin.dashboard_page.not_yet') : `${r.pct}%`,
        segs: [{ k: 'p', n: r.present }, { k: 'l', n: r.late }, { k: 'a', n: r.absent }, { k: 'u', n: r.unmarked }].filter((s) => s.n > 0),
        aria: tr('admin.dashboard_page.present_late_absent', { name: r.name, present: r.present, late: r.late, absent: r.absent, p4: r.unmarked ? tr('admin.dashboard_page.n_not_marked', { n: r.unmarked }) : '' }) })),
      heads: d.feeHeads.map((h) => ({ n: h.label, pct: h.pct, fill: h.due ? Math.max(h.pct, 2) : 0, amt: h.due ? tr('admin.dashboard_page.of', { money: money(h.collected), money1: money(h.due) }) : tr('admin.dashboard_page.nothing_due') })),
      nowLabel: d.day.isToday ? tr('admin.dashboard_page.now', { clock: d.day.clock }) : tr('admin.dashboard_page.earlier'), prog: d.timelineProgress,
      events: t.map((e) => ({ t: e.time, n: e.title, s: e.subtitle, cls: e.state === 'done' ? 'past' : e.state === 'now' ? 'now' : '' })) };
  }

  if (q.isError && !d) { return (
      <PageScope page="dashboard">
        <main className="mn"><header className="hd"><div><h1>{tr('admin.dashboard_page.dashboard')}</h1></div></header>
          <div><EmptyCard error title={tr('admin.dashboard_page.dashboard')} chip={{ text: tr('admin.dashboard_page.couldn_t_load'), tone: 'c' }} icon="warning" heading={tr('admin.dashboard_page.that_didn_t_load')} body={(q.error as Error).message} actions={<button className="btn pri" onClick={() => void q.refetch()}>{tr('admin.dashboard_page.try_again')}</button>} /></div>
        </main>
      </PageScope>
    );
  }
  // A school with no students yet: the dashboard has nothing to show, so it says how to start.
  if (d && d.present.total === 0) { return (
      <PageScope page="dashboard">
        <main className="mn"><header className="hd"><div><h1>{tr('admin.dashboard_page.dashboard')}</h1></div></header>
          <EmptyState scene="dashboard" onAction={() => app.go('/year/classes')} onLink={() => app.go('/staff')} />
        </main>
      </PageScope>
    );
  }
  if (!v) return <DashboardSkeleton />;
  return <TodayView v={v} d={d!} />;
}
