import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, schoolToday } from '@tangent/contracts';
import { startHarness, type Harness } from './harness.js';

// The five modules of the one shot: staff attendance and leave, the class diary, parent-teacher meetings, visitors with gate
// passes and pick-up, and certificates. Each is checked on the paths that go wrong, not only the one that works.
let h: Harness;
let admin: string;
let parent: string;
let teacher: string;
let kavita: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
  parent = await h.login('priya.sharma@example.com');
  teacher = await h.login('kavita.iyer@greenfield.edu.in');
  kavita = (await h.schoolSql("select id from users where email = 'kavita.iyer@greenfield.edu.in'"))[0].id;
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const today = () => schoolToday(new Date(), 'Asia/Kolkata');
const call = (token: string, method: string, path: string, body?: unknown) => h.call(method, path, { token, body });
const decide = (token: string, id: string, decision: string) => call(token, 'POST', `/v1/approvals/${id}/decision`, { decision, note: '' });
const approvalOf = async (kind: string, key: string, value: string) => (await h.schoolSql(`select id from approvals where kind = $1 and payload->>'${key}' = $2 order by created_at desc limit 1`, [kind, value]))[0]?.id as string;

describe('staff attendance', () => {
  it('checks in once inside the window, late after its time, and out; refuses when the office marks or the day is off', async () => {
    await h.setSettings({ 'staffAttendance.from': '00:00', 'staffAttendance.until': '23:59', 'staffAttendance.lateAfter': '00:00', 'staffAttendance.earlyBefore': '23:59', 'staffAttendance.radius': 0 });
    await h.schoolSql('delete from staff_attendance where user_id = $1 and date = $2', [kavita, today()]);
    expect((await call(teacher, 'POST', '/v1/f/staff/check-out')).status).toBe(409);
    const a = await call(teacher, 'POST', '/v1/f/staff/check-in', {});
    expect(a.status).toBe(200);
    expect(a.json.checkIn).toBeTruthy();
    expect(a.json.late).toBe(true);
    // A second press keeps the first time.
    const again = await call(teacher, 'POST', '/v1/f/staff/check-in', {});
    expect(again.json.checkIn).toBe(a.json.checkIn);
    const out = await call(teacher, 'POST', '/v1/f/staff/check-out');
    expect(out.json.checkOut).toBeTruthy();
    expect(out.json.early).toBe(true);
    // A family cannot use it.
    expect((await call(parent, 'GET', '/v1/f/staff/me')).status).toBe(403);
    await h.schoolSql('delete from staff_attendance where user_id = $1 and date = $2', [kavita, today()]);
    await h.setSettings({ 'staffAttendance.checkIn': 'office' });
    expect((await call(teacher, 'POST', '/v1/f/staff/check-in', {})).status).toBe(409);
    await h.setSettings({ 'staffAttendance.checkIn': 'app', 'staffAttendance.from': '23:59' });
    const closed = await call(teacher, 'POST', '/v1/f/staff/check-in', {});
    expect(closed.status).toBe(409);
    expect(closed.json.message).toMatch(/opens at 23:59/);
  });

  it('asks for a location within the radius when the school sets one', async () => {
    await h.setSettings({ 'staffAttendance.from': '00:00', 'staffAttendance.place': '18.5590, 73.7868', 'staffAttendance.radius': 200 });
    await h.schoolSql('delete from staff_attendance where user_id = $1 and date = $2', [kavita, today()]);
    expect((await call(teacher, 'POST', '/v1/f/staff/check-in', {})).status).toBe(400);
    const far = await call(teacher, 'POST', '/v1/f/staff/check-in', { lat: 18.6, lng: 73.79 });
    expect(far.status).toBe(409);
    expect(far.json.message).toMatch(/m from school/);
    expect((await call(teacher, 'POST', '/v1/f/staff/check-in', { lat: 18.5595, lng: 73.7870, accuracy: 30 })).status).toBe(200);
    await h.setSettings({ 'staffAttendance.radius': 0 });
  });

  it('the office marks a day with the school’s marks, never a day to come, and the month counts it', async () => {
    const day = today();
    expect((await call(admin, 'PUT', `/v1/staff-attendance/${addDays(day, 1)}`, { marks: [{ userId: kavita, status: 'present' }] })).status).toBe(400);
    expect((await call(admin, 'PUT', `/v1/staff-attendance/${day}`, { marks: [{ userId: kavita, status: 'holiday' }] })).status).toBe(400);
    expect((await call(admin, 'PUT', `/v1/staff-attendance/${day}`, { marks: [{ userId: 'usr_nobody', status: 'present' }] })).status).toBe(400);
    expect((await call(admin, 'PUT', `/v1/staff-attendance/${day}`, { marks: [{ userId: kavita, status: 'duty', note: 'Sports meet' }] })).status).toBe(200);
    const row = (await call(admin, 'GET', `/v1/staff-attendance?date=${day}`)).json.find((r: any) => r.userId === kavita);
    expect(row.status).toBe('duty');
    // The check-in time stays when the office changes the mark.
    expect(row.checkIn).toBeTruthy();
    const month = (await call(admin, 'GET', `/v1/staff-attendance/month?month=${day.slice(0, 7)}`)).json.find((r: any) => r.userId === kavita);
    expect(month.present).toBeGreaterThanOrEqual(1);
    const csv = await call(admin, 'GET', `/v1/staff-attendance/month.csv?month=${day.slice(0, 7)}`);
    expect(csv.text).toContain('Kavita Iyer');
    // A teacher without the permission cannot mark.
    expect((await call(teacher, 'PUT', `/v1/staff-attendance/${day}`, { marks: [{ userId: kavita, status: 'present' }] })).status).toBe(403);
  });
});

