import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookRow, LoanRow, ReservationRow } from '@tangent/contracts';
import { DateField, Dialog, Field, NumberField, Segmented, SelectField, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, SEARCH, StudentPick, dateLabel, problem, stamp } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { usePageTabs } from '../../app/tabs';
import { fmtMoney } from '@tangent/contracts';

type Tab = 'books' | 'loans' | 'waiting';

export function LibraryPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const { tab: at, tabs } = usePageTabs('/library');
  const tab = (at || 'books') as Tab;
  const [q, setQ] = useState('');
  const [dlg, setDlg] = useState<{ kind: 'book'; book: BookRow | null } | { kind: 'issue'; book: BookRow } | { kind: 'return'; loan: LoanRow } | null>(null);
  const view = useQuery({ queryKey: ['library'], queryFn: app.api.library.view });
  const canWrite = app.user.permissions.includes('library.write');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library'] });
  const done = (m: string) => { setDlg(null); refresh(); say(m); };
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null);
  const [lq, setLq] = useState('');
  const [page, setPage] = useState(1);
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => app.api.library.cancel(id, reason), onSuccess: () => { setCancelling(null); refresh(); say(tr('admin.library_page.reservation_cancelled_the_family_is')); }, onError: (e) => say((e as Error).message, 'bad') });
  const renew = useMutation({ mutationFn: app.api.library.renew, onSuccess: (l) => { refresh(); say(tr('admin.library_page.is_renewed_until', { title: l.title, dateLabel: dateLabel(l.dueOn) })); }, onError: (e) => say((e as Error).message, 'bad') });
  const v = view.data;
  const loans = (v?.loans ?? []).filter((l) => !lq.trim() || `${l.title} ${l.student} ${l.className}`.toLowerCase().includes(lq.trim().toLowerCase()));
  const books = useMemo(() => (v?.books ?? []).filter((b) => !q.trim() || `${b.title} ${b.author} ${b.isbn} ${b.category}`.toLowerCase().includes(q.trim().toLowerCase())), [v, q]);
  const overdue = (v?.loans ?? []).filter((l) => l.overdueDays > 0);
  return (
    <Page title={tr('admin.library_page.library')} sub={tr('admin.library_page.the_catalogue_who_has_which')} toast={toast} loading={view.isLoading && !v}
      error={view.isError && !v ? { message: (view.error as Error).message, retry: () => void view.refetch() } : null}
      tabs={tabs} actions={<>{canWrite && <AddBtn onClick={() => setDlg({ kind: 'book', book: null })}>{tr('admin.library_page.add_a_book')}</AddBtn>}</>}
      overlays={<>
        {dlg?.kind === 'book' && <BookDialog book={dlg.book} categories={[...new Set((v?.books ?? []).map((b) => b.category).filter(Boolean))].sort()} onClose={() => setDlg(null)} onDone={done} />}
        {dlg?.kind === 'issue' && <IssueDialog book={dlg.book} loanDays={v?.rules.loanDays ?? 14} onClose={() => setDlg(null)} onDone={done} />}
        {dlg?.kind === 'return' && <ReturnDialog loan={dlg.loan} onClose={() => setDlg(null)} onDone={done} />}
        {cancelling && <CancelDialog title={cancelling.title} busy={cancel.isPending} onClose={() => setCancelling(null)} onSend={(reason) => cancel.mutate({ id: cancelling.id, reason })} />}
      </>}>
      {v && (v.books.length === 0 && v.loans.length === 0 ? (
        tab === 'loans' || tab === 'waiting' ? <div><EmptyState scene={tab} onAction={canWrite ? () => setDlg({ kind: 'book', book: null }) : undefined} /></div>
        : <div><EmptyState scene="library" onAction={canWrite ? () => setDlg({ kind: 'book', book: null }) : undefined} /></div>
      ) : <>
        <section className="grid">
          {[
            { label: tr('admin.library_page.titles'), value: v.books.length, note: tr('admin.library_page.copies', { p0: v.books.reduce((n, b) => n + b.copies, 0) }), tone: 'v' },
            { label: tr('admin.library_page.out_on_loan'), value: v.loans.length, note: tr('admin.library_page.waiting_for_a_copy', { length: v.reservations.length }), tone: 'i' },
            { label: tr('admin.library_page.overdue'), value: overdue.length, note: overdue.length ? tr('admin.library_page.in_fines_so_far', { amount: fmtMoney(overdue.reduce((n, l) => n + l.fine, 0)) }) : tr('admin.library_page.fine_a_day', { amount: fmtMoney(v.rules.finePerDay) }), tone: overdue.length ? 'a' : 'g' },
          ].map((t, i) => (
            <div key={t.label} className={`tile t-${t.tone} s4 rise`} style={{ '--d': `${i * 0.05}s` } as React.CSSProperties}>
              <span className="lbl">{t.label}</span>
              <div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{t.value}</div>
              <div style={{ opacity: 0.75, font: '600 13px var(--fb)' }}>{t.note}</div>
            </div>
          ))}
        </section>
        {tab === 'books' && v.books.length > 0 && <div className="rise" style={{ maxWidth: 360 }}><Field label={tr('admin.library_page.search_the_catalogue')} value={q} onChange={(x) => { setQ(x); setPage(1); }} icon={SEARCH} placeholder={tr('admin.library_page.title_author_or_isbn')} /></div>}
        {tab === 'loans' && v.loans.length > 0 && <div className="rise" style={{ maxWidth: 360 }}><Field label={tr('admin.library_page.search_loans')} value={lq} onChange={setLq} icon={SEARCH} placeholder={tr('admin.library_page.book_or_borrower')} /></div>}
        {tab === 'books' && (
          <Card style={{ padding: 0 }}>
            {!books.length ? <div style={{ padding: 20 }}>{q.trim()
              ? <EmptyNote icon="search" title={tr('admin.library_page.no_book_matches', { p0: q.trim() })} body={tr('admin.library_page.search_by_title_author_or')} />
              : <EmptyNote icon="library" title={tr('admin.library_page.no_books_in_the_catalogue')} body={tr('admin.library_page.books_on_loan_from_the')}
                  action={canWrite ? <button className="btn sm" onClick={() => setDlg({ kind: 'book', book: null })}>{tr('admin.library_page.add_a_book')}</button> : undefined} />}</div> : (
              <div className="tbl scroll-x"><div style={{ minWidth: 680 }} className="lscroll">
                <div className="grd th" style={{ '--cols': 'minmax(0,2.4fr) minmax(0,1fr) 90px 110px 170px' } as React.CSSProperties}><span>{tr('admin.library_page.book')}</span><span>{tr('admin.library_page.category')}</span><span>{tr('admin.library_page.shelf')}</span><span>{tr('admin.library_page.on_the_shelf')}</span><span></span></div>
                {books.slice((page - 1) * 50, page * 50).map((b) => (
                  <div key={b.id} className="grd rw" style={{ '--cols': 'minmax(0,2.4fr) minmax(0,1fr) 90px 110px 170px', height: 'auto', minHeight: 56, padding: '8px 20px' } as React.CSSProperties}>
                    <span style={{ minWidth: 0 }}><b style={{ font: '700 14px/1.3 var(--fb)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={b.title}>{b.title}</b><small className="help">{b.author || tr('admin.library_page.author_not_given')}{b.isbn ? ` · ${b.isbn}` : ''}</small></span>
                    <span className="help" style={{ margin: 0 }}>{b.category}</span>
                    <span className="help" style={{ margin: 0 }}>{b.shelf || '–'}</span>
                    <span><span className={`chip ${b.copies - b.out > 0 ? 'g' : 'a'}`}>{b.copies - b.out} {tr('admin.library_page.of')}{' '}{b.copies}</span>{b.waiting > 0 && <span className="chip v" style={{ marginInlineStart: 4 }} data-tip={tr('admin.library_page.families_waiting')}>{b.waiting} {tr('admin.library_page.waiting')}</span>}</span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {canWrite && <button className="btn sm" disabled={b.copies - b.out <= 0} onClick={() => setDlg({ kind: 'issue', book: b })}>{tr('admin.library_page.issue')}</button>}
                      {canWrite && <button className="btn sm" onClick={() => setDlg({ kind: 'book', book: b })}>{tr('admin.library_page.edit')}</button>}
                    </span>
                  </div>
                ))}
              </div></div>
            )}
            {books.length > 50 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <span className="help">{(page - 1) * 50 + 1}–{Math.min(page * 50, books.length)} {tr('admin.library_page.of')}{' '}{books.length} {tr('admin.library_page.titles_2')}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('admin.library_page.previous')}</button><button className="btn sm" disabled={page * 50 >= books.length} onClick={() => setPage(page + 1)}>{tr('admin.library_page.next')}</button></span>
              </div>
            )}
          </Card>
        )}
        {tab === 'loans' && (
          <Card style={{ padding: 0 }}>
            {!v.loans.length ? <div style={{ padding: 20 }}><EmptyNote icon="library" title={tr('admin.library_page.no_book_is_out')} body={tr('admin.library_page.books_issued_from_the_catalogue')} /></div> : (
              <div className="tbl scroll-x"><div style={{ minWidth: 660 }} className="lscroll">
                <div className="grd th" style={{ '--cols': 'minmax(0,2fr) minmax(0,1.4fr) 110px 150px 190px' } as React.CSSProperties}><span>{tr('admin.library_page.book')}</span><span>{tr('admin.library_page.borrower')}</span><span>{tr('admin.library_page.due')}</span><span>{tr('admin.library_page.status')}</span><span></span></div>
                {!loans.length && <div style={{ padding: '4px 20px 20px' }}><EmptyNote icon="search" title={tr('admin.library_page.no_loan_matches', { p0: lq.trim() })} body={tr('admin.library_page.search_by_the_book_or')} /></div>}
                {loans.map((l) => (
                  <div key={l.id} className="grd rw" style={{ '--cols': 'minmax(0,2fr) minmax(0,1.4fr) 110px 150px 190px', height: 'auto', minHeight: 56, padding: '8px 20px' } as React.CSSProperties}>
                    <b style={{ font: '700 14px/1.3 var(--fb)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={l.title}>{l.title}</b>
                    <span style={{ minWidth: 0 }}><b style={{ font: '600 13px var(--fb)' }}>{l.student}</b><small className="help" style={{ display: 'block' }}>{l.className}</small></span>
                    <span className="num">{dateLabel(l.dueOn)}</span>
                    <span>{l.overdueDays > 0 ? <span className="chip c" data-tip={tr('admin.library_page.days_late', { overdueDays: l.overdueDays })}>{tr('admin.library_page.late')}{' '}{fmtMoney(l.fine)}</span> : <span className="chip g">{tr('admin.library_page.on_time')}</span>}</span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>{canWrite && <><button className="btn sm" disabled={renew.isPending} onClick={() => renew.mutate(l.id)}>{tr('admin.library_page.renew')}</button><button className="btn sm" onClick={() => setDlg({ kind: 'return', loan: l })}>{tr('admin.library_page.take_back')}</button></>}</span>
                  </div>
                ))}
              </div></div>
            )}
          </Card>
        )}
        {tab === 'waiting' && (
          <Card style={{ padding: 0 }}>
            {!v.reservations.length ? <div style={{ padding: 20 }}><EmptyNote icon="waiting" title={tr('admin.library_page.nobody_is_waiting')} body={tr('admin.library_page.families_reserve_books_from_the')} /></div>
              : v.reservations.map((r) => (
                <div key={r.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 52, padding: '10px 20px', flexWrap: 'wrap' }}>
                  <span className={`chip ${r.status === 'ready' ? 'g' : 'v'}`}>{r.status === 'ready' ? tr('admin.library_page.ready_at_the_desk') : tr('admin.library_page.waiting_2')}</span>
                  <b style={{ flex: 1, minWidth: 160, font: '700 13px/1.35 var(--fb)' }}>{r.title}</b>
                  <span className="help" style={{ margin: 0 }}>{r.student} {tr('admin.library_page.since')}{' '}{stamp(r.createdAt)}</span>
                  {canWrite && <button className="btn sm" onClick={() => setCancelling(r)}>{tr('admin.library_page.cancel')}</button>}
                </div>
              ))}
          </Card>
        )}
      </>)}
    </Page>
  );
}

