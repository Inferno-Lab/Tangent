import { addDays, schoolToday } from '@tangent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_PASSWORD, startHarness, type Harness, type Person } from './harness.js';

let h: Harness;
let token: string;
beforeAll(async () => {
  h = await startHarness();
  token = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

describe('sign-in', () => {
  // The school asks for a code after the password (the test school starts with it off, so other tests sign in in one call).
  beforeAll(() => h.setSettings({ 'security.twoFactor': true }));
  afterAll(() => h.setSettings({ 'security.twoFactor': false }));
  /** The password, then the code that reached the person's phone, as they would. */
  const signIn = async (p: Person, client?: 'web') => {
    const step1 = await h.call('POST', '/v1/auth/login', { body: { identifier: p.email, password: STAFF_PASSWORD, client } });
    expect(step1.json.step).toBe('otp');
    return h.call('POST', '/v1/auth/verify', { body: { challengeId: step1.json.challenge.challengeId, code: await h.codeSentTo(p.phone!), client } });
  };

  it('refuses a wrong password and says how many tries are left', async () => {
    const r = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.principal.email, password: 'nope' } });
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ code: 'unauthenticated', attemptsLeft: 4, fields: { password: expect.any(String) } });
  });
  it('locks the account after five wrong passwords', async () => {
    let last: { status: number; json: any } | undefined;
    for (let i = 0; i < 5; i++) last = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.driver.email, password: 'wrong' } });
    expect(last!.status).toBe(423);
    expect(last!.json.code).toBe('locked');
    const again = await h.call('POST', '/v1/auth/login', { body: { identifier: h.people.driver.email, password: STAFF_PASSWORD } });
    expect(again.status).toBe(423);
  });
  it('does not reveal whether an account exists', async () => {
    const r = await h.call('POST', '/v1/auth/login', { body: { identifier: 'nobody@nowhere.test', password: 'x' } });
    expect(r.status).toBe(401);
    expect(r.json.fields.identifier).toBeDefined();
  });
  it('sends a code to the phone, refuses a wrong one, and takes the one it sent', async () => {
    const p = h.people.principal;
    const step1 = await h.call('POST', '/v1/auth/login', { body: { identifier: p.email, password: STAFF_PASSWORD } });
    expect(step1.json.step).toBe('otp');
    expect(step1.json.challenge).toMatchObject({ channel: 'sms', maskedTo: expect.stringContaining('•') });
    expect(step1.json.challenge.demoCode).toBeUndefined();
    const code = await h.codeSentTo(p.phone!);
    const bad = await h.call('POST', '/v1/auth/verify', { body: { challengeId: step1.json.challenge.challengeId, code: code === '111111' ? '222222' : '111111' } });
    expect(bad.status).toBe(401);
    expect(bad.json.attemptsLeft).toBe(2);
    const ok = await h.call('POST', '/v1/auth/verify', { body: { challengeId: step1.json.challenge.challengeId, code } });
    expect(ok.status).toBe(200);
    expect(ok.json.user.roles).toContain('principal');
  });
  it('rotates refresh tokens and ends every session when an old one is replayed', async () => {
    const t1 = (await signIn(h.people.vicePrincipal)).json;
    const t2 = (await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: t1.refreshToken } })).json;
    expect(t2.refreshToken).not.toBe(t1.refreshToken);
    const replay = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: t1.refreshToken } });
    expect(replay.status).toBe(401);
    const afterReplay = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: t2.refreshToken } });
    expect(afterReplay.status).toBe(401);
    const audit = (await h.call('GET', '/v1/settings/audit', { token })).json as { action: string }[];
    expect(audit.some((a) => a.action === 'auth.refresh_replayed')).toBe(true);
  });
  it('keeps the web refresh token in an httpOnly cookie and checks CSRF', async () => {
    const verified = await signIn(h.people.principal, 'web');
    expect(verified.status).toBe(200);
    expect(verified.json.refreshToken).toBeUndefined();
    const rt = Object.keys(verified.cookies).find((k) => k.startsWith('gd_rt_'))!;
    expect(verified.cookies[rt]).toBeTruthy();
    expect(verified.cookies.gd_csrf).toBeTruthy();
    const noCsrf = await h.call('POST', '/v1/auth/refresh', { body: { client: 'web' }, cookies: { [rt]: verified.cookies[rt]!, gd_csrf: verified.cookies.gd_csrf! } });
    expect(noCsrf.status).toBe(401);
    const ok = await h.call('POST', '/v1/auth/refresh', {
      body: { client: 'web' },
      cookies: { [rt]: verified.cookies[rt]!, gd_csrf: verified.cookies.gd_csrf! },
      headers: { 'x-csrf': verified.cookies.gd_csrf!, origin: 'http://localhost:5173' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.accessToken).toBeTruthy();
    expect(ok.json.refreshToken).toBeUndefined();
  });
  it('stops using an access token once the session is revoked', async () => {
    const pair = (await signIn(h.people.office)).json;
    expect((await h.call('GET', '/v1/me', { token: pair.accessToken })).status).toBe(200);
    expect((await h.call('POST', '/v1/auth/logout', { token: pair.accessToken })).status).toBe(204);
    expect((await h.call('GET', '/v1/me', { token: pair.accessToken })).status).toBe(401);
  });
  it('logout-all ends every session for that person', async () => {
    const t1 = (await signIn(h.people.office)).json.accessToken as string;
    const t2 = (await signIn(h.people.office)).json.accessToken as string;
    expect((await h.call('POST', '/v1/auth/logout-all', { token: t1 })).status).toBe(204);
    expect((await h.call('GET', '/v1/me', { token: t1 })).status).toBe(401);
    expect((await h.call('GET', '/v1/me', { token: t2 })).status).toBe(401);
  });
  it('a role change ends that person’s access token', async () => {
    const p = h.people.mathsTeacher;
    const teacherTok = (await signIn(p)).json.accessToken as string;
    expect((await h.call('GET', '/v1/me', { token: teacherTok })).status).toBe(200);
    const staff = (await h.call('GET', `/v1/staff?query=${encodeURIComponent(p.name.split(' ')[0]!)}`, { token })).json as { id: string; name: string; roles: { id: string }[] }[];
    const person = staff.find((s) => s.name === p.name && s.roles.length);
    expect(person).toBeTruthy();
    const patched = await h.call('PATCH', `/v1/staff/${person!.id}`, { token, body: { roleId: person!.roles[0]!.id } });
    expect(patched.status).toBe(200);
    expect((await h.call('GET', '/v1/me', { token: teacherTok })).status).toBe(401);
  });
  it('sends security headers', async () => {
    const r = await h.call('GET', '/v1/brand');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(String(r.headers['content-security-policy'] ?? '')).toMatch(/frame-ancestors 'none'/);
    expect(String(r.headers['permissions-policy'] ?? '')).toMatch(/camera=\(\)/);
  });
  it('needs a known school and a token', async () => {
    expect((await h.call('GET', '/v1/me', { school: 'no-such-school' })).status).toBe(404);
    expect((await h.call('GET', '/v1/me')).status).toBe(401);
    expect((await h.call('GET', '/v1/me', { token: 'garbage' })).status).toBe(401);
  });
});

