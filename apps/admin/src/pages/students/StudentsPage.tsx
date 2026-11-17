import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtNumber, fmtMoney, fmtDate, dayLabel, schoolToday, listLabel, type ListItem, type StudentRow } from '@tangent/contracts';
import { EmptyCard, Menu, PageScope, Select, ToastSlot, rollDigits, tintFor, useToast, Icon, type IconName, currentLanguage, t as tr } from '@tangent/web-ui';
import type { StudentListQuery } from '@tangent/api-client';
import { useApp } from '../../app/context';
import { useShellChrome } from '../../app/Layout';
import { useSetting } from '../../app/kit';
import { AddStudentDialog, AssignFeeDialog, ImportDialog, MessageDialog } from './StudentDialogs';
import { StudentsView } from './students.view';
import { OnTheApp } from './OnTheApp';
import { StudentAccount } from './StudentAccount';
import { usePageTabs } from '../../app/tabs';
import { EditStudentDialog, GuardiansDialog, LeaveDialog } from './StudentRecord';
import { StudentFiles } from './StudentFiles';

const IC_OK = 'check';
const IC_CLK = 'time';
const IC_AL = 'warning';
const PILL_ICON = { cls: 'columns',
  house: 'star',
  fee: 'fees',
  add: 'plus' } as const;
const fmtFee = (s: StudentRow) => (s.feeStatus === 'paid' ? tr('admin.students_page.paid') : s.feeStatus === 'due' ? tr('admin.students_page.due', { fmtMoney: fmtMoney(s.amountDue) }) : tr('admin.students_page.overdue', { fmtMoney: fmtMoney(s.amountDue) }));
const tickClass = (st: string | null) => (st === 'late' ? 'l' : st === 'present' ? '' : st ? 'a' : 'h');

type Dialog = null | { kind: 'add' } | { kind: 'import' } | { kind: 'message'; ids: string[]; label: string } | { kind: 'fee'; ids: string[]; label: string } | { kind: 'edit' } | { kind: 'guardians' } | { kind: 'leave' };

function Pill({ id, open, setOpen, on, icon, children, menu }: { id: string; open: string; setOpen: (v: string) => void; on?: boolean; icon: IconName; children: ReactNode; menu: ReactNode }) { const btn = useRef<HTMLButtonElement>(null);
  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button ref={btn} className={`fp ${on ? 'on' : ''} ${id === 'add' ? 'add' : ''}`} aria-haspopup="menu" aria-expanded={open === id} onClick={() => setOpen(open === id ? '' : id)}>
        <Icon name={icon} />
        {children}
      </button>
      <Menu open={open === id} anchor={btn} onClose={() => setOpen('')}>{menu}</Menu>
    </div>
  );
}

export function StudentsPage() { const { tab, tabs } = usePageTabs('/students');
  if (tab === 'app') return <OnTheApp tabs={tabs} />;
  return <StudentList tabs={tabs} />;
}

