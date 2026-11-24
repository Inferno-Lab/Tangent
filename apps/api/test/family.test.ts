import { addDays, schoolToday } from '@tangent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let parent: string;
let teacher: string;
let admin: string;
/** The parent with two children in 8 A (the class teacher's class), a classmate from another family, and the class teacher's subject. */
let aarav: string;
let ananya: string;
let diya: string;
let cls: string;
let sci: { id: string; key: string; name: string };
let mid: string;

const f = (token: string, url: string) => h.call('GET', `/v1/f${url}`, { token });
const post = (token: string, url: string, body?: unknown) => h.call('POST', `/v1/f${url}`, { token, body: body ?? {} });

beforeAll(async () => {
  h = await startHarness();
  parent = await h.login(h.people.parentOfTwo.phone);
  teacher = await h.login(h.people.classTeacher.email);
  admin = await h.login();
  const [a, b] = h.people.parentOfTwo.children!;
  const idOf = async (adm: string) => (await h.schoolSql('select id from students where admission_no = $1', [adm]))[0].id as string;
  aarav = await idOf(a!.admissionNo);
  ananya = await idOf(b!.admissionNo);
  cls = await h.classId('8 A');
  diya = (await h.schoolSql("select id from students where class_id = $1 and status = 'active' and id <> all($2) order by admission_no limit 1", [cls, [aarav, ananya]]))[0].id;
  const teacherId = await h.userId(h.people.classTeacher.email);
  const [subject] = await h.schoolSql('select s.id, s.name from timetable_slots t join subjects s on s.id = t.subject_id where t.class_id = $1 and t.teacher_id = $2 limit 1', [cls, teacherId]);
  sci = { id: subject.id, key: subject.id.replace(/^sub_/, ''), name: subject.name };
  // The term's next exam, still to be marked (the old system's exams are all published).
  const day = await h.openDay(10);
  mid = (await h.call('POST', '/v1/exams', { token: admin, body: { name: 'Mid-term exams', classId: cls, startsOn: day, endsOn: day, subjects: [{ subjectId: sci.id, maxMarks: 100 }] } })).json.id;
}, 240_000);
afterAll(async () => {
  await h?.close();
});

describe('who is signed in', () => {
  it('tells the app who the person is, in the app’s own shape', async () => {
    expect((await f(parent, '/me')).json).toMatchObject({ role: 'parent', name: h.people.parentOfTwo.name, childIds: expect.arrayContaining([aarav, ananya]) });
    expect((await f(parent, '/me')).json.childIds).toHaveLength(2);
    expect((await f(teacher, '/me')).json).toMatchObject({ role: 'teacher', name: h.people.classTeacher.name });
    // A family has no password: the answer is the same as for any wrong one (the app sends families to the code).
    const blocked = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.parentOfTwo.phone, password: 'anything' } });
    expect(blocked.status).toBe(401);
    expect(blocked.json?.step).toBeUndefined();
    expect((await h.call('GET', '/v1/f/me')).status).toBe(401);
  });
  it('keeps families out of the staff API', async () => {
    for (const url of ['/v1/dashboard', '/v1/search?q=a', '/v1/shell', '/v1/students', '/v1/reports']) expect((await h.call('GET', url, { token: parent })).status).toBe(403);
    expect((await h.call('GET', '/v1/me', { token: parent })).status).toBe(200);
    expect((await h.call('GET', '/v1/config', { token: parent })).status).toBe(200);
    expect((await h.call('GET', '/v1/dashboard', { token: admin })).status).toBe(200);
  });
  it('keeps each family to its own children', async () => {
    expect((await f(parent, `/students/${aarav}`)).status).toBe(200);
    expect((await f(parent, `/students/${diya}`)).status).toBe(403);
    expect((await f(parent, `/students/${diya}/fees`)).status).toBe(403);
    expect((await f(parent, `/classes/${await h.classId('9 A')}/timetable`)).status).toBe(403);
    expect((await f(teacher, `/students/${diya}`)).status).toBe(200);
  });
  it('lists the classes and teachers the way the app expects', async () => {
    const klass = (await f(parent, `/classes/${cls}`)).json;
    // The school's own name for the class, not one the app makes up.
    expect(klass).toMatchObject({ name: '8 A', section: 'A' });
    expect(klass.studentIds.length).toBeGreaterThan(30);
    const mine = (await f(teacher, '/teachers/' + (await f(teacher, '/me')).json.id + '/classes')).json;
    expect(mine.map((c: any) => c.id)).toContain(cls);
    expect((await f(parent, '/teachers')).json.some((t: any) => t.name === h.people.classTeacher.name && t.subject === sci.key)).toBe(true);
  });
});