describe('students', () => {
  let cls8a: string;
  let inClass: number;
  beforeAll(async () => {
    cls8a = await h.classId('8 A');
    inClass = Number((await h.schoolSql("select count(*) n from students where class_id = $1 and status = 'active'", [cls8a]))[0].n);
  });
  it('lists with fees, ticks and paging', async () => {
    const r = await h.call('GET', `/v1/students?classId=${cls8a}&limit=10`, { token });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(inClass);
    expect(r.json.items).toHaveLength(10);
    expect(r.json.items[0].attendance10).toHaveLength(10);
  });
  it('filters by fee status and by search', async () => {
    // Families who paid late or not at all, as the fee register brought them in.
    const over = await h.call('GET', '/v1/students?feeStatus=overdue&limit=100', { token });
    expect(over.json.total).toBeGreaterThan(0);
    expect(over.json.items.every((s: any) => s.amountDue > 0)).toBe(true);
    const [one] = await h.schoolSql("select admission_no, name from students where status = 'active' order by admission_no limit 1");
    const found = await h.call('GET', `/v1/students?query=${encodeURIComponent(one.admission_no)}`, { token });
    expect(found.json.items.map((s: any) => s.name)).toEqual([one.name]);
    const none = await h.call('GET', '/v1/students?query=zzzzqq', { token });
    expect(none.json.total).toBe(0);
  });
  it('treats search text as text, not as SQL or wildcards', async () => {
    const r = await h.call('GET', "/v1/students?query=%25' or 1=1 --", { token });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(0);
  });
  it('summarises a class', async () => {
    const s = (await h.call('GET', `/v1/students/summary?classId=${cls8a}`, { token })).json;
    expect(s).toMatchObject({ inView: inClass, total: h.manifest.expect.students, overdueAmount: expect.any(Number), overdueFamilies: expect.any(Number) });
    expect(s.presentToday).toBeLessThanOrEqual(inClass);
  });
  it('hides the guardian number until it is revealed, and logs the reveal', async () => {
    const [rider] = await h.schoolSql("select s.id, r.name route from transport_assignments a join students s on s.id = a.student_id join transport_routes r on r.id = a.route_id where s.status = 'active' order by s.admission_no limit 1");
    const d = (await h.call('GET', `/v1/students/${rider.id}`, { token })).json;
    expect(d.guardianPhone).toContain('•');
    const rev = (await h.call('POST', `/v1/students/${rider.id}/reveal`, { token })).json;
    expect(rev.phone).not.toContain('•');
    const audit = (await h.call('GET', '/v1/settings/audit', { token })).json;
    expect(audit.some((a: any) => a.action === 'contact.revealed')).toBe(true);
    expect(d.routeName).toBe(rider.route);
  });
  it('adds a student and refuses a bad class', async () => {
    const bad = await h.call('POST', '/v1/students', { token, body: { name: 'Test Child', classId: 'nope', dob: '2014-01-02', guardianName: 'Parent One', guardianPhone: '+91 99999 11111' } });
    expect(bad.status).toBe(400);
    const ok = await h.call('POST', '/v1/students', { token, body: { name: 'Test Child', classId: cls8a, dob: '2014-01-02', guardianName: 'Parent One', guardianPhone: '+91 99999 11111' } });
    expect(ok.status).toBe(201);
    expect(ok.json.admissionNo).toBeTruthy();
  });
  it('imports a CSV and reports bad lines instead of failing the lot', async () => {
    const csv = 'name,class,dob,guardian,phone\nImport One,8 A,2013-02-03,Guardian A,+91 98888 00001\n,8 A,2013-02-03,G,+91 98888 00002\nImport Two,99 Z,2013-02-03,G,+91 98888 00003';
    const r = (await h.call('POST', '/v1/students/import', { token, body: { csv } })).json;
    expect(r.created).toBe(1);
    expect(r.errors.map((e: any) => e.line)).toEqual([3, 4]);
  });
  it('exports the chosen students as CSV', async () => {
    const two = await h.schoolSql("select id, name from students where status = 'active' order by admission_no limit 2");
    const r = await h.call('GET', `/v1/students/export?ids=${two.map((x) => x.id).join(',')}`, { token });
    expect(r.text.trim().split('\n')).toHaveLength(3);
    expect(r.text).toContain(two[0].name);
  });
});