describe('staff leave', () => {
  const from = () => addDays(today(), 40);
  it('refuses leave that overlaps, runs past the balance, takes half a day of a whole-day type, or falls on closed days', async () => {
    const ask = (b: Record<string, unknown>) => call(teacher, 'POST', '/v1/f/staff/leave', { reason: 'Family', halfDay: null, ...b });
    const a = await ask({ type: 'casual', from: from(), to: addDays(from(), 1) });
    expect(a.status).toBe(200);
    expect(a.json.days).toBe(2);
    expect(a.json.status).toBe('pending');
    expect((await ask({ type: 'casual', from: addDays(from(), 1), to: addDays(from(), 1) })).status).toBe(409);
    expect((await ask({ type: 'casual', from: addDays(from(), 3), to: addDays(from(), 30) })).status).toBe(400);
    expect((await ask({ type: 'earned', from: addDays(from(), 5), to: addDays(from(), 5), halfDay: 'am' })).status).toBe(400);
    expect((await ask({ type: 'nosuch', from: addDays(from(), 5), to: addDays(from(), 5) })).status).toBe(400);
    expect((await ask({ type: 'casual', from: addDays(from(), 5), to: addDays(from(), 3) })).status).toBe(400);
    // Unpaid leave keeps no balance: any number of days.
    expect((await ask({ type: 'unpaid', from: addDays(from(), 10), to: addDays(from(), 20) })).status).toBe(200);
    // Half a day of the same date in the other half is fine.
    expect((await ask({ type: 'sick', from: addDays(from(), 25), to: addDays(from(), 25), halfDay: 'am' })).status).toBe(200);
    expect((await ask({ type: 'sick', from: addDays(from(), 25), to: addDays(from(), 25), halfDay: 'pm' })).status).toBe(200);
    await h.setSettings({ 'calendar.weeklyOff': ['sun', 'mon', 'tue', 'wed', 'thu', 'fri'] });
    const sat = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(from(), 50 + n)).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0)!;
    expect((await ask({ type: 'casual', from: sat, to: sat })).status).toBe(400);
    await h.setSettings({ 'calendar.weeklyOff': [] });
  });

  it('is decided by someone else, counts once approved, and approval checks the balance again', async () => {
    const id = (await call(teacher, 'GET', '/v1/f/staff/me')).json.requests.find((r: any) => r.from === from() && r.type === 'casual').id;
    expect((await decide(teacher, id, 'approve')).status).toBe(403);
    expect((await decide(admin, id, 'approve')).status).toBe(200);
    const me = (await call(teacher, 'GET', '/v1/f/staff/me')).json;
    const casual = me.balances.find((b: any) => b.type === 'casual');
    expect(casual.used).toBeGreaterThanOrEqual(2);
    // Ask for everything left, then the office takes a day away: approving it now would go below nothing.
    const left = casual.available;
    const big = await call(teacher, 'POST', '/v1/f/staff/leave', { type: 'casual', from: addDays(from(), 60), to: addDays(from(), 60 + left - 1), reason: '', halfDay: null });
    expect(big.status).toBe(200);
    expect((await call(admin, 'POST', '/v1/staff-leave/adjust', { userId: kavita, type: 'casual', days: -1, note: 'Correction' })).status).toBe(200);
    expect((await call(admin, 'POST', '/v1/staff-leave/adjust', { userId: kavita, type: 'casual', days: 0.3, note: 'Bad' })).status).toBe(400);
    const refused = await decide(admin, big.json.id, 'approve');
    expect(refused.status).toBe(409);
    // Withdrawn by its asker while it waits; approved leave only the office cancels.
    expect((await call(teacher, 'POST', `/v1/f/staff/leave/${big.json.id}/withdraw`)).status).toBe(200);
    expect((await call(teacher, 'POST', `/v1/f/staff/leave/${id}/withdraw`)).status).toBe(409);
    expect((await call(admin, 'POST', `/v1/staff-leave/${id}/cancel`, { note: 'Plans changed' })).status).toBe(200);
    expect((await call(teacher, 'GET', '/v1/f/staff/me')).json.balances.find((b: any) => b.type === 'casual').used).toBe(casual.used - 2);
  });

  it('the office records leave approved at once, and a switched-off module leaves no trace', async () => {
    const r = await call(admin, 'POST', '/v1/staff-leave', { userId: kavita, type: 'sick', from: addDays(today(), 120), to: addDays(today(), 120), halfDay: null, reason: 'Recorded by phone' });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('approved');
    const mods = (await h.registry.query("select entitlement->'modules' m from schools where slug = $1", [h.slug])).rows[0].m as string[];
    await h.entitle({ modules: mods.filter((m) => m !== 'staffAttendance') });
    expect((await call(teacher, 'GET', '/v1/f/staff/me')).status).toBe(423);
    expect((await call(admin, 'GET', '/v1/staff-leave')).status).toBe(423);
    expect((await call(admin, 'GET', '/v1/approvals?view=waiting')).json.some((a: any) => a.kind === 'staff_leave')).toBe(false);
    await h.entitle({ modules: mods });
  });
});