describe('learning', () => {
  it('serves the timetable with breaks, homework with submissions and published results', async () => {
    // aSc's week: Monday to Friday of eight lessons, and a half Saturday.
    const tt = (await f(parent, `/classes/${cls}/timetable`)).json;
    expect(tt.map((d: any) => d.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(tt[0].periods.filter((p: any) => p.kind === 'class').length).toBe(8);
    expect(tt[5].periods.filter((p: any) => p.kind === 'class').length).toBe(4);
    expect(tt[0].periods.some((p: any) => p.kind === 'break')).toBe(true);
    const set = await post(teacher, '/homework', { classId: cls, subject: sci.key, title: 'Read chapter 5', dueOn: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    expect(set.status).toBe(200);
    const hw = (await f(parent, `/classes/${cls}/homework`)).json;
    expect(hw.find((x: any) => x.id === set.json.id).submissions.find((s: any) => s.studentId === aarav)).toBeTruthy();
    // The old system's exams, published with their marks.
    const exams = (await f(parent, `/classes/${cls}/exams`)).json;
    const pt = exams.find((e: any) => e.name === 'Periodic Test 1');
    expect(pt).toMatchObject({ status: 'completed', subjects: expect.arrayContaining([sci.key]) });
    const res = (await f(parent, `/results/${pt.id}/${aarav}`)).json;
    expect(res).toMatchObject({ overallPercent: expect.any(Number), grade: expect.any(String), rank: expect.any(Number) });
    expect(res.subjects.length).toBe(pt.subjects.length);
    expect((await f(parent, `/students/${aarav}/results`)).json.length).toBeGreaterThan(0);
    expect((await f(parent, `/results/${mid}/${aarav}`)).status).toBe(404);
  });
  it('lets a parent hand homework in and a teacher grade it', async () => {
    const assigned = await post(teacher, '/homework', { classId: cls, subject: sci.key, title: 'From the app', dueOn: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(assigned.status).toBe(200);
    const hw = (await f(parent, `/classes/${cls}/homework`)).json.find((x: any) => x.id === assigned.json.id);
    expect(hw.submissions.find((s: any) => s.studentId === aarav).status).toBe('pending');
    expect((await post(parent, `/homework/${hw.id}/submissions`, { studentId: aarav, fileName: 'work.pdf' })).status).toBe(200);
    expect((await f(parent, `/homework/${hw.id}`)).json.submissions.find((s: any) => s.studentId === aarav).status).toBe('submitted');
    expect((await post(parent, `/homework/${hw.id}/grades`, { studentId: aarav, marks: 15 })).status).toBe(403);
    expect((await post(teacher, `/homework/${hw.id}/grades`, { studentId: aarav, marks: 15, feedback: 'Well done' })).status).toBe(200);
    expect((await f(parent, `/homework/${hw.id}`)).json.submissions.find((s: any) => s.studentId === aarav)).toMatchObject({ status: 'graded', marks: 15, feedback: 'Well done' });
    expect((await post(parent, '/homework', { classId: cls, subject: sci.key, title: 'Not a teacher', dueOn: '2099-01-01' })).status).toBe(403);
  });
  it('lets a teacher mark attendance, and the family sees it and is told', async () => {
    const marked = await post(teacher, '/attendance', { [aarav]: 'absent' });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const today = (await f(teacher, `/attendance/today?students=${aarav},${diya}`)).json;
    expect(today[aarav]).toBe('absent');
    const days = (await f(parent, `/students/${aarav}/attendance`)).json;
    expect(days.at(-1)).toMatchObject({ studentId: aarav, status: 'absent' });
    expect((await post(parent, '/attendance', { [aarav]: 'present' })).status).toBe(403);
    const notes = (await f(parent, '/users/x/notifications')).json;
    expect(notes[0]).toMatchObject({ type: 'attendance.absent', module: 'attendance.parentAlerts', route: '/attendance', read: false });
    expect((await post(parent, `/notifications/${notes[0].id}/dismiss`)).status).toBe(200);
    expect((await f(parent, '/users/x/notifications')).json.find((n: any) => n.id === notes[0].id)).toBeUndefined();
  });
  it('lets a teacher enter marks for the open exam', async () => {
    expect((await f(teacher, `/classes/${cls}/exams`)).json.find((e: any) => e.id === mid)).toBeTruthy();
    expect((await post(teacher, `/classes/${cls}/marks`, { subject: sci.key, values: { [aarav]: 44, [diya]: 38 } })).status).toBe(200);
    const draft = (await f(teacher, `/classes/${cls}/marks?subject=${sci.key}`)).json;
    expect(draft).toEqual({ marks: { [aarav]: 44, [diya]: 38 }, maxMarks: 100, grades: [], gradeMarks: {} });
    // A subject the open exam does not have.
    const [other] = await h.schoolSql('select id from subjects where id <> $1 limit 1', [sci.id]);
    expect((await post(teacher, `/classes/${cls}/marks`, { subject: other.id.replace(/^sub_/, ''), values: { [aarav]: 10 } })).status).toBe(409);
    expect((await post(parent, `/classes/${cls}/marks`, { subject: sci.key, values: { [aarav]: 1 } })).status).toBe(403);
  });
});

describe('money, notices, events', () => {
  it('shows fees and takes a payment that the school sees', async () => {
    const assign = await h.call('POST', '/v1/students/assign-fee', { token: admin, body: { ids: [ananya], head: 'lab', title: 'Lab fee for the app', amount: 1200, dueOn: '2099-01-01' } });
    expect(assign.status).toBe(200);
    const acct = (await f(parent, `/students/${ananya}/fees`)).json;
    const open = acct.installments.find((i: any) => i.title === 'Lab fee for the app');
    expect(open).toMatchObject({ amount: 1200, paid: false });
    // Older app builds paid directly; now the family pays on the provider's checkout (the test track's sandbox here).
    expect((await post(parent, `/fees/${open.id}/pay`, { studentId: ananya, method: 'upi' })).status).toBe(409);
    const order = await post(parent, `/fees/${open.id}/order`, { studentId: ananya });
    expect(order.status).toBe(200);
    expect(order.json).toMatchObject({ amount: 1200 });
    const checkout = new URL(order.json.url).pathname;
    expect((await h.call('GET', checkout)).status).toBe(200);
    expect((await f(parent, `/orders/${order.json.orderId}`)).json).toMatchObject({ status: 'created', receipt: null });
    expect((await h.call('POST', checkout, { body: { outcome: 'paid' } })).status).toBe(303);
    // The provider repeats its confirmation: the receipt is written once.
    expect((await h.call('POST', checkout, { body: { outcome: 'paid' } })).status).toBe(303);
    const done = (await f(parent, `/orders/${order.json.orderId}`)).json;
    expect(done).toMatchObject({ status: 'paid', receipt: { installmentId: open.id, amount: 1200 } });
    const after = (await f(parent, `/students/${ananya}/fees`)).json;
    expect(after.installments.find((i: any) => i.id === open.id).paid).toBe(true);
    expect(after.receipts.filter((r: any) => r.installmentId === open.id)).toHaveLength(1);
    expect((await post(parent, `/fees/${open.id}/order`, { studentId: ananya })).status).toBe(409);
    expect((await post(parent, `/fees/${open.id}/order`, { studentId: diya })).status).toBe(403);
    expect((await h.call('GET', `/v1/f/receipts/${done.receipt.id}/pdf`, { token: parent })).headers['content-type']).toContain('application/pdf');
    // The office sees it among online payments, refunds part of it (under the second-person limit), and reconciliation answers.
    const online = (await h.call('GET', '/v1/fees/online', { token: admin })).json;
    expect(online.find((p: any) => p.id === done.receipt.id)).toMatchObject({ amount: 1200, refunded: 0 });
    const refund = await h.call('POST', '/v1/fees/refunds', { token: admin, body: { paymentId: done.receipt.id, amount: 200, reason: 'Charged for a lab day missed' } });
    expect(refund.json).toMatchObject({ status: 'sent', amount: 200 });
    expect((await h.call('POST', '/v1/fees/refunds', { token: admin, body: { paymentId: done.receipt.id, amount: 5000, reason: 'Too much' } })).status).toBe(400);
    expect((await h.call('GET', '/v1/fees/online', { token: admin })).json.find((p: any) => p.id === done.receipt.id).refunded).toBe(200);
    expect((await h.call('GET', '/v1/fees/reconciliation', { token: admin })).status).toBe(200);
    // Two refunds asked for at once cannot take the same money, and two approvals at once send a refund once.
    await h.setSettings({ 'fees.refundApprovalAbove': 0 });
    const both = await Promise.all([600, 600].map((amount) => h.call('POST', '/v1/fees/refunds', { token: admin, body: { paymentId: done.receipt.id, amount, reason: 'Asked twice at once' } })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 400]);
    const waiting = both.find((r) => r.status === 200)!.json;
    expect(waiting.status).toBe('requested');
    const accountant = await h.login(h.people.accountant.email);
    const decided = await Promise.all([1, 2].map(() => h.call('POST', `/v1/fees/refunds/${waiting.id}/decide`, { token: accountant, body: { approve: true, note: '' } })));
    expect(decided.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await h.call('GET', '/v1/fees/online', { token: admin })).json.find((p: any) => p.id === done.receipt.id).refunded).toBe(800);
    await h.setSettings({ 'fees.refundApprovalAbove': 5000 });
    expect((await f(parent, `/students/${aarav}/fees`)).json.installments.length).toBeGreaterThan(0);
  });
  it('lists published notices for the right people, and events with a reply', async () => {
    // The school posts this term's circulars: one to families, one to staff, one waiting as a draft.
    const at = (await h.openDay(12)) + 'T09:00:00+05:30';
    const notice = (b: Record<string, unknown>) => h.call('POST', '/v1/notices', { token: admin, body: { body: 'Please read this circular.', ...b } });
    expect((await notice({ title: 'Sports day on the main ground', audience: 'parents', publish: true })).status).toBeLessThan(300);
    expect((await notice({ title: 'PTM notice draft', audience: 'parents', publish: false })).status).toBeLessThan(300);
    expect((await h.call('POST', '/v1/events', { token: admin, body: { title: 'Sports day', startsAt: new Date(at).toISOString(), kind: 'event', audience: 'everyone', needsRsvp: true } })).status).toBe(201);
    expect((await h.call('POST', '/v1/events', { token: admin, body: { title: 'Staff meeting', startsAt: new Date(at).toISOString(), kind: 'event', audience: 'staff' } })).status).toBe(201);
    const notices = (await f(parent, '/notices')).json;
    expect(notices.some((n: any) => n.title.startsWith('Sports day'))).toBe(true);
    expect(notices.some((n: any) => /PTM notice/.test(n.title))).toBe(false);
    const events = (await f(parent, '/events')).json;
    const sports = events.find((e: any) => e.title === 'Sports day');
    expect(sports).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), time: expect.stringMatching(/^\d{2}:\d{2}$/) });
    expect((await post(parent, `/events/${sports.id}/rsvp`, { status: 'going' })).status).toBe(200);
    expect((await f(parent, '/events')).json.find((e: any) => e.id === sports.id).rsvps).toEqual(
      (await f(parent, '/me')).json.childIds.map((studentId: string) => expect.objectContaining({ studentId, status: 'going', adults: 0 })));
    expect(events.some((e: any) => e.title === 'Staff meeting')).toBe(false);
    expect((await post(parent, `/events/${sports.id}/rsvp`, { status: 'sure' })).status).toBe(400);
    expect((await post(parent, '/notices', { title: 'Not allowed', body: 'A parent cannot post.' })).status).toBe(403);
    const posted = await post(admin, '/notices', { title: 'Posted from the app', body: 'Bring your books on Monday.' });
    expect(posted.status).toBe(200);
  });
});

describe('chat, leave and the rest', () => {
  it('reads and answers a conversation with the school', async () => {
    const me = (await f(parent, '/me')).json;
    // The school writes first (its old system kept no conversations).
    expect((await h.call('POST', '/v1/messages', { token: admin, body: { studentId: aarav, subject: 'Science project', body: 'Please send the project file by Friday.' } })).status).toBe(201);
    const threads = (await f(parent, `/users/${me.id}/threads`)).json;
    expect(threads.length).toBeGreaterThan(0);
    const msgs = (await f(parent, `/threads/${threads[0].id}/messages`)).json;
    expect(msgs[0]).toMatchObject({ threadId: threads[0].id, read: expect.any(Boolean) });
    expect((await post(parent, `/threads/${threads[0].id}/messages`, { senderId: me.id, text: 'Thank you.' })).status).toBe(200);
    expect((await f(parent, `/threads/${threads[0].id}/messages`)).json.at(-1)).toMatchObject({ text: 'Thank you.', senderId: me.id });
    expect((await f(parent, `/users/${me.id}/messages`)).json.length).toBeGreaterThan(0);
    expect((await f(parent, '/threads/th_missing/messages')).status).toBe(404);
    const kav = (await f(teacher, '/me')).json.id;
    const started = await post(parent, '/threads', { userId: me.id, teacherId: kav });
    expect(started.status).toBe(200);
    expect((await post(parent, '/threads', { userId: me.id, teacherId: kav })).json.id).toBe(started.json.id);
  });
  it('takes a leave request, shows it to the school and carries the class teacher’s answer back', async () => {
    const applied = await post(parent, '/leave', { studentId: aarav, from: '2099-02-01T00:00:00.000', to: '2099-02-02', reason: 'Family function' });
    expect(applied.status).toBe(200);
    const mine = (await f(parent, `/students/${aarav}/leave`)).json;
    expect(mine[0]).toMatchObject({ id: applied.json.id, status: 'pending', from: '2099-02-01', to: '2099-02-02', reason: 'Family function' });
    const adminView = (await h.call('GET', '/v1/approvals?status=pending&kind=leave', { token: admin })).json;
    expect(adminView.some((a: any) => a.title === `Leave for ${h.people.parentOfTwo.children![0]!.name}`)).toBe(true);
    expect((await post(parent, `/leave/${applied.json.id}/review`, { status: 'approved' })).status).toBe(403);
    expect((await post(teacher, `/leave/${applied.json.id}/review`, { status: 'approved', note: 'Approved. Collect the notes.' })).status).toBe(200);
    expect((await f(parent, `/students/${aarav}/leave`)).json[0]).toMatchObject({ status: 'approved', reviewNote: 'Approved. Collect the notes.' });
    expect((await post(parent, '/leave', { studentId: diya, from: '2099-02-01', to: '2099-02-02', reason: 'Not mine' })).status).toBe(403);
  });
  it('answers the school, library, transport and gallery screens honestly', async () => {
    expect((await f(parent, '/school')).json).toMatchObject({ name: h.manifest.school.name });
    // The Koha catalogue: the child borrows a title at the desk, and the family reserves one that is out.
    const out = (await h.schoolSql("select b.id from library_books b where b.copies > 0 and not exists (select 1 from library_loans l where l.book_id = b.id and l.returned_on is null) order by b.title limit 2"));
    expect((await h.call('POST', '/v1/library/loans', { token: admin, body: { bookId: out[0].id, studentId: aarav } })).status).toBe(200);
    const lib = (await f(parent, '/library/books')).json;
    expect(lib.rules.maxLoans).toBeGreaterThan(0);
    const books = lib.books;
    expect(books.length).toBeGreaterThanOrEqual(h.manifest.expect.titles);
    expect(books.some((b: any) => b.borrowedBy === aarav && b.dueDate)).toBe(true);
    expect((await post(parent, `/library/books/${out[0].id}/reserve`, { studentId: ananya })).json).toMatchObject({ bookId: out[0].id });
    expect((await post(parent, `/library/books/${out[1].id}/reserve`, { studentId: diya })).status).toBe(403);
    // The bus the transport register puts the child on.
    const [ride] = await h.schoolSql('select r.name, r.vehicle, (select count(*)::int from transport_stops s where s.route_id = r.id) stops from transport_assignments a join transport_routes r on r.id = a.route_id where a.student_id = $1', [aarav]);
    const bus = (await f(parent, `/students/${aarav}/transport`)).json;
    if (ride) {
      expect(bus).toMatchObject({ routeName: ride.name, busNumber: ride.vehicle });
      expect(bus.stops).toHaveLength(ride.stops);
    }
    expect((await f(parent, '/gallery')).json).toEqual([]);
    expect((await f(parent, '/users/' + (await f(parent, '/me')).json.id)).json.name).toBe(h.people.parentOfTwo.name);
  });
});

describe('the teacher’s class', () => {
  it('lists the class as a roster with attendance and results, and families see no contact details of classmates', async () => {
    const roster = (await f(teacher, `/classes/${cls}/students`)).json;
    const row = roster.find((s: any) => s.id === aarav);
    expect(row).toMatchObject({ guardianPhone: expect.any(String), attendancePct: expect.any(Number), absentToday: expect.any(Boolean) });
    expect(row).toHaveProperty('resultsPct');
    expect(row).toHaveProperty('photoFileId');
    const classmates = (await f(parent, `/classes/${cls}/students`)).json;
    const other = classmates.find((s: any) => s.id !== aarav && s.id !== ananya);
    expect(other).toMatchObject({ guardianPhone: '', address: '', dob: '' });
    expect(other).not.toHaveProperty('attendancePct');
  });
  it('fills approved leave into the roll call and keeps a past day within the correction window', async () => {
    // Yesterday, or the school day before it when yesterday was a holiday.
    const day = await h.openDay(-1);
    const applied = await post(parent, '/leave', { studentId: aarav, from: day, to: day, reason: 'Family function' });
    expect((await post(teacher, `/leave/${applied.json.id}/review`, { status: 'approved' })).status).toBe(200);
    const roll = (await f(teacher, `/attendance/roll?classId=${cls}&date=${day}`)).json;
    const row = roll.marks.find((m: any) => m.studentId === aarav);
    expect(row.onLeave).toBe(true);
    if (!roll.submitted) expect(row.status).toBe('leave');
    expect((await f(parent, `/attendance/roll?classId=${cls}&date=${day}`)).status).toBe(403);
    expect((await post(teacher, `/attendance?date=${addDays(schoolToday(), -20)}`, { [aarav]: 'present' })).status).toBe(423);
    expect((await post(teacher, `/attendance?date=${addDays(schoolToday(), 2)}`, { [aarav]: 'present' })).status).toBe(400);
  });
});

describe('attendance every period', () => {
  it('lets the period’s teacher mark it, and no one else but someone who approves', async () => {
    // The most recent day the class has lessons: a test run on a Sunday (or a day off) would otherwise find none.
    let day = schoolToday();
    let roll = await f(teacher, `/attendance/periods?classId=${cls}&date=${day}`);
    for (let back = 1; back < 7 && roll.status === 200 && !roll.json.periods.length; back++) {
      day = addDays(schoolToday(), -back);
      roll = await f(teacher, `/attendance/periods?classId=${cls}&date=${day}`);
    }
    expect(roll.status).toBe(200);
    const mine = roll.json.periods.find((p: any) => p.mine);
    const other = roll.json.periods.find((p: any) => !p.mine);
    if (mine) {
      const put = await h.call('PUT', '/v1/f/attendance/periods', { token: teacher, body: { classId: cls, date: day, period: mine.period, marks: [{ studentId: diya, status: 'absent' }] } });
      expect(put.status).toBe(200);
      expect(put.json.periods.find((p: any) => p.period === mine.period).marks[diya]).toBe('absent');
    }
    if (other) {
      expect((await h.call('PUT', '/v1/f/attendance/periods', { token: teacher, body: { classId: cls, date: day, period: other.period, marks: [{ studentId: diya, status: 'present' }] } })).status).toBe(403);
      expect((await h.call('PUT', '/v1/attendance/periods', { token: admin, body: { classId: cls, date: day, period: other.period, marks: [{ studentId: diya, status: 'present' }] } })).status).toBe(200);
    }
    expect(mine ?? other).toBeTruthy();
    expect((await f(parent, `/attendance/periods?classId=${cls}&date=${day}`)).status).toBe(403);
  });
});

describe('the school’s app link', () => {
  it('sends a phone to its store and a computer to a page', async () => {
    const page = await h.call('GET', `/hooks/app/${h.slug}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } });
    expect(page.status).toBe(200);
    expect(page.text).toContain('not in the stores yet');
    await h.registry.query("insert into builds (id, school_id, platform, version, status, note, url) select 'bld_test', id, 'android', '1.0.0', 'done', '', null from schools where slug = $1", [h.slug]);
    const phone = await h.call('GET', `/hooks/app/${h.slug}`, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } });
    expect(phone.status).toBe(302);
    expect(phone.headers.location).toBe(`https://play.google.com/store/apps/details?id=com.tangent.${h.slug.replace(/-/g, '')}`);
    expect((await h.call('GET', '/hooks/app/nowhere')).status).toBe(404);
  });
});

describe('family accounts', () => {
  const codeFor = async (identifier: string) => (await h.call('POST', '/v1/auth/code', { body: { identifier } })).json;
  it('gives a new student’s family an account that signs in with a code, and puts brothers and sisters under it', async () => {
    const add = (name: string) => h.call('POST', '/v1/students', { token: admin, body: { name, classId: cls, dob: '2013-05-02', guardianName: 'Meera Joshi', guardianPhone: '+91 99887 76655' } });
    expect((await add('Tara Joshi')).status).toBe(201);
    expect((await add('Vir Joshi')).status).toBe(201);
    const challenge = await codeFor('99887 76655');
    expect(challenge.maskedTo).toBeTruthy();
    const tokens = (await h.call('POST', '/v1/auth/verify', { body: { challengeId: challenge.challengeId, code: await h.codeSentTo('+919988776655'), client: 'mobile' } })).json;
    const me = (await h.call('GET', '/v1/f/me', { token: tokens.accessToken })).json;
    expect(me).toMatchObject({ role: 'parent', name: 'Meera Joshi' });
    expect(me.childIds).toHaveLength(2);
    expect((await h.call('POST', '/v1/auth/login', { body: { identifier: '9988776655', password: 'anything' } })).status).toBe(401);
  });
  it('keeps staff on their password, and a reset code only resets', async () => {
    const me = h.people.classTeacher;
    expect((await h.call('POST', '/v1/auth/code', { body: { identifier: me.email } })).status).toBe(400);
    const reset = (await h.call('POST', '/v1/auth/reset/start', { body: { identifier: me.email } })).json;
    expect((await h.call('POST', '/v1/auth/verify', { body: { challengeId: reset.challengeId, code: await h.codeSentTo(me.phone!) } })).status).toBe(401);
    const again = (await h.call('POST', '/v1/auth/reset/start', { body: { identifier: me.email } })).json;
    expect((await h.call('POST', '/v1/auth/reset/finish', { body: { challengeId: again.challengeId, code: await h.codeSentTo(me.phone!), password: 'a-new-pass-123' } })).status).toBe(204);
    expect((await h.call('GET', '/v1/f/me', { token: teacher })).status).toBe(401);
    expect(await h.login(me.email, 'a-new-pass-123')).toBeTruthy();
  });
  it('sends one account at most five codes in fifteen minutes', async () => {
    expect((await h.call('POST', '/v1/students', { token: admin, body: { name: 'Ira Rao', classId: cls, dob: '2013-06-02', guardianName: 'Anil Rao', guardianPhone: '+91 90000 11122' } })).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/v1/auth/code', { body: { identifier: '90000 11122' } })).status).toBe(200);
    const sixth = await h.call('POST', '/v1/auth/code', { body: { identifier: '90000 11122' } });
    expect(sixth.status).toBe(429);
    expect(sixth.json.retryAfter).toBeGreaterThan(0);
    expect((await h.call('POST', '/v1/auth/reset/start', { body: { identifier: '90000 11122' } })).status).toBe(429);
  });
});

describe('what the console sets reaches families and the office', () => {
  it('records a family’s consent once, with the photo answer, and counts it in Moving in', async () => {
    expect((await f(parent, '/me')).json.consentedAt).toBeNull();
    const c = (await post(parent, '/consent', { photos: false })).json;
    expect(c.photoConsent).toBe(false);
    const again = (await post(parent, '/consent', {})).json;
    expect(again).toEqual(c);
    expect((await f(parent, '/me')).json).toMatchObject({ consentedAt: c.consentedAt, photoConsent: false });
    expect((await h.call('GET', '/v1/moving-in/activation', { token: admin })).json.families.consented).toBeGreaterThan(0);
  });
  it('shows the privacy notice and the grievance officer before sign-in', async () => {
    await h.setSettings({ 'privacy.notice': 'We keep marks for five years.', 'privacy.officerName': 'R. Kulkarni' });
    expect((await h.call('GET', '/v1/brand')).json.privacy).toMatchObject({ notice: 'We keep marks for five years.', officerName: 'R. Kulkarni' });
  });
  it('lets only the roles the console chose use the app; staff keep the admin', async () => {
    await h.setSettings({ 'app.roles': ['parent'] });
    try {
      const app = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.classTeacher.email, password: 'a-new-pass-123', client: 'mobile' } });
      expect(app.status).toBe(403);
      expect(app.json.message).toMatch(/admin on the web/);
      const web = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.classTeacher.email, password: 'a-new-pass-123', client: 'web' } });
      expect(web.status).toBe(200);
      await h.setSettings({ 'app.roles': ['teacher'] });
      // The code goes out; that the school keeps families off the app is said once the code proves the phone is theirs.
      const family = await h.call('POST', '/v1/auth/code', { body: { identifier: '99887 76655' } });
      expect(family.status).toBe(200);
      const signIn = await h.call('POST', '/v1/auth/verify', { body: { challengeId: family.json.challengeId, code: await h.codeSentTo('+919988776655'), client: 'mobile' } });
      expect(signIn.status).toBe(403);
    } finally {
      await h.setSettings({ 'app.roles': ['parent', 'teacher'] });
    }
  });
  it('lets the office record only the ways the school takes money', async () => {
    await h.setSettings({ 'fees.paymentMethods': ['cash'] });
    try {
      // Checked before the invoice is even looked up.
      const r = await h.call('POST', '/v1/fees/payments', { token: admin, body: { studentId: aarav, invoiceId: 'inv_any', amount: 1, method: 'upi' } });
      expect(r.status).toBe(400);
      expect(r.json.fields.method).toBeTruthy();
      // A school saved before methods had names is read as the methods it always had.
      expect((await h.call('GET', '/v1/shell', { token: admin })).json.school.paymentMethods).toEqual([{ key: 'cash', name: 'Cash', kind: 'cash' }]);
      await h.setSettings({ 'fees.paymentMethods': [{ key: 'mpesa', name: 'M-Pesa', kind: 'wallet' }] });
      expect((await h.call('POST', '/v1/fees/payments', { token: admin, body: { studentId: aarav, invoiceId: 'inv_any', amount: 1, method: 'cash' } })).status).toBe(400);
      expect((await h.call('POST', '/v1/fees/payments', { token: admin, body: { studentId: aarav, invoiceId: 'inv_any', amount: 1, method: 'mpesa' } })).status).toBe(404);
    } finally {
      await h.setSettings({ 'fees.paymentMethods': ['cash', 'upi', 'card', 'netbanking', 'cheque'] });
    }
  });
  it('names students the school’s way in the admin menu', async () => {
    await h.setSettings({ 'vocab.words': { en: { student: { one: 'Pupil' } } } });
    try {
      expect((await h.call('GET', '/v1/config', { token: admin })).json.menu.flatMap((g: { pages: { label: string }[] }) => g.pages.map((p) => p.label))).toContain('Pupils');
    } finally {
      await h.setSettings({ 'vocab.words': {} });
    }
  });
});