describe('a student’s record', () => {
  it('edits a student, moves them to a class, and keeps every guardian with who may collect', async () => {
    const made = await h.call('POST', '/v1/students', { token, body: { name: 'Record Test', classId: await h.classId('8 A'), dob: '2013-02-01', guardianName: 'Pat Test', guardianPhone: '9822099001', gender: 'female' } });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ gender: 'female', guardians: [expect.objectContaining({ name: 'Pat Test', isPrimary: true, canCollect: true })] });
    const moved = await h.call('PATCH', `/v1/students/${made.json.id}`, { token, body: { classId: await h.classId('8 B'), house: '', bloodGroup: 'O+' } });
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ bloodGroup: 'O+' });
    expect(moved.json.className).toMatch(/8 B/);
    const first = moved.json.guardians[0];
    const g = await h.call('PUT', `/v1/students/${made.json.id}/guardians`, { token, body: { guardians: [
      { id: first.id, name: 'Pat Test', phone: first.phone, email: '', relation: 'Mother', canCollect: true, isPrimary: false },
      { name: 'Sam Test', phone: '9822099002', email: 'sam@example.com', relation: 'Father', canCollect: false, isPrimary: true },
    ] } });
    expect(g.status).toBe(200);
    expect(g.json).toEqual([expect.objectContaining({ name: 'Sam Test', isPrimary: true, canCollect: false }), expect.objectContaining({ name: 'Pat Test', relation: 'mother', isPrimary: false })]);
    // Gender, blood group and relations come from the school's lists: a word not on them is refused.
    expect((await h.call('PATCH', `/v1/students/${made.json.id}`, { token, body: { gender: 'robot' } })).status).toBe(400);
    expect((await h.call('PUT', `/v1/students/${made.json.id}/guardians`, { token, body: { guardians: [{ name: 'Sam Test', phone: '9822099002', relation: 'Neighbour', canCollect: true, isPrimary: true }] } })).status).toBe(400);
    expect((await h.call('PUT', `/v1/students/${made.json.id}/guardians`, { token, body: { guardians: [{ name: 'No One', phone: '9822099003', relation: 'Aunt', canCollect: true, isPrimary: false }] } })).status).toBe(400);
    await h.setSettings({ 'students.required': ['address'] });
    expect((await h.call('PATCH', `/v1/students/${made.json.id}`, { token, body: { address: '' } })).status).toBe(400);
    await h.setSettings({ 'students.required': [] });
  });
});

