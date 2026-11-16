import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtMoneyShort, type ApprovalRow } from '@tangent/contracts';
import { EmptyCard, PageScope, TONES, useToast, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { useShellChrome } from '../../app/Layout';
import { PhoneView } from './phone.view';
import { fewNames } from '../dashboard/DashboardPage';

const money = (n: number) => fmtMoneyShort(n);
const hello = () => { const h = ((new Date().getUTCHours() * 60 + new Date().getUTCMinutes() + 330) / 60) % 24; return h < 12 ? t('admin.phone_dashboard.good_morning') : h < 17 ? t('admin.phone_dashboard.good_afternoon') : t('admin.phone_dashboard.good_evening'); };

/** The phone's home: the day at a glance and what needs you, from the same numbers as the desktop dashboard. */
export function PhoneDashboard() { const app = useApp();
  const chrome = useShellChrome();
  const qc = useQueryClient();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const { toast, say } = useToast();
  const q = useQuery({ queryKey: ['dashboard', 6], queryFn: () => app.api.dashboard(6), refetchInterval: 20_000, placeholderData: keepPreviousData });
  const decide = useMutation({ mutationFn: async (a: { n: ApprovalRow; decision: 'approve' | 'undo' }) => (a.n.kind === 'attendance' ? app.api.attendance.remind() : app.api.approvals.decide(a.n.id, { decision: a.decision })),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['dashboard'] }) });
  const d = q.data;

  if (q.isError && !d) { return (
      <PageScope page="status">
        <main className="mn"><header className="hd"><div><h1>{t('admin.phone_dashboard.home')}</h1></div></header>
          <EmptyCard error title={t('admin.phone_dashboard.dashboard')} chip={{ text: t('admin.phone_dashboard.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('admin.phone_dashboard.that_didn_t_load')} body={(q.error as Error).message} actions={<button className="btn pri" onClick={() => void q.refetch()}>{t('admin.phone_dashboard.try_again')}</button>} />
        </main>
      </PageScope>
    );
  }
  if (!d) { return <PageScope page="phone"><div className="ph" aria-busy="true"><div className="top"><div className="skc" style={{ height: 44, flex: 1, borderRadius: 12 }} /></div><div className="sc"><div className="skc" style={{ height: 120, borderRadius: 24 }} /><div className="skc" style={{ height: 200, borderRadius: 24 }} /></div></div></PageScope>;
  }

  const items = d.needsYou.map((n) => { const tone = TONES[n.tone] ?? TONES.violet!;
    const isDone = !!done[n.id];
    return { id: n.id, i: n.initials, t: n.title, s: n.kind === 'attendance' ? fewNames(n.subtitle) : n.subtitle, bg: tone.bg, fg: tone.fg, cls: isDone ? 'gone' : '', l: isDone ? t('admin.phone_dashboard.undo') : n.action,
      go: () => { const next = !isDone;
        setDone((s) => ({ ...s, [n.id]: next }));
        decide.mutate({ n, decision: next ? 'approve' : 'undo' });
        if (next) say(n.doneText);
      } };
  });
  const left = items.filter((i) => !done[i.id]).length;
  const pts = d.charts.fees.points;
  const max = Math.max(1, ...pts.map((p) => p.amount));
  const peak = pts.reduce((m, p) => (p.amount > m ? p.amount : m), 0);
  const absent = Math.max(0, d.present.total - d.present.value);
  const v = { ...chrome, has: { fees: d.modules.includes('fees') && app.user.permissions.includes('fees.read'), attendance: d.modules.includes('attendance') && app.user.permissions.includes('attendance.read') }, logo: chrome.shell?.school.logoText ?? '', dayLine: d.day.isToday ? d.day.label : t('admin.phone_dashboard.last_school_day', { label: d.day.label }),
    greeting: `${hello()}, ${app.user.name.split(' ')[0]}`, pending: left, openApprovals: () => app.go('/approvals'), goto: app.go,
    present: d.present.value, total: d.present.total, feeMonth: d.fees.monthLabel, fees: money(d.fees.collected),
    headline: left ? t('admin.phone_dashboard.you', { left }) : t('admin.phone_dashboard.you_re_all_caught_up'),
    subline: d.modules.includes('attendance') ? t('admin.phone_dashboard.not_marked_present', { absent, examsLabel: d.term.examsLabel }) : d.term.examsLabel,
    left, items, clear: items.length === 0 || left === 0,
    barsTitle: t('admin.phone_dashboard.fees_collected_each_day'), barsEmpty: peak === 0, barsAlt: t('admin.phone_dashboard.fees_collected_over_the_last', { length: pts.length }),
    bars: pts.map((p) => ({ h: Math.max(8, (p.amount / max) * 100), n: p.label.slice(0, 1), c: p.amount === peak && peak > 0 ? 'var(--brand)' : 'color-mix(in srgb,var(--on-deep) 34%,transparent)' })),
    toast };
  return <PhoneView v={v} />;
}