describe('the days a school is closed', () => {
  it('leaves the school’s weekly off days out of the attendance week', async () => {
    const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    await h.setSettings({ 'calendar.weeklyOff': ['sun'] });
    const sundays = (await h.call('GET', '/v1/attendance/week', { token: admin })).json as { date: string }[];
    expect(sundays.some((p) => weekday(p.date) === 6)).toBe(true);
    expect(sundays.some((p) => weekday(p.date) === 0)).toBe(false);
    await h.setSettings({ 'calendar.weeklyOff': ['sun', 'sat'] });
    try {
      const week = (await h.call('GET', '/v1/attendance/week', { token: admin })).json as { date: string }[];
      expect(week).toHaveLength(sundays.length);
      expect(week.some((p) => [0, 6].includes(weekday(p.date)))).toBe(false);
    } finally {
      await h.setSettings({ 'calendar.weeklyOff': [] });
    }
  });
});

describe('what each person may see on the dashboard', () => {
  it('gives a teacher no fee totals and no fee waivers, while the principal still has them', async () => {
    const res = await h.call('GET', '/v1/dashboard', { token: admin });
    expect(res.status, JSON.stringify(res.json).slice(0, 200)).toBe(200);
    const principal = res.json;
    expect(principal.modules).toContain('fees');
    // Mid-year, what families owe is past its date.
    expect(principal.fees.overdueFamilies).toBeGreaterThan(0);
    // A fresh sign-in: an earlier test reset this teacher's password, which ends her sessions.
    const fresh = await h.login(h.people.classTeacher.email, 'a-new-pass-123');
    const t = (await h.call('GET', '/v1/dashboard', { token: fresh })).json;
    expect(t.modules).not.toContain('fees');
    expect(t.modules).toContain('attendance');
    expect(t.fees).toMatchObject({ collected: 0, due: 0, overdueFamilies: 0 });
    expect(t.feeHeads).toEqual([]);
    expect(t.needsYou.some((n: { kind: string }) => n.kind === 'fee_waiver')).toBe(false);
  });
});