describe('access', () => {
  it('stops a teacher from opening fees or settings', async () => {
    const tt = await h.login(h.people.classTeacher.email);
    expect((await h.call('GET', '/v1/fees/summary', { token: tt })).status).toBe(403);
    // Someone without the right to change settings cannot, whatever they send.
    expect((await h.call('PATCH', '/v1/settings', { token: tt, body: { expectedVersion: 1, changes: { 'school.name': 'Hacked school' } } })).status).toBe(403);
    expect((await h.call('GET', '/v1/students?limit=2', { token: tt })).status).toBe(200);
  });
  it('closes modules the plan does not include', async () => {
    await h.addSchool('starter-school', { plan: 'starter', data: 'empty' });
    const s1 = await h.call('POST', '/v1/auth/login', { school: 'starter-school', body: { identifier: 'asha.rao@lakeside.example', password: STAFF_PASSWORD } });
    const t = s1.json.tokens.accessToken as string;
    const r = await h.call('GET', '/v1/fees/summary', { school: 'starter-school', token: t });
    expect(r.status).toBe(423);
    expect(r.json.code).toBe('locked');
    expect((await h.call('GET', '/v1/config', { school: 'starter-school', token: t })).json.modules).not.toContain('fees');
  });
  it('does not accept one school’s token at another school', async () => {
    const r = await h.call('GET', '/v1/me', { school: 'starter-school', token });
    expect(r.status).toBe(401);
  });
  it('blocks a school that is not live', async () => {
    await h.addSchool('paused-school', { plan: 'standard', data: 'empty', status: 'suspended' });
    const r = await h.call('GET', '/v1/brand', { school: 'paused-school' });
    expect(r.status).toBe(503);
  });
});