function StudentList({ tabs }: { tabs: React.ReactNode }) { const app = useApp();
  const chrome = useShellChrome();
  const qc = useQueryClient();
  const [view, setView] = useState<number | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [house, setHouse] = useState('');
  const houses = useSetting<{ key: string; name: string }[]>('people.houses', []);
  const rels = useSetting<ListItem[]>('lists.relationships', []);
  const goal = useSetting<number>('attendance.goalPct', 95);
  const [fee, setFee] = useState<'' | 'paid' | 'due' | 'overdue'>('');
  const [att, setAtt] = useState<'' | 'low' | 'perfect'>('');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pop, setPop] = useState('');
  const { toast, say: show } = useToast();
  const [rev, setRev] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const say = (m: string) => { if (m) show(m); };

  const views = useQuery({ queryKey: ['student-views'], queryFn: app.api.students.views });
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const pinned = views.data?.pinned ?? null;
  const active = view ?? (pinned ? 1 : 0);

  // The page can be opened from the search box or the New menu with a purpose in the address.
  useEffect(() => { const p = new URLSearchParams(window.location.search);
    if (p.get('add')) setDialog({ kind: 'add' });
    if (p.get('import')) setDialog({ kind: 'import' });
    if (p.get('open')) setOpenId(p.get('open'));
    if (p.get('add') || p.get('import')) history.replaceState(null, '', window.location.pathname);
  }, []);

  const filter = useMemo<StudentListQuery>(() => ({ query: dq || undefined,
    classId: classId ?? (active === 1 ? pinned?.classId : undefined) ?? undefined,
    house: house || undefined,
    feeStatus: fee || (active === 2 ? 'overdue' : undefined),
    attendance: att || undefined,
    newThisYear: active === 3 || undefined,
    left: active === 4 || undefined,
    sort: 'name', dir, page, limit: per }), [dq, classId, active, pinned, house, fee, att, page, per, dir]);

  const list = useQuery({ queryKey: ['students', filter], queryFn: () => app.api.students.list(filter), placeholderData: keepPreviousData });
  const sum = useQuery({ queryKey: ['student-summary', filter.classId, filter.house], queryFn: () => app.api.students.summary({ classId: filter.classId, house: filter.house }), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const detail = useQuery({ queryKey: ['student', openId], queryFn: () => app.api.students.detail(openId!), enabled: !!openId });

  const refreshAll = () => void qc.invalidateQueries({ predicate: (qq) => ['students', 'student-summary', 'student-views', 'student', 'dashboard', 'shell', 'invoices'].includes(String(qq.queryKey[0])) });
  const closeDrawer = () => { setOpenId(null); setRev(null); };
  // The open student is in the address (?open=<id>), so a link, a reload or Back lands on the same record.
  useEffect(() => { const want = openId ? `?open=${encodeURIComponent(openId)}` : '';
    if (window.location.search !== want && (openId || window.location.search.startsWith('?open='))) history.replaceState(null, '', `${window.location.pathname}${want}`);
  }, [openId]);
  const done = (m: string, open?: string) => { setDialog(null); say(m); refreshAll(); if (open) setOpenId(open); };

  const download = async (ids?: string[]) => { try { const csv = await app.api.students.exportCsv(ids);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'students.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { say((e as Error).message); }
  };

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const allCount = views.data?.all ?? 0;
  const className = classes.data?.find((c) => c.id === filter.classId)?.name;
  const title = className ? tr('admin.students_page.class', { className }) : active === 2 ? tr('admin.students_page.fees_overdue') : active === 3 ? tr('admin.students_page.new_this_year') : active === 4 ? tr('admin.students_page.left_the_school') : tr('admin.students_page.all_students');
  const anyFilter = !!(dq || classId || house || fee || att || active !== 0);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const reset = () => { setQ(''); setClassId(null); setHouse(''); setFee(''); setAtt(''); setView(0); setPage(1); };

  // Fee and attendance columns, filters and actions show only when the school has those modules.
  const mods = chrome.shell?.modules ?? [];
  const has = { fees: mods.includes('fees'), attendance: mods.includes('attendance') };
  const allViews = [
    { n: tr('admin.students_page.all'), c: fmtNumber(allCount), cc: 'v' }, { n: pinned?.name ?? tr('admin.students_page.my_class'), c: String(pinned?.count ?? 0), cc: 'g' },
    { n: tr('admin.students_page.fees_overdue'), c: String(views.data?.overdue ?? 0), cc: 'c' }, { n: tr('admin.students_page.new_this_year'), c: String(views.data?.newThisYear ?? 0), cc: 'a' },
    { n: tr('admin.students_page.left_the_school'), c: String(views.data?.left ?? 0), cc: '' },
  ].map((x, i) => ({ ...x, i }));
  const shownViews = allViews.filter((x) => (has.fees || x.i !== 2) && (x.i !== 4 || (views.data?.left ?? 0) > 0));
  const vals = { ...chrome, has, tabs,
    // What the school calls its students (People → Settings): "Pupils" for "Pupil".
    heading: tr('admin.students_page.students'),
    subtitle: tr('admin.students_page.enrolled_across_sections', { fmtNumber: fmtNumber(allCount), p1: classes.data?.length ?? 0 }),
    openImport: () => setDialog({ kind: 'import' }), exportAll: () => void download(), openAdd: () => setDialog({ kind: 'add' }),
    views: shownViews.map((x) => ({ ...x, on: x.i === active ? 'on' : '', sel: x.i === active ? 'true' : 'false', pick: () => { setView(x.i); setClassId(null); setHouse(''); setFee(''); setAtt(''); setPage(1); } })),
    pills: (
      <>
        <Pill id="cls" open={pop} setOpen={setPop} on={!!className} icon={PILL_ICON.cls} menu={<>
          <button className={!className ? 'on' : ''} onClick={() => { setClassId(null); setView(0); setPop(''); setPage(1); }}>{tr('admin.students_page.all_classes')}</button><hr />
          {(classes.data ?? []).map((c) => <button key={c.id} className={c.id === filter.classId ? 'on' : ''} onClick={() => { setClassId(c.id); setPop(''); setPage(1); }}>{c.name}<small>{c.studentCount}</small></button>)}
        </>}>{tr('admin.students_page.class_2')}{' '}{className && <b>{className}</b>}</Pill>
        {houses.length > 0 && <Pill id="house" open={pop} setOpen={setPop} on={!!house} icon={PILL_ICON.house} menu={<>
          <button className={!house ? 'on' : ''} onClick={() => { setHouse(''); setPop(''); setPage(1); }}>{tr('admin.students_page.any_house')}</button><hr />
          {houses.map((h) => <button key={h.key} className={h.name === house ? 'on' : ''} onClick={() => { setHouse(h.name); setPop(''); setPage(1); }}>{h.name}</button>)}
        </>}>{tr('admin.students_page.house')}{' '}{house && <b>{house}</b>}</Pill>}
        {has.fees && <Pill id="fee" open={pop} setOpen={setPop} on={!!fee} icon={PILL_ICON.fee} menu={<>
          <button className={!fee ? 'on' : ''} onClick={() => { setFee(''); setPop(''); setPage(1); }}>{tr('admin.students_page.any_fee_state')}</button><hr />
          {(['paid', 'due', 'overdue'] as const).map((f) => <button key={f} className={f === fee ? 'on' : ''} onClick={() => { setFee(f); setPop(''); setPage(1); }}>{f === 'paid' ? tr('admin.students_page.paid_up') : f === 'due' ? tr('admin.students_page.due_soon') : tr('admin.students_page.overdue_2')}</button>)}
        </>}>{tr('admin.students_page.fees')}{' '}{fee && <b>{fee}</b>}</Pill>}
        {has.attendance && <Pill id="add" open={pop} setOpen={setPop} on={!!att} icon={PILL_ICON.add} menu={<>
          <button className={!att ? 'on' : ''} onClick={() => { setAtt(''); setPop(''); setPage(1); }}>{tr('admin.students_page.any_attendance')}</button><hr />
          <button className={att === 'low' ? 'on' : ''} onClick={() => { setAtt('low'); setPop(''); setPage(1); }}>{tr('admin.students_page.below_the')}{' '}{goal}{tr('admin.students_page.goal')}</button>
          <button className={att === 'perfect' ? 'on' : ''} onClick={() => { setAtt('perfect'); setPop(''); setPage(1); }}>{tr('admin.students_page.never_absent')}</button>
        </>}>{att ? <b>{att === 'low' ? tr('admin.students_page.below', { goal }) : tr('admin.students_page.never_absent')}</b> : tr('admin.students_page.attendance')}</Pill>}
      </>
    ),
    sum: (() => { const s = sum.data;
      return { inView: s ? fmtNumber(s.inView) : '–', total: fmtNumber(s?.total ?? 0), marked: s?.markedToday ?? 0, unmarked: fmtNumber(Math.max(0, (s?.inView ?? 0) - (s?.markedToday ?? 0))), presD: rollDigits(String(s?.presentToday ?? 0)),
        dayWord: s && s.dayLabel !== dayLabel(schoolToday()) ? tr('admin.students_page.on', { dayLabel: s.dayLabel }) : 'today', overdue: fmtMoney(s?.overdueAmount ?? 0),
        families: tr('admin.students_page.n_families', { n: s?.overdueFamilies ?? 0 }), avg: s?.avgAttendance ?? 0, avgNone: !s || s.total === 0,
        delta: `${(s?.avgDelta ?? 0) >= 0 ? '+' : ''}${s?.avgDelta ?? 0}%`, deltaCls: (s?.avgDelta ?? 0) >= 0 ? 'up' : 'dn' };
    })(),
    title, q, onQ: (e: { target: { value: string } }) => setQ(e.target.value),
    hasRows: rows.length > 0, noRows: !list.isLoading && rows.length === 0,
    allOn: allOnPage ? 'on' : '', allSel: allOnPage ? 'true' : sel.size ? 'mixed' : 'false',
    toggleAll: () => setSel((s) => { const n = new Set(s); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; }),
    rows: rows.map((r) => { const t = tintFor(r.name);
      return { n: r.name, ini: r.initials, bg: t.bg, fg: t.fg, adm: r.admissionNo, house: r.house ?? '', cls: r.className.replace(' ', ''), roll: r.rollNo, g: r.guardianName,
        att: r.attendancePct, tk: r.attendance10.map((a, k) => ({ k, c: tickClass(a) })),
        fcls: r.feeStatus === 'paid' ? 'paid' : r.feeStatus === 'due' ? 'due' : 'over', fic: r.feeStatus === 'paid' ? IC_OK : r.feeStatus === 'due' ? IC_CLK : IC_AL, fees: has.fees ? fmtFee(r) : '–', pp: '',
        sel: sel.has(r.id) ? 'sel' : '', cbOn: sel.has(r.id) ? 'on' : '', checked: sel.has(r.id) ? 'true' : 'false',
        toggle: (e: React.MouseEvent) => { e.stopPropagation(); toggle(r.id); }, open: () => setOpenId(r.id),
        key: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpenId(r.id); } };
    }),
    range: total ? tr('admin.students_page.of', { p0: (page - 1) * per + 1, p1: (page - 1) * per + rows.length, fmtNumber: fmtNumber(total) }) : '0',
    // The optional columns follow the school's modules; the grid keeps the same proportions either way.
    cols: ['44px', 'minmax(0,1.5fr)', '84px', 'minmax(0,1.1fr)', ...(has.attendance ? ['150px'] : []), ...(has.fees ? ['150px'] : [])].join(' '),
    dir, flipSort: () => { setDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); },
    perPage: <Select compact aria-label={tr('admin.students_page.rows_per_page')} value={String(per)} onChange={(x) => { setPer(Number(x)); setPage(1); }} options={[10, 25, 50].map((n) => ({ value: String(n), label: tr('admin.students_page.a_page', { n }) }))} />,
    page, hasNext: page * per < total, prev: () => setPage((p) => Math.max(1, p - 1)), next: () => setPage((p) => p + 1),
    emptySchool: allCount === 0 && !anyFilter && !views.isLoading,
    empty: allCount === 0 && !anyFilter
      ? { scene: 'register', title: tr('admin.students_page.no_students_yet'), body: tr('admin.students_page.add_your_first_student_or'), actLabel: tr('admin.students_page.import_from_excel'), act: () => setDialog({ kind: 'import' }), act2Label: tr('admin.students_page.add_one_student'), act2: () => setDialog({ kind: 'add' }) }
      : { scene: 'search-paper', title: dq ? tr('admin.students_page.no_one_matches', { dq }) : tr('admin.students_page.no_one_fits_these_filters'), body: dq ? tr('admin.students_page.try_a_first_name_or') : tr('admin.students_page.clear_a_filter_to_see'), actLabel: dq ? tr('admin.students_page.clear_search') : tr('admin.students_page.clear_filters'), act: reset, act2Label: '', act2: undefined },
    bulkOn: sel.size ? 'on' : '', count: sel.size, clear: () => setSel(new Set()),
    bulkMessage: () => setDialog({ kind: 'message', ids: [...sel], label: tr('admin.students_page.selected', { size: sel.size }) }),
    bulkFee: () => setDialog({ kind: 'fee', ids: [...sel], label: tr('admin.students_page.selected', { size: sel.size }) }),
    bulkExport: () => void download([...sel]),
    bulkInvite: () => void app.api.students.invite([...sel]).then((r) => say(r.sent ? tr('admin.students_page.invited_to_the_app', { sent: r.sent }) : tr('admin.students_page.no_family_has_a_phone'))).catch((e: Error) => say(e.message)),
    drOn: !!openId, close: closeDrawer, files: openId ? <><StudentFiles id={openId} say={(m) => say(m)} />{detail.data && <StudentAccount s={detail.data} say={(m) => say(m)} />}</> : null,
    canCollect: has.fees && app.user.permissions.includes('fees.collect') && !detail.data?.left,
    d: (() => { const s = detail.data;
      if (!s) return { n: '…', ini: '', bg: 'var(--s2)', fg: 'var(--ink3)', adm: '', roll: '', cls: '', house: null, route: null, fcls: 'due', fees: '', att: 0, exam: '–', examName: tr('admin.students_page.latest_test'), homework: '–', library: 0, show: { att: false, exam: false, hw: false, lib: false }, rollTitle: '', rollAria: '', gi: '', g: '', activity: [] as { label: string; sub: string; color: string }[] };
      const t = tintFor(s.name);
      const p = s.roll24.filter((x) => x === 'present').length, l = s.roll24.filter((x) => x === 'late').length, a = s.roll24.filter((x) => x === 'absent' || x === 'leave').length;
      return { n: s.name, ini: s.initials, bg: t.bg, fg: t.fg, adm: s.admissionNo, roll: s.rollNo, cls: s.className, house: s.house, route: s.routeName, fcls: s.feeStatus === 'paid' ? 'paid' : s.feeStatus === 'due' ? 'due' : 'over', fees: fmtFee(s), att: s.facts.attendancePct,
        exam: s.facts.exam ? `${s.facts.exam.grade} · ${s.facts.exam.pct}%` : '–', examName: s.facts.exam?.name ?? tr('admin.students_page.latest_test'),
        homework: s.facts.homework.total ? tr('admin.students_page.of_2', { onTime: s.facts.homework.onTime, total: s.facts.homework.total }) : '–', library: s.facts.libraryOut,
        show: { att: has.attendance, exam: mods.includes('exams'), hw: mods.includes('homework'), lib: mods.includes('library') },
        rollTitle: tr('admin.students_page.last_school_days', { length: s.roll24.length }), rollAria: tr('admin.students_page.present_late_absent', { p, l, a }), gi: s.guardianName.split(' ').map((w) => w[0]).slice(0, 2).join(''), g: s.guardianName,
        activity: s.recentActivity.map((e) => ({ label: e.label, sub: [e.sub, fmtDate(e.at, 'day')].filter(Boolean).join(' · '), color: e.tone === 'g' ? 'var(--ok)' : e.tone === 'v' ? 'var(--brand)' : 'var(--warn)' })) };
    })(),
    heat: (detail.data?.roll24 ?? []).map((x, i) => ({ c: x === 'late' ? 'l' : x === 'absent' ? 'a' : x === 'leave' ? 'h' : x === null ? 'h' : '', d: (0.2 + i * 0.02).toFixed(2) })),
    phone: rev ?? detail.data?.guardianPhone ?? '–', rlab: rev ? tr('admin.students_page.hide') : tr('admin.students_page.reveal'),
    reveal: async () => { if (rev) { setRev(null); return; } try { setRev((await app.api.students.reveal(openId!)).phone); } catch (e) { say((e as Error).message); } },
    messageOne: () => detail.data && setDialog({ kind: 'message', ids: [detail.data.id], label: detail.data.name }),
    // Fees are collected on Fees; this opens the payment there for this student.
    collect: () => openId && app.go(`/fees?collect=${openId}`),
    may: { edit: app.user.permissions.includes('students.write') && !detail.data?.left, leave: app.user.permissions.includes('year.manage') && !detail.data?.left },
    // A student who left: when and why, and (for someone who manages the year) bringing them back on the roll.
    left: detail.data?.left ? { line: tr('admin.students_page.left_on', { fmtDate: fmtDate(detail.data.left.on, 'dayYear'), p1: detail.data.left.reason ? `: ${detail.data.left.reason}` : '' }),
      back: app.user.permissions.includes('year.manage') ? () => void app.api.year.rejoin(detail.data!.id).then(() => { say(tr('admin.students_page.is_back_on_the_roll', { name: detail.data!.name })); refreshAll(); }).catch((e: Error) => say(e.message)) : null } : null,
    edit: () => setDialog({ kind: 'edit' }), editGuardians: () => setDialog({ kind: 'guardians' }), leave: () => setDialog({ kind: 'leave' }),
    guardians: (detail.data?.guardians ?? []).map((g) => ({ n: g.name, ini: g.name.split(' ').map((w) => w[0]).slice(0, 2).join(''), primary: g.isPrimary,
      line: [listLabel(rels, g.relation, currentLanguage()), g.isPrimary ? tr('admin.students_page.contacted_first') : '', g.canCollect ? tr('admin.students_page.may_collect_from_school') : tr('admin.students_page.may_not_collect'), g.hasApp ? tr('admin.students_page.uses_the_app') : ''].filter(Boolean).join(' · '),
      phone: g.isPrimary ? rev ?? g.phone : g.phone })),
    dialog: (
      <>
        {dialog?.kind === 'add' && <AddStudentDialog classes={classes.data ?? []} defaultClass={filter.classId} onClose={() => setDialog(null)} onDone={done} />}
        {dialog?.kind === 'import' && <ImportDialog onClose={() => setDialog(null)} onDone={done} />}
        {dialog?.kind === 'message' && <MessageDialog ids={dialog.ids} label={dialog.label} onClose={() => setDialog(null)} onDone={done} />}
        {dialog?.kind === 'fee' && <AssignFeeDialog ids={dialog.ids} label={dialog.label} onClose={() => setDialog(null)} onDone={(m) => { done(m); setSel(new Set()); }} />}
        {dialog?.kind === 'edit' && detail.data && <EditStudentDialog s={detail.data} classes={classes.data ?? []} onClose={() => setDialog(null)} onDone={done} />}
        {dialog?.kind === 'guardians' && detail.data && <GuardiansDialog s={detail.data} onClose={() => setDialog(null)} onDone={done} />}
        {dialog?.kind === 'leave' && detail.data && <LeaveDialog s={detail.data} onClose={() => setDialog(null)} onDone={(m) => { done(m); closeDrawer(); }} />}
      </>
    ) };

  if (list.isError && !list.data) { return (
      <PageScope page="students">
        <main className="mn"><header className="hd"><div><h1>{tr('admin.students_page.students')}</h1></div></header>
          <div><EmptyCard error title={tr('admin.students_page.students')} chip={{ text: tr('admin.students_page.couldn_t_load'), tone: 'c' }} icon="warning" heading={tr('admin.students_page.that_didn_t_load')} body={(list.error as Error).message} actions={<button className="btn pri" onClick={() => void list.refetch()}>{tr('admin.students_page.try_again')}</button>} /></div>
        </main>
      </PageScope>
    );
  }
  return (
    <>
      <StudentsView v={vals} />
      <ToastSlot toast={toast} />
    </>
  );
}