function BookDialog({ book, categories, onClose, onDone }: { book: BookRow | null; categories: string[]; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const [confirm, setConfirm] = useState(false);
  const [newCat, setNewCat] = useState(false);
  const [f, setF] = useState({ title: book?.title ?? '', author: book?.author ?? '', isbn: book?.isbn ?? '', category: book?.category ?? tr('admin.library_page.general'), shelf: book?.shelf ?? '', copies: String(book?.copies ?? 1) });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (x: string) => { setF((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const body = () => ({ title: f.title.trim(), author: f.author.trim(), isbn: f.isbn.trim(), category: f.category.trim() || tr('admin.library_page.general'), shelf: f.shelf.trim(), copies: Number(f.copies || 0) });
  const save = useMutation({ mutationFn: () => (book ? app.api.library.save(book.id, body()) : app.api.library.add(body())), onSuccess: (b) => onDone(`${b.title} ${book ? tr('admin.library_page.was_saved') : tr('admin.library_page.is_in_the_catalogue')}.`), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const del = useMutation({ mutationFn: () => app.api.library.remove(book!.id), onSuccess: () => onDone(tr('admin.library_page.was_taken_out_of_the', { title: book!.title })), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  return (
    <Dialog title={book ? tr('admin.library_page.edit_book') : tr('admin.library_page.add_a_book')} onClose={onClose} width={520} shake={shake.cls}>
      <div className="stack">
        <Field label={tr('admin.library_page.title')} value={f.title} onChange={set('title')} error={err.title} placeholder={tr('admin.library_page.wings_of_fire')} />
        <div className="two"><Field label={tr('admin.library_page.author')} value={f.author} onChange={set('author')} placeholder={tr('admin.library_page.a_p_j_abdul_kalam')} /><Field label="ISBN" value={f.isbn} onChange={set('isbn')} placeholder="9788173711466" /></div>
        {/* Categories come from those already in use, so "Fiction" and "fiction" stay one; a new one is added on purpose. */}
        <div className="two">
          {newCat || !categories.length
            ? <Field label={tr('admin.library_page.new_category')} value={f.category} onChange={set('category')} placeholder={tr('admin.library_page.biography')} hint={categories.length ? undefined : tr('admin.library_page.the_first_category_of_the')} />
            : <SelectField label={tr('admin.library_page.category')} value={f.category} onChange={(v) => (v === '__new' ? (setNewCat(true), set('category')('')) : set('category')(v))} options={[...categories.map((c) => ({ value: c, label: c })), { value: '__new', label: tr('admin.library_page.add_a_category') }]} />}
          <Field label={tr('admin.library_page.shelf')} value={f.shelf} onChange={set('shelf')} placeholder="B-3" />
        </div>
        <NumberField label={tr('admin.library_page.copies_2')} value={f.copies} onChange={set('copies')} min={0} max={500} error={err.copies} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {book && (confirm
          ? <span style={{ marginInlineEnd: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}><span className="help">{book.out ? tr('admin.library_page.out_take_them_back_first', { out: book.out }) : tr('admin.library_page.take_it_out_of_the')}</span>{!book.out && <button className="btn sm dngf" disabled={del.isPending} onClick={() => del.mutate()}>{tr('admin.library_page.yes_remove')}</button>}<button className="btn sm" onClick={() => setConfirm(false)}>{tr('admin.library_page.keep')}</button></span>
          : <button className="btn dng" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirm(true)}>{tr('admin.library_page.remove_from_catalogue')}</button>)}
        <button className="btn" onClick={onClose}>{tr('admin.library_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>{save.isPending ? tr('admin.library_page.saving') : book ? tr('admin.library_page.save') : tr('admin.library_page.add_book')}</button>
      </div>
    </Dialog>
  );
}

function IssueDialog({ book, loanDays, onClose, onDone }: { book: BookRow; loanDays: number; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const [to, setTo] = useState<'student' | 'staff'>('student');
  const [student, setStudent] = useState<{ id: string; name: string; className: string } | null>(null);
  const [staffId, setStaffId] = useState('');
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list(), enabled: to === 'staff' });
  const [due, setDue] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const issue = useMutation({ mutationFn: () => app.api.library.issue({ bookId: book.id, studentId: to === 'student' ? student!.id : null, staffUserId: to === 'staff' ? staffId : null, dueOn: due || undefined }),
    onSuccess: (l) => onDone(tr('admin.library_page.is_with_until', { title: book.title, student: l.student, dateLabel: dateLabel(l.dueOn) })), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  return (
    <Dialog title={tr('admin.library_page.issue_2', { title: book.title })} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <Segmented label={tr('admin.library_page.who_is_borrowing')} value={to} onChange={(v) => { setTo(v); setErr({}); }} options={[{ value: 'student', label: tr('admin.library_page.a_student') }, { value: 'staff', label: tr('admin.library_page.staff') }]} />
        {to === 'student'
          ? <StudentPick label={tr('admin.library_page.to')} value={student} onChange={(s) => { setStudent(s); setErr({}); }} error={err.studentId} />
          : <SelectField label={tr('admin.library_page.to')} value={staffId} onChange={setStaffId} error={err.staffUserId} options={[{ value: '', label: tr('admin.library_page.choose_a_member_of_staff') }, ...(staff.data ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))]} />}
        <DateField label={tr('admin.library_page.due_back_blank_in_days', { loanDays })} value={due} onChange={setDue} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{tr('admin.library_page.cancel')}</button>
        <button className="btn pri" disabled={issue.isPending || (to === 'student' ? !student : !staffId)} onClick={() => issue.mutate()}>{issue.isPending ? tr('admin.library_page.issuing') : tr('admin.library_page.issue')}</button>
      </div>
    </Dialog>
  );
}

/** Taking a book back: how it came back, a charge for a lost or damaged one, and what happens to the fine. */
function ReturnDialog({ loan, onClose, onDone }: { loan: LoanRow; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const { shell } = useShellChrome();
  const fees = !!shell?.modules.includes('fees') && !!loan.studentId;
  const [outcome, setOutcome] = useState<'returned' | 'lost' | 'damaged'>('returned');
  const [charge, setCharge] = useState('');
  const [fine, setFine] = useState<'bill' | 'waive' | 'paid'>(fees ? 'bill' : 'paid');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const owed = loan.fine + (outcome === 'returned' ? 0 : Number(charge || 0));
  const back = useMutation({ mutationFn: () => app.api.library.giveBack(loan.id, { outcome, charge: Number(charge || 0), fine, reason: reason.trim() }),
    onSuccess: (r) => onDone(`${loan.title} ${outcome === 'lost' ? tr('admin.library_page.is_marked_lost') : tr('admin.library_page.is_back')}.${r.fine ? (r.billed ? tr('admin.library_page.was_added_to_the_family', { amount: fmtMoney(r.fine) }) : fine === 'waive' ? tr('admin.library_page.the_was_waived', { amount: fmtMoney(r.fine) }) : tr('admin.library_page.paid_at_the_desk', { amount: fmtMoney(r.fine) })) : ''}`),
    onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const go = () => { if (owed > 0 && fine === 'waive' && reason.trim().length < 3) { setErr({ reason: tr('admin.library_page.say_why_the_fine_is') }); shake.hit(); } else back.mutate(); };
  return (
    <Dialog title={tr('admin.library_page.take_back_2', { title: loan.title })} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>{tr('admin.library_page.from')}{' '}{loan.student}, {loan.className}. {loan.overdueDays > 0 ? tr('admin.library_page.it_is_days_late_the', { overdueDays: loan.overdueDays, amount: fmtMoney(loan.fine) }) : tr('admin.library_page.it_is_on_time')}</p>
        <Segmented label={tr('admin.library_page.how_it_came_back')} value={outcome} onChange={(o) => { setOutcome(o); setErr({}); }} options={[{ value: 'returned', label: tr('admin.library_page.returned') }, { value: 'damaged', label: tr('admin.library_page.damaged') }, { value: 'lost', label: tr('admin.library_page.lost') }]} />
        {outcome !== 'returned' && <NumberField label={outcome === 'lost' ? tr('admin.library_page.what_it_costs_to_replace') : tr('admin.library_page.what_the_damage_costs')} value={charge} onChange={setCharge} min={0} max={100000} />}
        {outcome === 'lost' && <p className="help" style={{ margin: 0 }}>{tr('admin.library_page.one_copy_fewer_is_on')}</p>}
        {owed > 0 && <>
          <Segmented label={tr('admin.library_page.the_fine')} value={fine} onChange={(v) => { setFine(v); setErr({}); }} options={[...(fees ? [{ value: 'bill' as const, label: tr('admin.library_page.add_to_fees') }] : []), { value: 'paid', label: tr('admin.library_page.paid_at_the_desk_2') }, { value: 'waive', label: tr('admin.library_page.waive_it') }]} />
          {fine === 'waive' && <AreaField label={tr('admin.library_page.why')} value={reason} onChange={(v) => { setReason(v); setErr({}); }} error={err.reason} rows={2} maxLength={200} />}
          <p className="help" style={{ margin: 0 }}>{fmtMoney(owed)} {tr('admin.library_page.in_all')}{fine === 'bill' ? tr('admin.library_page.as_a_library_fee_due') : '.'}</p>
        </>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{tr('admin.library_page.cancel')}</button>
          <button className="btn pri" disabled={back.isPending} onClick={go}>{back.isPending ? tr('admin.library_page.saving') : outcome === 'lost' ? tr('admin.library_page.mark_lost') : tr('admin.library_page.take_back')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Cancels a family's reservation, saying why: the family is told. */
function CancelDialog({ title, onClose, onSend, busy }: { title: string; onClose: () => void; onSend: (reason: string) => void; busy: boolean }) { const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  return (
    <Dialog title={tr('admin.library_page.cancel_the_reservation_of', { title })} onClose={onClose} width={460}>
      <div className="stack">
        <AreaField label={tr('admin.library_page.why_the_family_is_told')} value={reason} onChange={(v) => { setReason(v); setErr(''); }} error={err} rows={2} maxLength={200} placeholder={tr('admin.library_page.the_book_was_lost')} />
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{tr('admin.library_page.keep_it')}</button>
          <button className="btn pri" disabled={busy} onClick={() => (reason.trim().length < 3 ? setErr(tr('admin.library_page.say_why')) : onSend(reason.trim()))}>{tr('admin.library_page.cancel_reservation')}</button>
        </div>
      </div>
    </Dialog>
  );
}