describe('diary', () => {
  it('a teacher writes for her class only; a family reads its own child’s remark and acknowledges', async () => {
    const mine = (await h.schoolSql("select c.id from classes c where c.class_teacher_id = $1 limit 1", [kavita]))[0]?.id;
    const other = (await h.schoolSql('select c.id from classes c where c.class_teacher_id is distinct from $1 and not exists (select 1 from timetable_slots t where t.class_id = c.id and t.teacher_id = $1) limit 1', [kavita]))[0]?.id;
    const kids = await h.schoolSql("select id from students where class_id = $1 and status = 'active' order by roll_no limit 2", [mine]);
    const outsider = (await h.schoolSql("select id from students where class_id = $1 limit 1", [other]))[0].id;
    const base = { classId: mine, date: today(), kind: 'note', subjectId: null, text: 'Bring your library books back on Friday.', fileIds: [] };
    expect((await call(teacher, 'POST', '/v1/f/diary', { ...base, classId: other })).status).toBe(403);
    expect((await call(teacher, 'POST', '/v1/f/diary', { ...base, kind: 'nosuch' })).status).toBe(400);
    expect((await call(teacher, 'POST', '/v1/f/diary', { ...base, remarks: [{ studentId: outsider, text: 'Not mine' }] })).status).toBe(400);
    expect((await call(teacher, 'POST', '/v1/f/diary', { ...base, date: addDays(today(), 60) })).status).toBe(400);
    const mineClasses = (await call(teacher, 'GET', '/v1/f/diary/classes')).json;
    expect(mineClasses.classes.map((c: any) => c.classId)).toContain(mine);
    expect(mineClasses.kinds.map((k: any) => k.key)).toContain('note');
    const e = await call(teacher, 'POST', '/v1/f/diary', { ...base, remarks: [{ studentId: kids[0].id, text: 'Lovely reading today.' }, { studentId: kids[1].id, text: 'Forgot the homework.' }] });
    expect(e.status).toBe(200);
    expect(e.json.remarks).toHaveLength(2);
    expect((await call(parent, 'POST', '/v1/f/diary', base)).status).toBe(403);
    // A family sees only its own child's remark.
    await h.schoolSql("insert into student_guardians (student_id, guardian_id, is_primary) select $1, g.id, false from guardians g join users u on u.id = g.user_id where u.email = 'priya.sharma@example.com' on conflict do nothing", [kids[0].id]);
    const read = await call(parent, 'GET', `/v1/f/diary/student/${kids[0].id}`);
    const entry = read.json.find((x: any) => x.id === e.json.id);
    expect(entry.remark).toBe('Lovely reading today.');
    expect(entry.needsAck).toBe(true);
    expect((await call(parent, 'GET', `/v1/f/diary/student/${outsider}`)).status).toBe(404);
    expect((await call(parent, 'POST', `/v1/f/diary/${e.json.id}/ack`, { studentId: kids[0].id })).status).toBe(200);
    expect((await call(parent, 'POST', `/v1/f/diary/${e.json.id}/ack`, { studentId: kids[0].id })).status).toBe(200);
    expect((await call(parent, 'POST', `/v1/f/diary/${e.json.id}/ack`, { studentId: outsider })).status).toBe(404);
    const acks = (await call(teacher, 'GET', `/v1/diary/${e.json.id}/acks`)).json;
    expect(acks.filter((a: any) => a.at)).toHaveLength(1);
    // Only its writer (or the office) changes it.
    expect((await call(teacher, 'PUT', `/v1/f/diary/${e.json.id}`, { ...base, text: 'Changed.' })).json.text).toBe('Changed.');
    expect((await call(teacher, 'DELETE', `/v1/f/diary/${e.json.id}`)).status).toBe(204);
  });
});