describe('messages and background work through the Hub', () => {
  const ist = (offsetMin: number) => { const d = new Date(Date.now() + 330 * 60_000 + offsetMin * 60_000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

  it('holds a non-urgent message in quiet hours and sends an urgent one', async () => {
    await h.setSettings({ 'notify.quietFrom': ist(-60), 'notify.quietTo': ist(60) });
    const n = await h.call('POST', '/v1/notices', { token: admin, body: { title: 'Held in quiet hours', body: 'Sports day is on Friday.', audience: 'everyone', publish: true } });
    expect(n.status).toBeLessThan(300);
    const held = (await h.registry.query("select status, send_after from message_log where message_key = 'notice.published' and body like '%Held in quiet hours%'")).rows;
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((m) => m.status === 'held' && m.send_after > new Date())).toBe(true);
    await h.setSettings({ 'notify.quietFrom': '00:00', 'notify.quietTo': '00:00' });
  });

  it('refuses texts past the plan’s monthly limit, never a sign-in code', async () => {
    const limits = (await h.registry.query("select entitlement->'limits' l from schools where slug = $1", [h.slug])).rows[0].l;
    await h.entitle({ limits: { ...limits, smsPerMonth: 1 } });
    const sent = await h.call('POST', '/v1/students/message', { token: admin, body: { ids: [aarav], body: 'Over the limit test' } });
    expect(sent.status).toBe(200);
    const row = (await h.registry.query("select status, error from message_log where body like 'Over the limit test%' and channel = 'sms'")).rows[0];
    expect(row).toMatchObject({ status: 'refused' });
    expect(row.error).toContain('texts are used up');
    await h.call('POST', '/v1/auth/code', { body: { identifier: h.people.parentOfTwo.phone } });
    expect((await h.registry.query("select status from message_log where message_key = 'auth.code' order by created_at desc limit 1")).rows[0].status).toBe('delivered');
    await h.entitle({ limits });
  });

  it('charges a late fine once per invoice and month from the daily job', async () => {
    const { HubService } = await import('../src/school/hub.service.js');
    const hub = h.app.get(HubService);
    await h.setSettings({ 'fees.lateFeePct': 5 });
    await h.registry.query('delete from job_queue');
    expect(await hub.queueDaily()).toBeGreaterThan(0);
    expect(await hub.queueDaily()).toBe(0);
    await h.registry.query('update job_queue set run_at = now()');
    for (let i = 0; i < 4; i++) await hub.tick();
    const jobs = (await h.registry.query("select kind, status, result, last_error from job_queue where kind = 'fees.lateFines'")).rows;
    expect(jobs[0]).toMatchObject({ status: 'done' });
    const count = Number(/(\d+) late fees/.exec(jobs[0].result)![1]);
    expect(count).toBeGreaterThan(0);
    await h.registry.query("update job_queue set status = 'queued', run_at = now(), payload = payload || '{\"again\":true}' where kind = 'fees.lateFines'");
    await hub.tick();
    expect((await h.registry.query("select result from job_queue where kind = 'fees.lateFines'")).rows[0].result).toMatch(/^0 late fees/);
  });

  it('queues each school’s morning jobs for 09:00 on its own clock and its own day (§3.9.9)', async () => {
    const { HubService } = await import('../src/school/hub.service.js');
    const hub = h.app.get(HubService);
    await h.addSchool('dubai-clock', { plan: 'premium', data: 'empty' });
    await h.registry.query("update schools set timezone = 'America/New_York' where slug = $1", [h.slug]);
    await h.registry.query("update schools set timezone = 'Asia/Dubai' where slug = 'dubai-clock'");
    await h.registry.query('delete from job_queue');
    // 06:00 UTC: 01:00 in New York (its 09:00 is still to come) and 10:00 in Dubai (its 09:00 has passed).
    const now = new Date('2026-11-17T06:00:00Z');
    await hub.queueDaily(now);
    const jobs = (await h.registry.query<{ slug: string; run_at: Date; day: string }>(
      "select s.slug, j.run_at, j.payload->>'day' as day from job_queue j join schools s on s.id = j.school_id where j.kind = 'fees.reminders'")).rows;
    const at = (slug: string) => jobs.find((j) => j.slug === slug)!;
    expect(at(h.slug)).toMatchObject({ day: '2026-11-17' });
    expect(at(h.slug).run_at.toISOString()).toBe('2026-11-17T14:00:00.000Z');
    expect(at('dubai-clock')).toMatchObject({ day: '2026-11-17' });
    expect(at('dubai-clock').run_at.toISOString()).toBe(now.toISOString());
    await h.registry.query("update schools set timezone = 'Asia/Kolkata' where slug = $1", [h.slug]);
    await h.registry.query('delete from job_queue');
  });

  it('opens a receipt outside the app from a signed link, only for the family’s own children', async () => {
    const t = (await h.app.get((await import('../src/tenancy/tenant.js')).TenantService).resolve(h.slug)).pool;
    const mine = (await t.query("select p.id from payments p join fee_invoices i on i.id = p.invoice_id where i.student_id = $1 limit 1", [aarav])).rows[0]?.id;
    const other = (await t.query("select p.id from payments p join fee_invoices i on i.id = p.invoice_id where i.student_id = $1 limit 1", [diya])).rows[0]?.id;
    expect(mine).toBeTruthy();
    const link = await post(parent, `/receipts/${mine}/link`);
    expect(link.status).toBe(200);
    const path = new URL(link.json.url).pathname;
    const pdf = await h.call('GET', path);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await h.call('GET', `${path}x`)).status).toBe(410);
    if (other) expect((await post(parent, `/receipts/${other}/link`)).status).toBe(404);
  });

  it('adds an event and a week of lessons to the phone’s calendar from a calendar file', async () => {
    const one = await post(parent, '/calendar/link', { events: [{ title: 'Sports day; bring water', start: '2026-12-04', details: 'Line 1\nLine 2', alarmMinutes: 60 }] });
    expect(one.status).toBe(200);
    const file = await h.call('GET', new URL(one.json.url).pathname);
    expect(file.headers['content-type']).toContain('text/calendar');
    expect(file.text).toContain('SUMMARY:Sports day\\; bring water');
    expect(file.text).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(file.text).toContain('DTSTART;VALUE=DATE:20261204');
    expect(file.text).toContain('TRIGGER:-PT60M');
    const week = await post(parent, '/timetable/calendar-link', { classId: cls });
    const lessons = (await h.call('GET', new URL(week.json.url).pathname)).text;
    expect(lessons).toMatch(/RRULE:FREQ=WEEKLY;UNTIL=\d{8}T235959Z/);
    expect(lessons).toMatch(/DTSTART;TZID=Asia\/Kolkata:\d{8}T\d{6}/);
    // A family cannot ask for another class's week.
    expect((await post(parent, '/timetable/calendar-link', { classId: await h.classId('8 B') })).status).toBe(403);
  });
});