describe('dashboard and approvals', () => {
  // What waits for the principal is asked for by the staff who ask for it: a teacher's leave, the accounts office's
  // concession, and a notice a teacher may not publish alone.
  let waiver: { approval: string; studentId: string; amount: number };
  let notice: { approval: string; id: string };
  beforeAll(async () => {
    // The console lets this school's teachers write to their classes (the starting roles do not): their notices wait for the principal.
    await h.schoolSql(`update roles set permissions = permissions || '["notices.write"]' where key = 'teacher'`);
    const teacher = await h.login(h.people.classTeacher.email);
    const accounts = await h.login(h.people.accountant.email);
    const day = await h.openDay(30);
    const leave = await h.call('POST', '/v1/f/staff/leave', { token: teacher, body: { type: 'casual', from: day, to: day, reason: 'A family wedding', halfDay: null } });
    expect(leave.status, leave.text).toBe(200);
    const inv = (await h.call('GET', '/v1/fees/invoice-list?status=overdue&limit=1', { token: accounts })).json.items[0];
    const asked = await h.call('POST', `/v1/fees/invoice/${inv.id}/waive`, { token: accounts, body: { amount: 500, reason: 'Sibling concession' } });
    expect(asked.status, asked.text).toBe(200);
    const waiting = (await h.call('GET', '/v1/approvals', { token })).json;
    waiver = { approval: waiting.find((a: any) => a.kind === 'fee_waiver' && a.title.startsWith('Waive ₹500')).id, studentId: inv.studentId, amount: 500 };
    const posted = await h.call('POST', '/v1/notices', { token: teacher, body: { title: 'Class 8 A picnic', body: 'Class 8 A goes to Lalbagh on Friday. Bring water and a cap.', audience: 'class', classId: await h.classId('8 A'), publish: true } });
    expect(posted.status, posted.text).toBe(201);
    const pending = (await h.call('GET', '/v1/approvals', { token })).json.find((a: any) => a.kind === 'notice' && a.title.includes('picnic'));
    notice = { approval: pending.id, id: posted.json.id };
  });

  it('builds the dashboard from real data', async () => {
    // The school's own week (closed on Sundays): its day at school is the last school day.
    await h.setSettings({ 'calendar.weeklyOff': ['sun'] });
    const d = (await h.call('GET', '/v1/dashboard', { token })).json;
    await h.setSettings({ 'calendar.weeklyOff': [] });
    expect(d.greetingName).toBe(h.people.principal.name);
    expect(d.present.total).toBeGreaterThanOrEqual(h.manifest.expect.students);
    expect(d.charts.attendance.points).toHaveLength(6);
    expect(d.feeHeads.length).toBeGreaterThan(0);
    // Whether today's registers are in yet depends on the hour, so only the order of the requests is checked.
    expect(d.needsYou.map((n: any) => n.kind).filter((k: string) => k !== 'attendance')).toEqual(['staff_leave', 'fee_waiver', 'notice']);
    // The day's events: the school's files bring no events, so its day is empty until it adds one.
    expect(d.timeline).toEqual([]);
  });
  it('approves, then undoes, a concession and applies it to the invoice', async () => {
    const before = (await h.call('GET', '/v1/fees/invoices?studentId=' + waiver.studentId, { token })).json;
    const ok = await h.call('POST', `/v1/approvals/${waiver.approval}/decision`, { token, body: { decision: 'approve' } });
    expect(ok.status, ok.text).toBe(200);
    const after = (await h.call('GET', '/v1/fees/invoices?studentId=' + waiver.studentId, { token })).json;
    const total = (list: any[]) => list.reduce((a, i) => a + i.amount, 0);
    expect(total(after)).toBe(total(before) - waiver.amount);
    expect((await h.call('POST', `/v1/approvals/${waiver.approval}/decision`, { token, body: { decision: 'approve' } })).status).toBe(409);
    await h.call('POST', `/v1/approvals/${waiver.approval}/decision`, { token, body: { decision: 'undo' } });
    const back = (await h.call('GET', '/v1/fees/invoices?studentId=' + waiver.studentId, { token })).json;
    expect(back.map((i: any) => i.amount)).toEqual(before.map((i: any) => i.amount));
  });
  it('publishes a notice when its approval is accepted and takes it back on undo', async () => {
    await h.call('POST', `/v1/approvals/${notice.approval}/decision`, { token, body: { decision: 'approve' } });
    let notices = (await h.call('GET', '/v1/notices', { token })).json;
    expect(notices.find((n: any) => n.id === notice.id).status).toBe('published');
    await h.call('POST', `/v1/approvals/${notice.approval}/decision`, { token, body: { decision: 'undo' } });
    notices = (await h.call('GET', '/v1/notices', { token })).json;
    expect(notices.find((n: any) => n.id === notice.id).status).toBe('pending');
  });
});