describe('parent-teacher meetings', () => {
  it('families book one time per teacher per child, never two at once, and the day stays once booked', async () => {
    const kids = await h.schoolSql(
      "select s.id, s.class_id from students s join student_guardians sg on sg.student_id = s.id join guardians g on g.id = sg.guardian_id join users u on u.id = g.user_id where u.email = 'priya.sharma@example.com' and s.status = 'active' order by s.id");
    const classes = [...new Set(kids.map((k: any) => k.class_id))];
    const day = addDays(today(), 3);
    const m = { title: 'Mid-term meeting', date: day, from: '09:00', to: '10:00', slotMinutes: 10, gapMinutes: 0, mode: 'either', place: 'Hall', link: '', classIds: classes, teacherIds: [], closesAt: null, status: 'open' };
    expect((await call(teacher, 'POST', '/v1/meetings', m)).status).toBe(403);
    expect((await call(admin, 'POST', '/v1/meetings', { ...m, to: '09:05' })).status).toBe(400);
    expect((await call(admin, 'POST', '/v1/meetings', { ...m, date: addDays(today(), -1) })).status).toBe(400);
    const made = await call(admin, 'POST', '/v1/meetings', m);
    expect(made.status).toBe(200);
    expect(made.json.slots).toBeGreaterThanOrEqual(6);
    const list = (await call(parent, 'GET', '/v1/f/meetings')).json.find((x: any) => x.id === made.json.id);
    const first = list.children[0];
    const slot = first.teachers[0].slots[0];
    expect((await call(parent, 'POST', '/v1/f/meetings/book', { slotId: slot.id, studentId: first.studentId })).status).toBe(400);
    const booked = await call(parent, 'POST', '/v1/f/meetings/book', { slotId: slot.id, studentId: first.studentId, mode: 'inPerson' });
    expect(booked.status).toBe(200);
    expect((await call(parent, 'POST', '/v1/f/meetings/book', { slotId: first.teachers[0].slots[1].id, studentId: first.studentId, mode: 'inPerson' })).status).toBe(409);
    // The office cannot give the same time to another child.
    const other = (await h.schoolSql("select id from students where class_id = (select class_id from students where id = $1) and id <> all($2) and status = 'active' limit 1", [first.studentId, kids.map((k: any) => k.id)]))[0].id;
    expect((await call(admin, 'POST', '/v1/meetings/book', { slotId: slot.id, studentId: other, mode: 'inPerson' })).status).toBe(409);
    // The second child, with another teacher at the same time: one family cannot be in two rooms.
    const second = list.children.find((c: any) => c.studentId !== first.studentId && c.teachers[0]?.teacherId !== first.teachers[0].teacherId);
    if (second) {
      const same = second.teachers[0].slots.find((s: any) => s.startsAt === slot.startsAt);
      expect((await call(parent, 'POST', '/v1/f/meetings/book', { slotId: same.id, studentId: second.studentId, mode: 'online' })).status).toBe(409);
    }
    expect((await call(admin, 'PUT', `/v1/meetings/${made.json.id}`, { ...m, from: '09:30' })).status).toBe(409);
    expect((await call(admin, 'PUT', `/v1/meetings/${made.json.id}`, { ...m, place: 'Library' })).status).toBe(200);
    // The family cancels; the teacher closes a time; a closed time cannot be booked.
    expect((await call(parent, 'POST', `/v1/f/meetings/slots/${slot.id}/cancel`)).status).toBe(200);
    const tToken = await h.login((await h.schoolSql('select email from users where id = $1', [first.teachers[0].teacherId]))[0].email);
    expect((await call(tToken, 'PATCH', `/v1/f/meetings/slots/${slot.id}`, { closed: true })).status).toBe(200);
    expect((await call(parent, 'POST', '/v1/f/meetings/book', { slotId: slot.id, studentId: first.studentId, mode: 'inPerson' })).status).toBe(409);
    expect((await call(parent, 'PATCH', `/v1/f/meetings/slots/${slot.id}`, { closed: false })).status).toBe(403);
  });
});

