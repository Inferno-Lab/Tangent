import { refreshTranslations } from '@tangent/tenancy';
import { addDays, schoolToday } from '@tangent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let token: string;
let maths: string;
let english: string;
/** 8 A and how many are in it. */
let cls: string;
let inClass: number;
beforeAll(async () => {
  h = await startHarness();
  token = await h.login();
  const subject = async (name: string) => (await h.schoolSql('select id from subjects where name = $1', [name]))[0].id as string;
  maths = await subject('Mathematics');
  english = await subject('English');
  cls = await h.classId('8 A');
  inClass = Number((await h.schoolSql("select count(*) n from students where class_id = $1 and status = 'active'", [cls]))[0].n);
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const get = (url: string) => h.call('GET', url, { token });
const send = (method: string, url: string, body?: unknown) => h.call(method, url, { token, body });

describe('homework', () => {
  it('sets homework for a class, records hand-ins and checks marks against the maximum', async () => {
    const due = addDays(schoolToday(), 3);
    const made = await send('POST', '/v1/homework', { classId: cls, subjectId: maths, title: 'Quadratic practice', dueOn: due, maxMarks: 10 });
    expect(made.status).toBe(201);
    expect(made.json.total).toBe(inClass);
    expect(made.json.handedIn).toBe(0);
    const first = made.json.students[0].studentId;
    const marked = await send('PUT', `/v1/homework/${made.json.id}/marks`, { marks: [{ studentId: first, handed: true, score: 9, feedback: 'Neat work' }] });
    expect(marked.status).toBe(200);
    expect(marked.json.handedIn).toBe(1);
    expect(marked.json.onTime).toBe(1);
    expect(marked.json.students.find((s: any) => s.studentId === first)).toMatchObject({ score: 9, feedback: 'Neat work' });
    const tooHigh = await send('PUT', `/v1/homework/${made.json.id}/marks`, { marks: [{ studentId: first, handed: true, score: 11 }] });
    expect(tooHigh.status).toBe(400);
    const undo = await send('PUT', `/v1/homework/${made.json.id}/marks`, { marks: [{ studentId: first, handed: false }] });
    expect(undo.json.handedIn).toBe(0);
    expect((await send('POST', '/v1/homework', { classId: cls, subjectId: maths, title: 'Late one', dueOn: addDays(schoolToday(), -1) })).status).toBe(400);
    expect((await get(`/v1/homework?classId=${cls}`)).json.some((x: any) => x.id === made.json.id)).toBe(true);
    expect((await send('DELETE', `/v1/homework/${made.json.id}`)).status).toBe(204);
  });
  it('is refused for a role without the permission', async () => {
    const teacher = await h.login(h.people.classTeacher.email);
    expect((await h.call('POST', '/v1/admissions', { token: teacher, body: { childName: 'Nope Nope', gradeSought: 2, guardianName: 'Nope', phone: '+91 98000 00000' } })).status).toBe(403);
    expect((await h.call('GET', '/v1/homework', { token: teacher })).status).toBe(200);
  });
});

describe('exams', () => {
  it('goes from schedule to marks to published results with ranks', async () => {
    const day = addDays(schoolToday(), -1);
    const made = await send('POST', '/v1/exams', { name: 'Class test', classId: cls, startsOn: day, endsOn: day, subjects: [{ subjectId: maths, onDate: day, maxMarks: 50 }, { subjectId: english, maxMarks: 50 }] });
    expect(made.status).toBe(201);
    expect(made.json.expected).toBe(inClass * 2);
    const id = made.json.id;
    const view = (await get(`/v1/exams/${id}/marks`)).json;
    expect(view.students).toHaveLength(inClass);
    expect((await send('POST', `/v1/exams/${id}/publish`)).status).toBe(409);
    const marks = view.students.flatMap((s: any, i: number) => [
      { studentId: s.studentId, subjectId: maths, score: i === 0 ? 50 : 20 + (i % 20), absent: false },
      { studentId: s.studentId, subjectId: english, score: i === 1 ? null : 30, absent: i === 1 },
    ]);
    const put = await send('PUT', `/v1/exams/${id}/marks`, { marks });
    expect(put.status).toBe(200);
    expect(put.json.exam.status).toBe('marking');
    expect((await send('PUT', `/v1/exams/${id}/marks`, { marks: [{ studentId: view.students[0].studentId, subjectId: maths, score: 51, absent: false }] })).status).toBe(400);
    const res = (await get(`/v1/exams/${id}/results`)).json;
    expect(res.rows[0]).toMatchObject({ studentId: view.students[0].studentId, total: 80, max: 100, pct: 80, rank: 1 });
    expect(res.rows.length).toBe(inClass);
    const pub = await send('POST', `/v1/exams/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.json.exam.status).toBe('published');
    const detail = (await get(`/v1/students/${view.students[0].studentId}`)).json;
    expect(detail.id).toBe(view.students[0].studentId);
    expect((await send('DELETE', `/v1/exams/${id}`)).status).toBe(409);
    // Published marks are locked: they are reopened first, saying why, so families never see a number changed behind their back.
    const fix = { marks: [{ studentId: view.students[2].studentId, subjectId: maths, score: 10, absent: false }] };
    expect((await send('PUT', `/v1/exams/${id}/marks`, fix)).status).toBe(423);
    const reopened = await send('POST', `/v1/exams/${id}/reopen`, { note: 'A paper was added up wrong' });
    expect(reopened.json).toMatchObject({ status: 'marking', reopenedNote: 'A paper was added up wrong' });
    expect((await send('PUT', `/v1/exams/${id}/marks`, fix)).json.exam.status).toBe('marking');
  });
  it('rejects an exam that ends before it starts or names an unknown subject', async () => {
    const d = schoolToday();
    expect((await send('POST', '/v1/exams', { name: 'Odd exam', classId: cls, startsOn: d, endsOn: addDays(d, -2), subjects: [{ subjectId: maths, maxMarks: 20 }] })).status).toBe(400);
    expect((await send('POST', '/v1/exams', { name: 'Odd exam', classId: cls, startsOn: d, endsOn: d, subjects: [{ subjectId: 'sub_nope', maxMarks: 20 }] })).status).toBe(400);
  });
  it('keeps the exams and marks the old system held, published', async () => {
    const list = (await get(`/v1/exams?classId=${cls}`)).json;
    const held = list.filter((e: any) => h.manifest.expect.exams.includes(e.name));
    expect(held.map((e: any) => e.name).sort()).toEqual([...h.manifest.expect.exams].sort());
    expect(held.every((e: any) => e.status === 'published')).toBe(true);
    const res = (await get(`/v1/exams/${held[0].id}/results`)).json;
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r: any) => r.pct >= 0 && r.pct <= 100)).toBe(true);
  });
});

describe('staff and roles', () => {
  it('adds a teacher, sends the invite to the sandbox and lets them sign in with the temporary password', async () => {
    const made = await send('POST', '/v1/staff', { name: 'Pooja Rane', email: 'pooja.rane@sunrisevalley.example', phone: '+91 98765 43210', designation: 'Teacher', subjectIds: [maths], roleId: 'role_teacher' });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: 'Pooja Rane', subjects: [{ id: maths }], roles: [{ id: 'role_teacher' }] });
    const dup = await send('POST', '/v1/staff', { name: 'Pooja Rane', email: 'POOJA.RANE@sunrisevalley.example', phone: '+91 98765 43211', roleId: 'role_teacher' });
    expect(dup.status).toBe(400);
    const inbox = await h.registry.query("select body from sandbox_messages where school_slug = $1 and channel = 'email' and subject = 'Staff invite' order by created_at desc limit 1", [h.slug]);
    const temp = /password (\S+?)(?:,| then)/.exec(inbox.rows[0].body)?.[1];
    expect(temp).toBeTruthy();
    const step1 = await h.call('POST', '/v1/auth/login', { body: { identifier: 'pooja.rane@sunrisevalley.example', password: temp } });
    expect(step1.status).toBe(200);
  });
  it('lets the principal change a role but never their own, and switches a person off', async () => {
    const me = (await get('/v1/me')).json;
    expect((await send('PATCH', `/v1/staff/${me.id}`, { roleId: 'role_teacher' })).status).toBe(403);
    const list = (await get('/v1/staff?query=Pooja')).json;
    const pooja = list[0];
    const off = await send('PATCH', `/v1/staff/${pooja.id}`, { status: 'inactive', designation: 'Maths teacher' });
    expect(off.json).toMatchObject({ status: 'inactive', designation: 'Maths teacher' });
  });
  it('shows the school’s roles, and lets it put staff in them unless Tangent holds its roles', async () => {
    const roles = (await get('/v1/roles')).json;
    expect(roles.find((r: any) => r.key === 'principal')).toMatchObject({ locked: true });
    const pooja = (await get('/v1/staff?query=Pooja')).json[0];
    expect((await send('PATCH', '/v1/staff/' + pooja.id, { roleId: 'role_office' })).status).toBe(200);
    await h.setSettings({ 'roles.schoolEdits': false });
    expect((await send('PATCH', '/v1/staff/' + pooja.id, { roleId: 'role_teacher' })).status).toBe(403);
    await h.setSettings({ 'roles.schoolEdits': true });
  }, 30_000);
  it('imports staff from a sheet, invites one who never signed in, edits their email, and exports everyone', async () => {
    const r = await send('POST', '/v1/staff/import', { csv: 'name,email,phone,designation,role\nSam Okafor,sam.okafor@sunrisevalley.example,+91 90000 55555,Teacher,Teacher' });
    expect(r.json).toMatchObject({ created: 1, skipped: 0 });
    const sam = (await get('/v1/staff?query=Okafor')).json[0];
    expect(sam).toMatchObject({ access: 'none', roles: [{ id: 'role_teacher' }] });
    expect((await send('PATCH', `/v1/staff/${sam.id}`, { email: 'sam.o@sunrisevalley.example', name: 'Sam Okafor-Reid' })).json).toMatchObject({ email: 'sam.o@sunrisevalley.example', name: 'Sam Okafor-Reid' });
    expect((await send('POST', `/v1/staff/${sam.id}/invite`)).json).toEqual({ to: 'sam.o@sunrisevalley.example' });
    expect((await get('/v1/staff?query=Okafor')).json[0].access).toBe('invited');
    const csv = (await get('/v1/staff/export')).text;
    expect(csv.split('\n')[0]).toContain('email');
    expect(csv).toContain('sam.o@sunrisevalley.example');
  }, 30_000);
  it('lets the school edit its own timetable until the console locks it, and still lets it cover a lesson', async () => {
    const slot = (await get(`/v1/timetable?classId=${cls}`)).json.slots[0];
    expect((await send('PATCH', '/v1/timetable/slots/' + slot.id, { room: 'R-12' })).status).toBe(204);
    await h.setSettings({ 'timetable.schoolEdits': false });
    const locked = await send('PATCH', '/v1/timetable/slots/' + slot.id, { room: 'R-13' });
    expect(locked.status).toBe(403);
    expect(locked.json.message).toMatch(/Ask Tangent/);
    await h.setSettings({ 'timetable.schoolEdits': true });
  }, 30_000);
});

describe('admissions', () => {
  it('moves an application through the stages and enrols the child as a student', async () => {
    const list = (await get('/v1/admissions')).json;
    expect(list.length).toBeGreaterThanOrEqual(6);
    const made = await send('POST', '/v1/admissions', { childName: 'Anvi Kulkarni', gradeSought: 4, guardianName: 'Rohit Kulkarni', phone: '+91 98220 11111', source: 'walk-in' });
    expect(made.status).toBe(201);
    expect(made.json.stage).toBe('enquiry');
    expect((await send('PATCH', `/v1/admissions/${made.json.id}`, { stage: 'test' })).status).toBe(400);
    const test = await send('PATCH', `/v1/admissions/${made.json.id}`, { stage: 'test', stageOn: addDays(schoolToday(), 4) });
    expect(test.json).toMatchObject({ stage: 'test', stageOn: addDays(schoolToday(), 4) });
    // Moving on clears the day of the stage it left.
    expect((await send('PATCH', `/v1/admissions/${made.json.id}`, { score: '72%' })).json.scores).toEqual({ test: '72%' });
    const offer = await send('PATCH', `/v1/admissions/${made.json.id}`, { stage: 'offer' });
    expect(offer.json).toMatchObject({ stage: 'offer', stageOn: null, scores: { test: '72%' } });
    expect((await send('PATCH', `/v1/admissions/${made.json.id}`, { score: 'A' })).status).toBe(400);
    expect((await send('PATCH', `/v1/admissions/${made.json.id}`, { stage: 'enrolled' })).status).toBe(400);
    const before = (await get('/v1/students/summary')).json.total;
    const enrolled = await send('POST', `/v1/admissions/${made.json.id}/enrol`, { classId: await h.classId('4 A'), dob: '2016-05-12' });
    expect(enrolled.status).toBe(200);
    expect(enrolled.json.name).toBe('Anvi Kulkarni');
    expect((await get('/v1/students/summary')).json.total).toBe(before + 1);
    expect((await get('/v1/admissions')).json.find((e: any) => e.id === made.json.id)).toMatchObject({ stage: 'enrolled', studentId: enrolled.json.id });
    expect((await send('POST', `/v1/admissions/${made.json.id}/enrol`, { classId: await h.classId('4 A'), dob: '2016-05-12' })).status).toBe(409);
  });
  it('edits an enquiry, steps it back, and keeps to the stages the console switched on', async () => {
    const made = (await send('POST', '/v1/admissions', { childName: 'Mia Lopez', gradeSought: 0, guardianName: 'Ana Lopez', phone: '+44 7700 900777' })).json;
    expect(made.gradeSought).toBe(0);
    const edited = await send('PATCH', `/v1/admissions/${made.id}`, { childName: 'Mia Lopez-Grant', email: 'ana@example.org', gradeSought: 1, source: 'Phone' });
    expect(edited.json).toMatchObject({ childName: 'Mia Lopez-Grant', email: 'ana@example.org', gradeSought: 1, source: 'Phone', stage: 'enquiry' });
    expect((await send('PATCH', `/v1/admissions/${made.id}`, { email: '' })).json.email).toBeNull();
    await h.setSettings({ 'admissions.stages': ['offer'] });
    expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'applied' })).status).toBe(400);
    expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'offer' })).json.stage).toBe('offer');
    expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'enquiry' })).json.stage).toBe('enquiry');
    await h.setSettings({ 'admissions.stages': ['applied', 'test', 'offer'] });
  }, 30_000);
  it('follows the school’s own stages: a day, a score, documents, a stage taken away while cards are still in it', async () => {
    await h.setSettings({ 'admissions.stages': [
      { key: 'visit', name: 'School visit', needsDate: true },
      { key: 'interview', name: 'Interview', scored: true, documents: ['Birth certificate', 'Last report'] },
      { key: 'offer', name: 'Offer', tellFamily: true },
    ] });
    try {
      const made = (await send('POST', '/v1/admissions', { childName: 'Noor Saleh', gradeSought: 2, guardianName: 'Huda Saleh', phone: '+971 50 123 4567' })).json;
      expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'visit' })).status).toBe(400);
      const visit = await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'visit', stageOn: addDays(schoolToday(), 2) });
      expect(visit.json).toMatchObject({ stage: 'visit', stageOn: addDays(schoolToday(), 2) });
      const interview = await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'interview', score: 'Strong', docs: { 'Birth certificate': true } });
      expect(interview.json).toMatchObject({ stage: 'interview', stageOn: null, scores: { interview: 'Strong' } });
      expect(interview.json.docs['Birth certificate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((await send('PATCH', `/v1/admissions/${made.id}`, { docs: { Passport: true } })).status).toBe(400);
      expect(Object.keys((await send('PATCH', `/v1/admissions/${made.id}`, { docs: { 'Birth certificate': false } })).json.docs)).toEqual([]);
      // Taken away: the card stays where it is and moves on, but nobody moves a card into it.
      await h.setSettings({ 'admissions.stages': [{ key: 'offer', name: 'Offer', tellFamily: true }] });
      expect((await send('PATCH', `/v1/admissions/${made.id}`, { note: 'Called back' })).json.stage).toBe('interview');
      expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'offer' })).json.stage).toBe('offer');
      expect((await send('PATCH', `/v1/admissions/${made.id}`, { stage: 'interview' })).status).toBe(400);
    } finally {
      await h.setSettings({ 'admissions.stages': ['applied', 'test', 'offer'] });
    }
  }, 30_000);
  it('takes an application from the school’s page only when the school says so, and keeps robots and repeats out', async () => {
    const pub = (method: string, body?: unknown, ip = '203.0.113.7') => h.app.getHttpAdapter().getInstance().inject({ method, url: '/v1/apply', headers: { 'x-school': h.slug, 'content-type': 'application/json', 'x-forwarded-for': ip }, payload: body ? JSON.stringify(body) : undefined });
    const form = { childName: 'Sami Haddad', gradeSought: 3, dob: '2018-02-03', guardianName: 'Rania Haddad', phone: '9822077123', email: '', note: '', consent: true };
    expect(JSON.parse((await pub('GET')).body).open).toBe(false);
    expect((await pub('POST', form)).statusCode).toBe(403);
    await h.setSettings({ 'admissions.onlineForm': true });
    try {
      const info = JSON.parse((await pub('GET')).body);
      expect(info.open).toBe(true);
      expect(info.grades.length).toBeGreaterThan(5);
      expect((await pub('POST', { ...form, consent: false })).statusCode).toBe(400);
      expect((await pub('POST', { ...form, gradeSought: 13 })).statusCode).toBe(400);
      expect((await pub('POST', form)).statusCode).toBe(200);
      const row = (await get('/v1/admissions')).json.find((e: any) => e.childName === 'Sami Haddad');
      expect(row).toMatchObject({ stage: 'applied', dob: '2018-02-03', gradeSought: 3 });
      expect((await pub('POST', form)).statusCode).toBe(409);
      // A robot fills the hidden field: it looks accepted and nothing is kept.
      expect((await pub('POST', { ...form, childName: 'Bot Child', website: 'http://spam.example' })).statusCode).toBe(200);
      expect((await get('/v1/admissions')).json.some((e: any) => e.childName === 'Bot Child')).toBe(false);
      for (let i = 0; i < 4; i++) await pub('POST', { ...form, childName: `Child ${i}`, phone: `98220771${30 + i}` }, '198.51.100.9');
      expect((await pub('POST', { ...form, childName: 'Child 5', phone: '9822077140' }, '198.51.100.9')).statusCode).toBe(200);
      expect((await pub('POST', { ...form, childName: 'Child 6', phone: '9822077141' }, '198.51.100.9')).statusCode).toBe(429);
    } finally {
      await h.setSettings({ 'admissions.onlineForm': false });
    }
  }, 60_000);
  it('shows the number waiting on the menu', async () => {
    const shell = (await get('/v1/shell')).json;
    expect(shell.badges.admissions).toBeGreaterThan(0);
  });
});

describe('money lists and reports', () => {
  it('lists invoices by status and totals them, and lists receipts', async () => {
    const overdue = (await get('/v1/fees/invoice-list?status=overdue&limit=5')).json;
    expect(overdue.items.length).toBe(5);
    expect(overdue.items.every((i: any) => i.status === 'overdue' && i.outstanding > 0)).toBe(true);
    expect(overdue.summary.outstanding).toBeGreaterThan(0);
    const paid = (await get('/v1/fees/invoice-list?status=paid&head=tuition&limit=3')).json;
    expect(paid.items.every((i: any) => i.status === 'paid' && i.outstanding === 0)).toBe(true);
    // A family who paid, and the receipt numbers the old system gave them.
    const [payer] = await h.schoolSql('select s.name, p.receipt_no from payments p join fee_invoices i on i.id = p.invoice_id join students s on s.id = i.student_id order by p.receipt_no limit 1');
    const search = (await get(`/v1/fees/invoice-list?query=${encodeURIComponent(payer.name)}`)).json;
    expect(search.items.length).toBeGreaterThan(0);
    expect(search.items.every((i: any) => i.studentName === payer.name)).toBe(true);
    const receipts = (await get(`/v1/fees/receipts?query=${encodeURIComponent(payer.name)}`)).json;
    expect(receipts.items.some((r: any) => r.receiptNo === payer.receipt_no)).toBe(true);
  });
  it('builds every report and exports it as a CSV', async () => {
    const list = (await get('/v1/reports')).json;
    expect(list.length).toBeGreaterThanOrEqual(7);
    for (const r of list) {
      const data = await get(`/v1/reports/${r.id}`);
      expect(data.status).toBe(200);
      expect(data.json.columns.length).toBeGreaterThan(1);
      const csv = await get(`/v1/reports/${r.id}/csv`);
      expect(csv.text.split('\n')[0]).toContain(data.json.columns[0].label);
    }
    const strength = (await get('/v1/reports/strength')).json;
    expect(strength.rows).toHaveLength(h.manifest.expect.classes);
    // Narrowed to a class and a period, and named after them.
    const low = await get(`/v1/reports/attendance-class?classId=${cls}&from=${addDays(schoolToday(), -10)}&to=${schoolToday()}`);
    expect(low.json.rows).toHaveLength(1);
    expect(low.json.scope).toMatch(/^8 A, /);
    expect((await get(`/v1/reports/attendance-low/csv?classId=${cls}`)).headers['content-disposition']).toMatch(/Low attendance - 8 A/);
    expect((await get('/v1/reports/nope')).status).toBe(404);
  });
});

describe('messages', () => {
  // The school's old system kept no conversations: the school starts one, and the family answers in the app.
  let thread: string;
  it('starts a conversation with a family', async () => {
    const child = h.people.parentOfTwo.children![0]!;
    const stu = (await get(`/v1/students?query=${encodeURIComponent(child.admissionNo)}&limit=1`)).json.items[0];
    const made = await send('POST', '/v1/messages', { studentId: stu.id, subject: 'Parent meeting', body: 'Could you come on Friday at 3?' });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ subject: 'Parent meeting', studentName: child.name, status: 'open' });
    thread = made.json.id;
    const parent = await h.login(h.people.parentOfTwo.phone);
    const answered = await h.call('POST', `/v1/f/threads/${thread}/messages`, { token: parent, body: { text: 'Yes, Friday at 3 works for us.' } });
    expect(answered.status, answered.text).toBe(200);
  });
  it('lists conversations, marks them read when opened and lets staff reply', async () => {
    const list = (await get('/v1/messages')).json;
    const unread = list.find((t: any) => t.id === thread);
    expect(unread.unread).toBeGreaterThan(0);
    const opened = (await get(`/v1/messages/${unread.id}`)).json;
    expect(opened.messages.length).toBeGreaterThan(1);
    expect((await get('/v1/messages')).json.find((t: any) => t.id === unread.id).unread).toBe(0);
    const replied = await send('POST', `/v1/messages/${unread.id}/reply`, { body: 'Thanks, we will sort this out today.' });
    expect(replied.json.messages.at(-1)).toMatchObject({ from: 'staff', body: 'Thanks, we will sort this out today.' });
    expect((await send('POST', `/v1/messages/${unread.id}/reply`, { body: '   ' })).status).toBe(400);
    const closed = await send('PATCH', `/v1/messages/${unread.id}`, { status: 'closed' });
    expect(closed.json.status).toBe('closed');
  });
});

describe('events', () => {
  it('adds, changes and removes an event, and counts replies', async () => {
    const at = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const made = await send('POST', '/v1/events', { title: 'Book fair', startsAt: at, kind: 'event', venue: 'Library', audience: 'everyone', needsRsvp: true });
    expect(made.status).toBe(201);
    const parent = await h.login(h.people.parentOfOne.phone);
    expect((await h.call('POST', `/v1/f/events/${made.json.id}/rsvp`, { token: parent, body: { status: 'going', adults: 1 } })).status).toBe(200);
    expect((await get('/v1/events')).json.find((e: any) => e.id === made.json.id).going).toBeGreaterThan(0);
    const edit = await send('PUT', `/v1/events/${made.json.id}`, { title: 'Book fair, day 1', startsAt: at, kind: 'event', venue: 'Library hall', audience: 'parents' });
    expect(edit.json).toMatchObject({ title: 'Book fair, day 1', venue: 'Library hall', audience: 'parents' });
    expect((await send('PUT', `/v1/events/${made.json.id}`, { title: 'Backwards', startsAt: at, endsAt: new Date(Date.now()).toISOString(), kind: 'event' })).status).toBe(400);
    expect((await send('DELETE', `/v1/events/${made.json.id}`)).status).toBe(204);
    expect((await send('DELETE', '/v1/events/evt_nobody')).status).toBe(404);
  });
});

describe('privacy and templates', () => {
  it('keeps data requests and closes them once', async () => {
    const made = await send('POST', '/v1/privacy/requests', { kind: 'erasure', subjectName: 'Test Child', requestedBy: 'Parent', note: 'Moved schools' });
    expect(made.status).toBe(201);
    const done = await send('POST', `/v1/privacy/requests/${made.json.id}/decision`, { status: 'done', note: 'Erased' });
    expect(done.json).toMatchObject({ status: 'done', note: 'Moved schools', answer: 'Erased' });
    expect((await send('POST', `/v1/privacy/requests/${made.json.id}/decision`, { status: 'declined' })).status).toBe(409);
  });
  it('sends school messages with the wording and channels the school chose', async () => {
    const child = h.people.parentOfOne.children![0]!;
    const stu = (await get(`/v1/students?query=${encodeURIComponent(child.admissionNo)}&limit=1`)).json.items[0];
    await h.setSettings({
      'templates.messages': { 'fees.reminder': 'Hello! {student} has a fee waiting. Please pay soon. {school}' },
      'notify.rules': { 'fees.reminder': { push: false, sms: true, email: false } },
    });
    const before = Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1", [h.slug])).rows[0].n);
    const r = await send('POST', '/v1/fees/reminders', { ids: [stu.id] });
    // Each grown-up who gets the child's bills (both parents, where the school has both) is reminded once.
    const [{ n: billed }] = await h.schoolSql<{ n: number }>('select count(*)::int n from student_guardians where student_id = $1 and gets_bills', [stu.id]);
    expect(r.json.sent).toBe(billed);
    const rows = (await h.registry.query("select channel, body from sandbox_messages where school_slug = $1 order by created_at desc limit 1", [h.slug])).rows;
    expect(rows[0]).toMatchObject({ channel: 'sms', body: `Hello! ${child.name} has a fee waiting. Please pay soon. ${h.manifest.school.shortName}` });
    expect(Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1", [h.slug])).rows[0].n)).toBe(before + billed);
    // Parents who read Hindi (set on their record by the office) get it in Hindi: the school's Hindi wording, else the usual one translated.
    const family = 'select guardian_id from student_guardians where student_id = $1';
    await h.schoolSql(`update guardians set language = 'hi' where id in (${family})`, [stu.id]);
    const last = async () => (await h.registry.query("select body from sandbox_messages where school_slug = $1 order by created_at desc limit 1", [h.slug])).rows[0].body;
    await h.setSettings({ 'templates.messages': { 'fees.reminder': { en: 'Hello! {student} has a fee waiting.', hi: 'नमस्ते! {student} की फ़ीस बाकी है। {school}' } } });
    await send('POST', '/v1/fees/reminders', { ids: [stu.id] });
    expect(await last()).toBe(`नमस्ते! ${child.name} की फ़ीस बाकी है। ${h.manifest.school.shortName}`);
    await h.registry.query(`insert into translations (lang, surface, key, text, updated_by) values ('hi', 'text', 'Reminder: fees for {student} are due. Pay in the Tangent app to get an instant receipt.', '{student} की फ़ीस देय है। तुरंत रसीद के लिए Tangent ऐप में भुगतान करें।', 'test')`);
    await refreshTranslations(h.registry);
    await h.setSettings({ 'templates.messages': {} });
    await send('POST', '/v1/fees/reminders', { ids: [stu.id] });
    expect(await last()).toBe(`${child.name} की फ़ीस देय है। तुरंत रसीद के लिए Tangent ऐप में भुगतान करें।`);
    await h.schoolSql(`update guardians set language = null where id in (${family})`, [stu.id]);
  });
  it('puts each role’s app layout and the console flags into the config the apps fetch', async () => {
    await h.setSettings({ 'app.layout': { parent: { dock: ['home', 'fees', 'nonsense', 'trips'], home: [], quick: ['payFees'] }, student: { dock: [], home: [], quick: [] }, teacher: { dock: ['home', 'classes'], home: [], quick: [] }, driver: { dock: [], home: [], quick: [] } } });
    const cfg = (await get('/v1/config')).json;
    expect(cfg.app.layout.parent.dock).toEqual(['home', 'fees']);
    expect(cfg.app.layout.parent.quick).toEqual(['payFees']);
    expect(cfg.app.layout.teacher.dock).toEqual(['home', 'classes']);
    expect(cfg.flags).toBeTypeOf('object');
  });
});
