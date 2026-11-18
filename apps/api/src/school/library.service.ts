import { Injectable } from '@nestjs/common';
import { addDays, codeForms, listKey, schoolToday, type ListItem, type LibraryMember, type LibraryTypeRule, type BookInput, type BookRow, type GiveBack, type IssueInput, type LibraryView, type LoanRow, type ReservationRow, tx } from '@tangent/contracts';
import { newId } from '@tangent/db';
import { ApiError, notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type User = { id: string; name: string };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
type Rules = Awaited<ReturnType<LibraryService['rules']>>;
/** One loan's rules: its borrower's member type (staff, or a student's year group), then its item type's own. */
export function loanRules(r: Rules, who: { staff: boolean; grade: number | null }, itemType: string | null) {
  const m = r.memberTypes.find((x) => x.staff === who.staff && (who.staff || !x.grades.length || (who.grade !== null && x.grades.includes(who.grade))));
  const it = r.typeRules[itemType ?? ''] ?? {};
  return {
    loanDays: it.loanDays ?? m?.loanDays ?? r.loanDays,
    maxLoans: m?.maxLoans ?? (who.staff ? r.staffMaxLoans : r.maxLoans),
    finePerDay: it.finePerDay ?? r.finePerDay,
    maxRenewals: it.maxRenewals ?? r.maxRenewals,
  };
}
/** The late fine for so many late days: the grace days free, then by the day, never above the cap (0: none). */
export function lateFine(r: Rules, days: number, perDay: number): number {
  const f = Math.max(0, days - r.fineGraceDays) * perDay;
  return r.fineCap > 0 ? Math.min(f, r.fineCap) : f;
}

/** The library: a catalogue with copies, issue and return with due dates and fines, and a queue of reservations per book. */
@Injectable()
export class LibraryService {
  constructor(
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly messenger: Messenger,
  ) {}

  async rules(t: TenantCtx) {
    return {
      loanDays: await this.settings.value<number>(t, 'library.loanDays', 14),
      finePerDay: await this.settings.value<number>(t, 'library.finePerDay', 1),
      maxRenewals: await this.settings.value<number>(t, 'library.maxRenewals', 1),
      maxLoans: await this.settings.value<number>(t, 'library.maxLoans', 3),
      staffMaxLoans: await this.settings.value<number>(t, 'library.staffMaxLoans', 5),
      itemTypes: await this.settings.value<ListItem[]>(t, 'library.itemTypes', [{ key: 'book', name: 'Book' }]),
      typeRules: await this.settings.value<Record<string, LibraryTypeRule>>(t, 'library.typeRules', {}),
      memberTypes: await this.settings.value<LibraryMember[]>(t, 'library.memberTypes', []),
      fineGraceDays: await this.settings.value<number>(t, 'library.fineGraceDays', 0),
      fineCap: await this.settings.value<number>(t, 'library.fineCap', 0),
      finesTo: await this.settings.value<'fees' | 'desk'>(t, 'library.finesTo', 'fees'),
    };
  }

  /** Who borrows (a student's year group, or staff) and the item's type, for one loan's rules. */
  private async rulesFor(t: TenantCtx, studentId: string | null, bookId: string | null) {
    const rules = await this.rules(t);
    const grade = studentId ? (await t.pool.query<{ grade: number }>('select c.grade from students s join classes c on c.id = s.class_id where s.id = $1', [studentId])).rows[0]?.grade ?? null : null;
    const type = bookId ? (await t.pool.query<{ item_type: string }>('select item_type from library_books where id = $1', [bookId])).rows[0]?.item_type ?? null : null;
    return { rules, ...loanRules(rules, { staff: !studentId, grade }, type) };
  }

  async view(t: TenantCtx): Promise<LibraryView> {
    const [books, loans, res, r] = await Promise.all([this.books(t), this.loans(t), this.reservations(t), this.rules(t)]);
    return { books, loans, reservations: res, rules: { loanDays: r.loanDays, finePerDay: r.finePerDay, maxRenewals: r.maxRenewals, maxLoans: r.maxLoans, staffMaxLoans: r.staffMaxLoans, finesTo: r.finesTo } };
  }

  /** The catalogue, or the titles a search finds: by title or author, or by ISBN or barcode in any of their written forms. */
  async books(t: TenantCtx, q = ''): Promise<BookRow[]> {
    const s = q.trim();
    const { rows } = await t.pool.query(
      `select b.*, (select count(*) from library_loans l where l.book_id = b.id and l.returned_on is null)::int out,
         (select count(*) from library_reservations r where r.book_id = b.id and r.status in ('waiting','ready'))::int waiting
       from library_books b where $1 = '' or b.title ilike '%' || $1 || '%' or b.author ilike '%' || $1 || '%'
         or upper(regexp_replace(b.isbn, '[\s-]', '', 'g')) = any($2) or (b.barcode <> '' and upper(regexp_replace(b.barcode, '[\s-]', '', 'g')) = any($2))
       order by b.title limit 500`, [s, s ? codeForms(s) : []]);
    return rows.map((b) => ({ id: b.id, title: b.title, author: b.author, isbn: b.isbn, category: b.category, shelf: b.shelf, copies: b.copies, itemType: b.item_type, barcode: b.barcode, out: b.out, waiting: b.waiting }));
  }

  /** The one title a scanned code is on (its barcode first, then its ISBN). */
  async byCode(t: TenantCtx, code: string): Promise<BookRow> {
    const forms = codeForms(code);
    if (!forms[0]) throw new ApiError('validation', tx('Scan or type a code.'));
    const { rows } = await t.pool.query<{ id: string }>(
      `select id from library_books where (barcode <> '' and upper(regexp_replace(barcode, '[\s-]', '', 'g')) = any($1)) or upper(regexp_replace(isbn, '[\s-]', '', 'g')) = any($1)
       order by (barcode <> '' and upper(regexp_replace(barcode, '[\s-]', '', 'g')) = any($1)) desc limit 1`, [forms]);
    if (!rows[0]) throw notFound(tx('A title with that code'));
    return (await this.books(t)).find((b) => b.id === rows[0]!.id)!;
  }

  /** Open loans (the desk), or every loan of some students or one member of staff (the app's shelf and history). */
  async loans(t: TenantCtx, studentIds?: string[], staffUserId?: string): Promise<LoanRow[]> {
    const rules = await this.rules(t);
    const today = schoolToday();
    const all = !studentIds && !staffUserId;
    const { rows } = await t.pool.query(
      `select l.*, l.due_on::text due, l.issued_on::text issued, l.returned_on::text returned, coalesce(s.name, u.name) student, coalesce(c.name, 'Staff') class_name, c.grade, b.item_type
       from library_loans l left join students s on s.id = l.student_id left join classes c on c.id = s.class_id left join users u on u.id = l.staff_user_id
       left join library_books b on b.id = l.book_id
       where ($1 and l.returned_on is null) or l.student_id = any($2) or l.staff_user_id = $3 order by l.returned_on desc nulls first, l.due_on limit 1000`, [all, studentIds ?? [], staffUserId ?? '']);
    return rows.map((l) => {
      const late = l.returned ? 0 : Math.max(0, daysBetween(l.due, today));
      const own = loanRules(rules, { staff: !l.student_id, grade: l.grade ?? null }, l.item_type ?? null);
      const fine = lateFine(rules, late, own.finePerDay);
      return { id: l.id, bookId: l.book_id, title: l.title, studentId: l.student_id, staffUserId: l.staff_user_id, student: l.student, className: l.class_name, issuedOn: l.issued, dueOn: l.due, returnedOn: l.returned,
        fine: l.returned ? Number(l.fine) : fine, overdueDays: late, maxRenewals: own.maxRenewals, renewals: l.renewals ?? 0, outcome: l.outcome ?? 'returned', fineNote: l.fine_note ?? '', billed: !!l.fine_invoice_id };
    });
  }

  async reservations(t: TenantCtx, studentIds?: string[]): Promise<ReservationRow[]> {
    const { rows } = await t.pool.query(
      `select r.*, b.title, s.name student from library_reservations r join library_books b on b.id = r.book_id join students s on s.id = r.student_id
       where r.status in ('waiting','ready') and ($1::text[] is null or r.student_id = any($1)) order by r.created_at`, [studentIds ?? null]);
    return rows.map((r) => ({ id: r.id, bookId: r.book_id, title: r.title, studentId: r.student_id, student: r.student, status: r.status, createdAt: r.created_at.toISOString() }));
  }

  async saveBook(t: TenantCtx, user: User, b: BookInput, id?: string): Promise<BookRow> {
    const type = listKey((await this.rules(t)).itemTypes, b.itemType);
    if (!type) throw new ApiError('validation', tx('Choose one of the library’s item types.'), { fields: { itemType: tx('Choose from the list.') } });
    b = { ...b, itemType: type };
    // A barcode is one title's: two titles with the same label would lend the wrong one.
    if (b.barcode && (await t.pool.query('select 1 from library_books where upper(barcode) = upper($1) and id <> $2', [b.barcode, id ?? ''])).rowCount) {
      throw new ApiError('validation', tx('Another title has this barcode.'), { fields: { barcode: tx('Already on another title.') } });
    }
    if (id) {
      const out = Number((await t.pool.query<{ n: string }>('select count(*) n from library_loans where book_id = $1 and returned_on is null', [id])).rows[0]!.n);
      if (b.copies < out) throw new ApiError('validation', tx('{out} copies are out on loan, so there must be at least {out1}.', { out, out1: out }), { fields: { copies: tx('At least {out}.', { out }) } });
      const r = await t.pool.query('update library_books set title = $2, author = $3, isbn = $4, category = $5, shelf = $6, copies = $7, item_type = $8, barcode = $9 where id = $1', [id, b.title, b.author, b.isbn, b.category, b.shelf, b.copies, b.itemType, b.barcode]);
      if (!r.rowCount) throw notFound('That book');
    } else {
      id = newId('bok');
      await t.pool.query('insert into library_books (id, title, author, isbn, category, shelf, copies, item_type, barcode) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, b.title, b.author, b.isbn, b.category, b.shelf, b.copies, b.itemType, b.barcode]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'library.book.saved', entity: 'book', entityId: id, detail: { title: b.title, copies: b.copies } });
    return (await this.books(t)).find((x) => x.id === id)!;
  }

  async deleteBook(t: TenantCtx, user: User, id: string): Promise<void> {
    if ((await t.pool.query('select 1 from library_loans where book_id = $1 and returned_on is null', [id])).rowCount) throw new ApiError('conflict', 'Copies of this book are out. Take them back first.');
    await t.pool.query('update library_loans set book_id = null where book_id = $1', [id]);
    const r = await t.pool.query('delete from library_books where id = $1 returning title', [id]);
    if (!r.rowCount) throw notFound('That book');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'library.book.deleted', entity: 'book', entityId: id, detail: { title: r.rows[0].title } });
  }

  /** Lends a copy. A reserved book goes first to whoever has been waiting longest. */
  async issue(t: TenantCtx, user: User, b: IssueInput): Promise<LoanRow> {
    const book = (await t.pool.query<{ title: string; copies: number; out: number }>(
      'select title, copies, (select count(*) from library_loans where book_id = b.id and returned_on is null)::int out from library_books b where id = $1', [b.bookId])).rows[0];
    if (!book) throw notFound('That book');
    if (book.out >= book.copies) throw new ApiError('conflict', tx('All {copies} copies of {title} are out.', { copies: book.copies, title: book.title }));
    const first = (await t.pool.query<{ student_id: string }>("select student_id from library_reservations where book_id = $1 and status in ('waiting','ready') order by created_at limit 1", [b.bookId])).rows[0];
    if (first && first.student_id !== b.studentId && book.copies - book.out <= 1) throw new ApiError('conflict', 'The last copy is reserved for someone else.');
    if (b.studentId) {
      if ((await t.pool.query("select 1 from students where id = $1 and status = 'active'", [b.studentId])).rowCount === 0) throw notFound('That student');
    } else if (!(await t.pool.query("select 1 from users where id = $1 and kind = 'staff'", [b.staffUserId])).rowCount) throw notFound('That member of staff');
    // How many items one person may have out (Library → Settings, by member type).
    const rules = await this.rulesFor(t, b.studentId, b.bookId);
    const out = Number((await t.pool.query<{ n: string }>('select count(*) n from library_loans where returned_on is null and (student_id = $1 or staff_user_id = $2)', [b.studentId ?? '', b.staffUserId ?? ''])).rows[0]!.n);
    const most = rules.maxLoans;
    if (out >= most) throw new ApiError('conflict', tx('They already have {out} {p1} out, the most the school allows. A book must come back first.', { out, p1: out === 1 ? 'book' : 'books' }));
    const today = schoolToday();
    if (b.dueOn && b.dueOn < today) throw new ApiError('validation', tx('The due date cannot be in the past.'), { fields: { dueOn: tx('Pick today or later.') } });
    const due = b.dueOn ?? addDays(today, rules.loanDays);
    const id = newId('lon');
    await t.pool.query('insert into library_loans (id, student_id, staff_user_id, title, due_on, book_id, issued_on) values ($1,$2,$3,$4,$5,$6,$7)', [id, b.studentId, b.staffUserId, book.title, due, b.bookId, today]);
    if (b.studentId) await t.pool.query("update library_reservations set status = 'done' where book_id = $1 and student_id = $2 and status in ('waiting','ready')", [b.bookId, b.studentId]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'library.issued', entity: 'book', entityId: b.bookId, detail: { studentId: b.studentId, staffUserId: b.staffUserId, due } });
    return (await this.loans(t, b.studentId ? [b.studentId] : undefined, b.staffUserId ?? undefined)).find((l) => l.id === id)!;
  }

  /** Takes a book back, fixes its fine, and tells the next family waiting that it is ready. */
  async giveBack(t: TenantCtx, user: User, loanId: string, b: GiveBack = { outcome: 'returned', charge: 0, fine: 'bill', reason: '' }): Promise<{ fine: number; billed: boolean }> {
    const l = (await t.pool.query<{ book_id: string | null; due: string; student_id: string | null; title: string }>("select book_id, due_on::text due, student_id, title from library_loans where id = $1 and returned_on is null", [loanId])).rows[0];
    if (!l) throw notFound('That loan');
    const today = schoolToday();
    // A late fine by the item's and borrower's rules, plus what a lost or damaged item costs the school.
    const r = await this.rulesFor(t, l.student_id, l.book_id);
    const fine = lateFine(r.rules, Math.max(0, daysBetween(l.due, today)), r.finePerDay) + (b.outcome === 'returned' ? 0 : b.charge);
    let invoiceId: string | null = null;
    // A student's fine goes on their family's fees (a "Library" fee head is added the first time); staff settle at the desk.
    if (fine > 0 && b.fine === 'bill' && l.student_id && (await this.settings.effective(t)).modules.includes('fees')) {
      await t.pool.query("insert into fee_heads (key, name, sort, concession) values ('library', 'Library', 900, false) on conflict (key) do nothing");
      invoiceId = newId('inv');
      await t.pool.query('insert into fee_invoices (id, student_id, head, title, amount, due_on) values ($1,$2,$3,$4,$5,$6)',
        [invoiceId, l.student_id, 'library', (b.outcome === 'lost' ? tx('Lost book: {title}', { title: l.title }) : b.outcome === 'damaged' ? tx('Damaged book: {title}', { title: l.title }) : tx('Library fine: {title}', { title: l.title })).slice(0, 80), await this.settings.billed(t, 'library', fine), addDays(today, 14)]);
    }
    const note = fine === 0 ? '' : b.fine === 'waive' ? tx('Waived: {reason}', { reason: b.reason ?? '' }) : b.fine === 'paid' || !invoiceId ? tx('Paid at the desk') : tx('Added to the fees');
    await t.pool.query('update library_loans set returned_on = $2, fine = $3, outcome = $4, fine_note = $5, fine_invoice_id = $6 where id = $1', [loanId, today, fine, b.outcome, note, invoiceId]);
    // A lost book is one copy fewer on the shelf.
    if (b.outcome === 'lost' && l.book_id) await t.pool.query('update library_books set copies = greatest(copies - 1, 0) where id = $1', [l.book_id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: `library.${b.outcome}`, entity: 'loan', entityId: loanId, detail: { fine, note } });
    if (l.book_id && b.outcome !== 'lost') {
      const next = (await t.pool.query<{ id: string; student_id: string; student: string; title: string }>(
        `select r.id, s.id student_id, s.name student, b.title from library_reservations r join students s on s.id = r.student_id join library_books b on b.id = r.book_id
         where r.book_id = $1 and r.status = 'waiting' order by r.created_at limit 1`, [l.book_id])).rows[0];
      if (next) {
        await t.pool.query("update library_reservations set status = 'ready' where id = $1", [next.id]);
        const fams = (await t.pool.query<{ phone: string | null }>('select g.phone from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = $1 and sg.gets_messages', [next.student_id])).rows;
        await this.messenger.notify(t, 'library.ready', fams.filter((f) => f.phone).map((f) => ({ to: f.phone!, vars: { student: next.student, title: next.title } })));
      }
    }
    return { fine, billed: !!invoiceId };
  }

  /** The desk renews a loan by the loan period (the family's own renewals are counted the same way). */
  async renewAtDesk(t: TenantCtx, user: User, loanId: string): Promise<LoanRow> {
    const l = (await t.pool.query<{ student_id: string | null; staff_user_id: string | null; book_id: string | null; due: string }>('select student_id, staff_user_id, book_id, due_on::text due from library_loans where id = $1 and returned_on is null', [loanId])).rows[0];
    if (!l) throw notFound('That loan');
    const rules = await this.rulesFor(t, l.student_id, l.book_id);
    if (l.book_id && (await t.pool.query("select 1 from library_reservations where book_id = $1 and status = 'waiting'", [l.book_id])).rowCount) throw new ApiError('conflict', 'Someone is waiting for this book, so it cannot be renewed.');
    const due = addDays(l.due < schoolToday() ? schoolToday() : l.due, rules.loanDays);
    await t.pool.query('update library_loans set due_on = $2, renewals = renewals + 1 where id = $1', [loanId, due]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'library.renewed', entity: 'loan', entityId: loanId, detail: { due } });
    return (await this.loans(t, l.student_id ? [l.student_id] : undefined, l.staff_user_id ?? undefined)).find((x) => x.id === loanId)!;
  }

  /** A family reserves a book for their child: a place in the queue for the next copy. */
  async reserve(t: TenantCtx, bookId: string, studentId: string): Promise<ReservationRow> {
    const book = (await t.pool.query('select 1 from library_books where id = $1', [bookId])).rows[0];
    if (!book) throw notFound('That book');
    if ((await t.pool.query('select 1 from library_loans where book_id = $1 and student_id = $2 and returned_on is null', [bookId, studentId])).rowCount) throw new ApiError('conflict', 'Your child already has this book.');
    const id = newId('rsv');
    await t.pool.query('insert into library_reservations (id, book_id, student_id) values ($1,$2,$3) on conflict do nothing', [id, bookId, studentId]);
    return (await this.reservations(t, [studentId])).find((r) => r.bookId === bookId)!;
  }

  /** A family cancels their own reservation, or the desk cancels one saying why (the family is told). */
  async cancelReservation(t: TenantCtx, id: string, studentIds: string[] | null, reason = ''): Promise<void> {
    const r = await t.pool.query<{ student_id: string; book_id: string }>("update library_reservations set status = 'cancelled', cancel_reason = $3 where id = $1 and status in ('waiting','ready') and ($2::text[] is null or student_id = any($2)) returning student_id, book_id", [id, studentIds, reason]);
    if (!r.rowCount) throw notFound('That reservation');
    if (!studentIds && reason) {
      const who = (await t.pool.query<{ phone: string | null; student: string; title: string }>(
        `select g.phone, s.name student, b.title from students s join library_books b on b.id = $2 join student_guardians sg on sg.student_id = s.id and sg.gets_messages
         join guardians g on g.id = sg.guardian_id where s.id = $1`, [r.rows[0]!.student_id, r.rows[0]!.book_id])).rows;
      await this.messenger.notify(t, 'library.cancelled', who.filter((w) => w.phone).map((w) => ({ to: w.phone!, vars: { student: w.student, title: w.title, reason } })));
    }
  }

  /** A family renews a loan once more, by the loan period, if nobody is waiting for the book. */
  async renew(t: TenantCtx, loanId: string, studentIds: string[], staffUserId?: string): Promise<LoanRow> {
    const l = (await t.pool.query<{ student_id: string | null; staff_user_id: string | null; book_id: string | null; renewals: number; due: string }>(
      'select student_id, staff_user_id, book_id, renewals, due_on::text due from library_loans where id = $1 and returned_on is null and (student_id = any($2) or staff_user_id = $3)', [loanId, studentIds, staffUserId ?? ''])).rows[0];
    if (!l) throw notFound('That book');
    const rules = await this.rulesFor(t, l.student_id, l.book_id);
    if (l.renewals >= rules.maxRenewals) throw new ApiError('conflict', rules.maxRenewals ? tx('This can be renewed {n} times. Please return it to the library.', { n: rules.maxRenewals }) : tx('This cannot be renewed from the app. Ask at the library desk.'));
    if (l.book_id && (await t.pool.query("select 1 from library_reservations where book_id = $1 and status = 'waiting'", [l.book_id])).rowCount) throw new ApiError('conflict', 'Someone is waiting for this book, so it cannot be renewed.');
    const due = addDays(l.due < schoolToday() ? schoolToday() : l.due, rules.loanDays);
    await t.pool.query('update library_loans set due_on = $2, renewals = renewals + 1 where id = $1', [loanId, due]);
    return (await this.loans(t, l.student_id ? [l.student_id] : undefined, l.staff_user_id ?? undefined)).find((x) => x.id === loanId)!;
  }
}