describe('visitors, gate passes and pick-up', () => {
  it('signs a visitor in with a badge and out once; an invitation waits for its day and, where asked, for approval', async () => {
    const v = await call(admin, 'POST', '/v1/visitors', { name: 'Grace Lin', phone: '', purpose: 'meeting', hostId: kavita, expectedOn: null });
    expect(v.status).toBe(200);
    expect(v.json.state).toBe('in');
    expect(v.json.badgeNo).toMatch(/^VIS-\d{4}-\d{4}$/);
    expect((await call(admin, 'POST', '/v1/visitors', { name: 'X Y', purpose: 'nosuch', expectedOn: null })).status).toBe(400);
    expect((await call(admin, 'POST', `/v1/visitors/${v.json.id}/out`)).status).toBe(200);
    expect((await call(admin, 'POST', `/v1/visitors/${v.json.id}/out`)).status).toBe(409);
    expect((await call(admin, 'GET', `/v1/visitors/${v.json.id}/badge.pdf`)).headers['content-type']).toContain('pdf');
    const inv = await call(admin, 'POST', '/v1/visitors', { name: 'Omar Haddad', purpose: 'interview', hostId: kavita, expectedOn: addDays(today(), 2) });
    expect(inv.json.state).toBe('invited');
    expect((await call(admin, 'POST', '/v1/visitors/code', { code: inv.json.code })).json.id).toBe(inv.json.id);
    expect((await call(admin, 'POST', `/v1/visitors/${inv.json.id}/in`)).status).toBe(409);
    await h.setSettings({ 'visitors.invitesNeedApproval': true });
    const asked = await call(teacher, 'POST', '/v1/f/visitors', { name: 'Ken Ito', purpose: 'meeting', expectedOn: addDays(today(), 1) });
    expect(asked.json.state).toBe('pending');
    expect((await call(admin, 'POST', `/v1/visitors/${asked.json.id}/in`)).status).toBe(409);
    const aid = (await h.schoolSql("select id from approvals where kind = 'visitor' and subject_ref = $1", [asked.json.id]))[0].id;
    expect((await decide(admin, aid, 'approve')).status).toBe(200);
    const mine = (await call(teacher, 'GET', '/v1/f/visitors')).json;
    expect(mine.visitors.find((x: any) => x.id === asked.json.id).state).toBe('invited');
    expect(mine.purposes.map((p: any) => p.key)).toContain('meeting');
    expect((await call(teacher, 'POST', '/v1/f/visitors', { name: 'No Day', purpose: 'meeting', expectedOn: null })).status).toBe(400);
    await h.setSettings({ 'visitors.invitesNeedApproval': false });
  });

  it('a child leaves early only on an approved pass, the school’s own pass waits for the family, and pick-up needs the code', async () => {
    const aarav = (await h.schoolSql("select id from students where id = 'stu_aarav'"))[0].id;
    const leaveAt = new Date(Date.now() + 3 * 3600_000).toISOString();
    const p = await call(parent, 'POST', '/v1/f/gate-pass', { studentId: aarav, leaveAt, reason: 'Dentist', collector: 'Mother', pickupId: null, returns: false });
    expect(p.status).toBe(200);
    expect(p.json.state).toBe('pending');
    expect((await call(parent, 'POST', '/v1/f/gate-pass', { studentId: aarav, leaveAt, reason: 'Again', collector: 'Mother' })).status).toBe(409);
    expect((await call(parent, 'POST', '/v1/f/gate-pass', { studentId: 'stu_nobody', leaveAt, reason: 'x y z', collector: 'Me' })).status).toBe(404);
    expect((await call(admin, 'POST', `/v1/gate-passes/${p.json.id}/out`)).status).toBe(409);
    expect((await decide(admin, await approvalOf('gate_pass', 'passId', p.json.id), 'approve')).status).toBe(200);
    const out = await call(admin, 'POST', `/v1/gate-passes/${p.json.id}/out`);
    expect(out.json.state).toBe('left');
    expect(out.json.number).toMatch(/^GP-/);
    expect((await call(parent, 'POST', `/v1/f/gate-pass/${p.json.id}/cancel`)).status).toBe(409);
    // The school asks; the family answers first.
    const s = await call(admin, 'POST', '/v1/gate-passes', { studentId: aarav, leaveAt: new Date(Date.now() + 26 * 3600_000).toISOString(), reason: 'Unwell in class', collector: 'Father' });
    expect(s.json.state).toBe('consent');
    expect((await call(teacher, 'POST', `/v1/f/gate-pass/${s.json.id}/consent`, { yes: true })).status).toBe(403);
    expect((await call(parent, 'POST', `/v1/f/gate-pass/${s.json.id}/consent`, { yes: true })).json.state).toBe('pending');
    expect((await call(parent, 'POST', `/v1/f/gate-pass/${s.json.id}/consent`, { yes: true })).status).toBe(409);
    // Pick-up: the family's code for today, checked at the gate.
    const mine = (await call(parent, 'GET', '/v1/f/gate-pass')).json;
    expect(mine.code).toMatch(/^\d{6}$/);
    expect((await call(parent, 'GET', '/v1/f/gate-pass')).json.code).toBe(mine.code);
    const checked = await call(admin, 'POST', '/v1/pickup/check', { code: `TP:${mine.code}` });
    expect(checked.json.students.map((x: any) => x.id)).toContain(aarav);
    expect((await call(admin, 'POST', '/v1/pickup/check', { code: '000000' === mine.code ? '000001' : '000000' })).status).toBe(404);
    expect((await call(admin, 'POST', '/v1/pickup', { studentId: aarav, name: 'Uncle', code: '' })).status).toBe(400);
    expect((await call(admin, 'POST', '/v1/pickup', { studentId: aarav, name: 'Uncle', code: mine.code === '123456' ? '654321' : '123456' })).status).toBe(400);
    expect((await call(admin, 'POST', '/v1/pickup', { studentId: aarav, name: 'Uncle', code: mine.code })).status).toBe(200);
    const named = await call(parent, 'POST', '/v1/f/pickup-people', { studentIds: [aarav], name: 'Sam Rivera', relation: 'Neighbour', phone: '' });
    expect(named.json.some((x: any) => x.name === 'Sam Rivera')).toBe(true);
    expect((await call(parent, 'POST', '/v1/f/pickup-people', { studentIds: ['stu_nobody'], name: 'Sam Rivera', relation: 'Neighbour' })).status).toBe(404);
  });

  it('writes a late arrival once a day and lists everyone on site', async () => {
    const st = (await h.schoolSql("select id from students where status = 'active' and id <> 'stu_aarav' order by id limit 1"))[0].id;
    expect((await call(admin, 'POST', '/v1/late-arrivals', { studentId: st, reason: 'Traffic' })).status).toBe(200);
    expect((await call(admin, 'POST', '/v1/late-arrivals', { studentId: st, reason: 'Again' })).status).toBe(409);
    expect((await call(admin, 'POST', '/v1/late-arrivals', { studentId: st, at: new Date(Date.now() - 3 * 86_400_000).toISOString() })).status).toBe(400);
    const roll = (await call(admin, 'GET', '/v1/visitors/roll-call')).json;
    expect(roll.students.length).toBeGreaterThan(0);
    expect(roll.students.map((x: any) => x.id)).not.toContain('stu_aarav');
    expect((await call(admin, 'GET', '/v1/visitors/roll-call.pdf')).headers['content-type']).toContain('pdf');
    expect((await call(parent, 'GET', '/v1/visitors/roll-call')).status).toBe(403);
  });
});