describe('attendance and fees', () => {
  it('marks a class, refuses the future, and notifies guardians of absences', async () => {
    const date = schoolToday();
    const cls = await h.classId('6 A');
    const day = (await h.call('GET', `/v1/attendance/day?classId=${cls}&date=${date}`, { token })).json;
    expect(day.marks.length).toBeGreaterThan(30);
    const marks = day.marks.map((m: any, i: number) => ({ studentId: m.studentId, status: i === 0 ? 'absent' : 'present' }));
    const put = await h.call('PUT', '/v1/attendance/day', { token, body: { classId: cls, date, marks } });
    expect(put.status).toBe(200);
    expect(put.json.marks.filter((m: any) => m.status === 'absent')).toHaveLength(1);
    const future = await h.call('PUT', '/v1/attendance/day', { token, body: { classId: cls, date: '2099-01-01', marks } });
    expect(future.status).toBe(400);
    // Each of the absent child's guardians who gets the school's messages hears, and no one else.
    const [{ n: guardians }] = await h.schoolSql<{ n: number }>('select count(*)::int n from student_guardians where student_id = $1 and gets_messages', [marks[0].studentId]);
    const msgs = await h.registry.query("select count(distinct to_addr)::int n from sandbox_messages where school_slug = $1 and body like '%marked absent%'", [h.slug]);
    expect(msgs.rows[0].n).toBe(guardians);
  });
  it('records a payment once and refuses more than is due', async () => {
    // Mid-year, what is owed is past its date: a family settles a quarter it is late with.
    const inv = (await h.call('GET', '/v1/fees/invoice-list?status=overdue&limit=5', { token })).json.items.find((i: any) => i.paid === 0);
    const sid = inv.studentId;
    const tooMuch = await h.call('POST', '/v1/fees/payments', { token, body: { studentId: sid, invoiceId: inv.id, amount: inv.outstanding + 1, method: 'upi' } });
    expect(tooMuch.status).toBe(400);
    const ok = await h.call('POST', '/v1/fees/payments', { token, body: { studentId: sid, invoiceId: inv.id, amount: inv.outstanding, method: 'cash' } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.receiptNo).toMatch(/^RCPT-/);
    const again = await h.call('POST', '/v1/fees/payments', { token, body: { studentId: sid, invoiceId: inv.id, amount: 1, method: 'cash' } });
    expect(again.status).toBe(409);
  });
});

describe('an invoice', () => {
  it('opens with its payments, and a waiver or a receipt cancellation waits for someone else in Approvals', async () => {
    const list = (await h.call('GET', '/v1/fees/invoice-list?status=overdue&limit=5', { token })).json;
    const id = list.items[1].id;
    const inv = (await h.call('GET', `/v1/fees/invoice/${id}`, { token })).json;
    expect(inv).toMatchObject({ id, outstanding: expect.any(Number), payments: expect.any(Array), pending: null });
    expect((await h.call('POST', `/v1/fees/invoice/${id}/waive`, { token, body: { amount: inv.outstanding + 1, reason: 'Too much' } })).status).toBe(400);
    const asked = await h.call('POST', `/v1/fees/invoice/${id}/waive`, { token, body: { amount: 100, reason: 'Sibling concession' } });
    expect(asked.status).toBe(200);
    expect(asked.json.pending.title).toMatch(/Waive ₹100/);
    expect((await h.call('POST', `/v1/fees/invoice/${id}/waive`, { token, body: { amount: 50, reason: 'Again' } })).status).toBe(409);
    const mine = (await h.call('GET', '/v1/approvals?view=sent&kind=fee_waiver', { token })).json.find((a: any) => a.title.includes('Waive ₹100'));
    expect((await h.call('POST', `/v1/approvals/${mine.id}/decision`, { token, body: { decision: 'approve' } })).status).toBe(403);
    expect((await h.call('GET', '/v1/fees/receipts?limit=5', { token })).json).toMatchObject({ items: expect.any(Array), total: expect.any(Number) });
  });
});

describe('the library desk', () => {
  it('lends a book, renews it, and takes it back lost with the cost on the family’s fees; a cancelled reservation says why', async () => {
    const view = (await h.call('GET', '/v1/library', { token })).json;
    const book = view.books.find((b: any) => b.copies - b.out > 1);
    const [reader] = await h.schoolSql("select id from students where status = 'active' and id not in (select student_id from library_loans where returned_on is null) order by admission_no limit 1");
    const loan = await h.call('POST', '/v1/library/loans', { token, body: { bookId: book.id, studentId: reader.id } });
    expect(loan.status).toBe(200);
    const renewed = await h.call('POST', `/v1/library/loans/${loan.json.id}/renew`, { token });
    expect(renewed.json.dueOn > loan.json.dueOn).toBe(true);
    expect((await h.call('POST', `/v1/library/loans/${loan.json.id}/return`, { token, body: { outcome: 'lost', charge: 300, fine: 'waive', reason: '' } })).status).toBe(400);
    const back = await h.call('POST', `/v1/library/loans/${loan.json.id}/return`, { token, body: { outcome: 'lost', charge: 300, fine: 'bill' } });
    expect(back.json).toEqual({ fine: 300, billed: true });
    expect((await h.call('GET', '/v1/library', { token })).json.books.find((b: any) => b.id === book.id).copies).toBe(book.copies - 1);
    const inv = (await h.call('GET', `/v1/fees/invoice-list?query=${encodeURIComponent('Lost book')}`, { token })).json;
    expect(inv.items.some((i: any) => i.amount === 300)).toBe(true);
    const r = view.reservations[0];
    if (r) {
      expect((await h.call('POST', `/v1/library/reservations/${r.id}/cancel`, { token, body: { reason: '' } })).status).toBe(400);
      expect((await h.call('POST', `/v1/library/reservations/${r.id}/cancel`, { token, body: { reason: 'The book was lost' } })).status).toBe(204);
    }
  });
});

describe('timetable', () => {
  let cls8a: string;
  let cls8b: string;
  beforeAll(async () => { cls8a = await h.classId('8 A'); cls8b = await h.classId('8 B'); });

  it('shows the clash, fixes it with a cover, then publishes', async () => {
    // aSc brought in a clash-free week; a teacher written into two classes at once, as another system's file can, makes one.
    const [a] = await h.schoolSql('select s.day, s.period, s.teacher_id, u.name from timetable_slots s join users u on u.id = s.teacher_id where s.class_id = $1 order by s.day, s.period limit 1', [cls8a]);
    await h.schoolSql('update timetable_slots set teacher_id = $3, published_teacher_id = $3 where class_id = $1 and day = $2 and period = $4', [cls8b, a.day, a.teacher_id, a.period]);
    const v = (await h.call('GET', `/v1/timetable?classId=${cls8a}`, { token })).json;
    expect(v.clashes).toHaveLength(1);
    expect(v.clashes[0]).toMatchObject({ teacherName: a.name, day: a.day, period: a.period });
    expect(v.clashes[0].suggestion.teacherName).toBeTruthy();
    const blocked = await h.call('POST', '/v1/timetable/publish', { token });
    expect(blocked.status).toBe(409);
    const slot = v.slots.find((s: any) => s.day === a.day && s.period === a.period);
    const fix = await h.call('POST', '/v1/timetable/cover', { token, body: { slotId: slot.id, teacherId: v.clashes[0].suggestion.teacherId } });
    expect(fix.status).toBe(204);
    const after = (await h.call('GET', `/v1/timetable?classId=${cls8a}`, { token })).json;
    expect(after.clashes).toHaveLength(0);
    expect(after.draftChanges).toBe(1);
    const pub = await h.call('POST', '/v1/timetable/publish', { token });
    expect(pub.status).toBe(200);
    expect(pub.json.families).toBeGreaterThan(30);
    expect((await h.call('GET', `/v1/timetable?classId=${cls8a}`, { token })).json.draftChanges).toBe(0);
  });
  it('will not double-book a cover', async () => {
    const v = (await h.call('GET', `/v1/timetable?classId=${cls8b}`, { token })).json;
    const other = (await h.call('GET', `/v1/timetable?classId=${cls8a}`, { token })).json.slots.find((s: any) => s.teacherId && !s.substituteId && v.slots.some((x: any) => x.day === s.day && x.period === s.period && x.teacherId !== s.teacherId));
    const slot = v.slots.find((s: any) => s.day === other.day && s.period === other.period);
    const r = await h.call('POST', '/v1/timetable/cover', { token, body: { slotId: slot.id, teacherId: other.teacherId } });
    expect(r.status).toBe(409);
  });
  it('frees a period and places a lesson in it, refusing a busy teacher, and shows a teacher’s and a room’s week', async () => {
    const v = (await h.call('GET', `/v1/timetable?classId=${cls8a}`, { token })).json;
    const slot = v.slots.find((s: any) => s.day === 1 && s.room && !s.substituteId);
    expect((await h.call('DELETE', `/v1/timetable/slots/${slot.id}`, { token })).status).toBe(204);
    const placed = await h.call('POST', '/v1/timetable/slots', { token, body: { classId: cls8a, day: slot.day, period: slot.period, subjectId: slot.subjectId, teacherId: slot.teacherId, room: slot.room } });
    expect(placed.status).toBe(201);
    expect((await h.call('POST', '/v1/timetable/slots', { token, body: { classId: cls8a, day: slot.day, period: slot.period, subjectId: slot.subjectId, teacherId: slot.teacherId } })).status).toBe(409);
    const week = (await h.call('GET', `/v1/timetable/week?teacherId=${slot.teacherId}`, { token })).json;
    expect(week.slots.some((s: any) => s.day === slot.day && s.period === slot.period && s.className)).toBe(true);
    const room = (await h.call('GET', `/v1/timetable/week?room=${encodeURIComponent(slot.room)}`, { token })).json;
    expect(room.title).toBe(`Room ${slot.room}`);
    expect((await h.call('GET', '/v1/timetable/rooms', { token })).json).toContain(slot.room);
  });
});

describe('settings', () => {
  it('shows the school its setup, lets it change its own settings and never Tangent’s', async () => {
    const before = (await h.call('GET', '/v1/settings', { token })).json;
    expect(before.usage.students).toBeGreaterThan(0);
    expect(before.usage.studentLimit).toBeGreaterThanOrEqual(before.usage.students);
    const version = (await h.call('GET', '/v1/settings/edit', { token })).json.version;
    expect((await h.call('PATCH', '/v1/settings', { token, body: { expectedVersion: version, changes: { 'brand.color': '#123456' } } })).status).toBe(400);
    expect((await h.call('GET', '/v1/me', { token })).json.permissions).not.toContain('settings.write');
  });
  it('follows what the console sets: colour, and the modules of the plan (the only place modules are chosen)', async () => {
    const was = (await h.registry.query("select entitlement->'modules' m from schools where slug = $1", [h.slug])).rows[0].m;
    await h.setSettings({ 'brand.color': '#0E7490' });
    await h.entitle({ modules: ['people', 'attendance'] });
    try {
      const cfg = (await h.call('GET', '/v1/config', { token })).json;
      expect(cfg.school.color).toBe('#0E7490');
      expect(cfg.modules).toEqual(['school', 'people', 'attendance']);
      const labels = cfg.menu.flatMap((g: any) => g.pages.map((p: any) => p.label));
      expect(labels).toContain('Attendance');
      expect(labels).not.toContain('Fees');
    } finally {
      await h.entitle({ modules: was });
    }
  }, 30_000);
  it('lets the school ask Tangent for a change', async () => {
    const r = await h.call('POST', '/v1/change-requests', { token, body: { area: 'App layout', message: 'Please put Fees in the bottom tabs.' } });
    expect(r.status).toBe(201);
    expect(r.json[0]).toMatchObject({ area: 'App layout', status: 'open', requestedBy: h.people.principal.name });
    expect((await h.call('POST', '/v1/change-requests', { token, body: { area: 'x', message: 'no' } })).status).toBe(400);
  });
});