describe('certificates', () => {
  it('a family asks, the school issues it with a number and a QR page, and can revoke it', async () => {
    const mine = (await call(parent, 'GET', '/v1/f/certificates')).json;
    expect(mine.types.map((x: any) => x.key)).not.toContain('participation');
    const r = await call(parent, 'POST', '/v1/f/certificates', { type: 'bonafide', studentId: 'stu_aarav', purpose: 'a bank account' });
    expect(r.status).toBe(200);
    expect((await call(parent, 'POST', '/v1/f/certificates', { type: 'bonafide', studentId: 'stu_aarav', purpose: 'again' })).status).toBe(409);
    expect((await call(parent, 'POST', '/v1/f/certificates', { type: 'participation', studentId: 'stu_aarav' })).status).toBe(400);
    expect((await call(parent, 'GET', `/v1/f/certificates/${r.json.id}/certificate.pdf`)).status).toBe(409);
    expect((await decide(admin, await approvalOf('certificate', 'certificateId', r.json.id), 'approve')).status).toBe(200);
    const issued = (await call(parent, 'GET', '/v1/f/certificates')).json.certificates.find((c: any) => c.id === r.json.id);
    expect(issued.state).toBe('issued');
    expect(issued.number).toMatch(/^CERT-\d{4}-\d{4}$/);
    const file = await call(parent, 'GET', `/v1/f/certificates/${r.json.id}/certificate.pdf`);
    expect(file.headers['content-type']).toContain('pdf');
    // The phone opens it outside the app from a ten-minute link, as receipts are.
    const link = await call(parent, 'POST', `/v1/f/certificates/${r.json.id}/link`, {});
    const opened = await h.call('GET', new URL(link.json.url).pathname);
    expect(opened.headers['content-type']).toContain('pdf');
    const token = (await h.schoolSql('select token from certificates where id = $1', [r.json.id]))[0].token;
    const check = await h.call('GET', `/v1/certificates/verify/${token}`);
    expect(check.json.genuine).toBe(true);
    expect(check.json.student).toBe('Aarav Sharma');
    expect((await h.call('GET', '/v1/certificates/verify/not-a-real-token-at-all')).json.genuine).toBe(false);
    expect((await call(admin, 'POST', `/v1/certificates/${r.json.id}/revoke`, { note: '' })).status).toBe(400);
    expect((await call(admin, 'POST', `/v1/certificates/${r.json.id}/revoke`, { note: 'Issued in error' })).status).toBe(200);
    const after = await h.call('GET', `/v1/certificates/verify/${token}`);
    expect(after.json).toMatchObject({ genuine: false, revoked: true });
  });

  it('waits for its fee and, where asked, for nothing to be owed; a cancelled request drops its unpaid fee', async () => {
    const types = (await call(admin, 'GET', '/v1/certificates/types')).json;
    await h.setSettings({ 'certificates.types': types.map((x: any) => (x.key === 'character' ? { ...x, fee: 150 } : x)) });
    const c = await call(admin, 'POST', '/v1/certificates', { type: 'character', studentId: 'stu_aarav', purpose: '' });
    expect(c.json.feeDue).toBeGreaterThan(0);
    const aid = await approvalOf('certificate', 'certificateId', c.json.id);
    // The office asked, so someone else decides; the fee is still owed.
    const meera = await h.login((await h.schoolSql("select email from users where kind = 'staff' and email <> 'neha.menon@greenfield.edu.in' and id in (select user_id from user_roles where role_id = 'role_principal') limit 1"))[0]?.email ?? 'neha.menon@greenfield.edu.in');
    const refused = await decide(meera === admin ? admin : meera, aid, 'approve');
    expect([403, 409]).toContain(refused.status);
    const invoice = (await h.schoolSql('select invoice_id from certificates where id = $1', [c.json.id]))[0].invoice_id;
    expect((await call(admin, 'POST', `/v1/certificates/${c.json.id}/cancel`)).json.state).toBe('cancelled');
    expect(await h.schoolSql('select 1 from fee_invoices where id = $1', [invoice])).toHaveLength(0);
    // A leaving certificate with fees owed is refused at approval.
    await h.schoolSql("insert into fee_invoices (id, student_id, head, title, amount, due_on) values ('inv_owed', 'stu_aarav', 'tuition', 'Owed', 500, $1)", [addDays(today(), -5)]);
    const lc = await call(parent, 'POST', '/v1/f/certificates', { type: 'transfer', studentId: 'stu_aarav', purpose: '' });
    const owed = await decide(admin, await approvalOf('certificate', 'certificateId', lc.json.id), 'approve');
    expect(owed.status).toBe(409);
    expect(owed.json.message).toMatch(/owed/);
  });

  it('prints ID cards for a class at card size', async () => {
    const cls = (await h.schoolSql("select class_id from students where id = 'stu_aarav'"))[0].class_id;
    const r = await call(admin, 'POST', '/v1/certificates/id-cards', { classIds: [cls], studentIds: [], staff: false, validUntil: null });
    expect(r.headers['content-type']).toContain('pdf');
    expect(r.raw.length).toBeGreaterThan(1000);
    expect((await call(admin, 'POST', '/v1/certificates/id-cards', { classIds: [], studentIds: [], staff: false })).status).toBe(400);
    expect((await call(teacher, 'POST', '/v1/certificates/id-cards', { classIds: [cls] })).status).toBe(403);
  });
});

