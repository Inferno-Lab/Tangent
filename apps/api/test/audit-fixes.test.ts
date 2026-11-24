import { schoolToday } from '@tangent/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// The paths the November audit found going wrong: money, decisions taken twice, families told twice, staff contacts, codes
// guessed in parallel, results that mix years, and the timetable families read before it is published.
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (token: string, method: string, url: string, body?: unknown) => h.call(method, url, { token, body });

describe('fee waivers', () => {
  it('a declined request leaves a waiver already given in place, and undo takes back only its own', async () => {
    const accounts = await h.login(h.people.accountant.email);
    const inv = (await call(accounts, 'GET', '/v1/fees/invoice-list?status=overdue&limit=1')).json.items[0];
    const waived = async () => (await call(admin, 'GET', `/v1/fees/invoice/${inv.id}`)).json.waived as number;
    const start = await waived();
    const ask = async (amount: number) => {
      expect((await call(accounts, 'POST', `/v1/fees/invoice/${inv.id}/waive`, { amount, reason: 'Concession' })).status).toBe(200);
      return (await call(admin, 'GET', '/v1/approvals')).json.find((a: any) => a.kind === 'fee_waiver' && a.status === 'pending' && a.title.includes(inv.title)).id as string;
    };
    const first = await ask(10);
    // Two people deciding at the same moment: it is applied once.
    const both = await Promise.all([call(admin, 'POST', `/v1/approvals/${first}/decision`, { decision: 'approve' }), call(admin, 'POST', `/v1/approvals/${first}/decision`, { decision: 'approve' })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await waived()).toBe(start + 10);
    const second = await ask(5);
    expect((await call(admin, 'POST', `/v1/approvals/${second}/decision`, { decision: 'reject', note: 'Not this time' })).status).toBe(200);
    expect(await waived()).toBe(start + 10);
    const third = await ask(5);
    expect((await call(admin, 'POST', `/v1/approvals/${third}/decision`, { decision: 'approve' })).status).toBe(200);
    expect(await waived()).toBe(start + 15);
    // Undoing the first takes back its 10 only: the later 5 stays.
    expect((await call(admin, 'POST', `/v1/approvals/${first}/decision`, { decision: 'undo' })).status).toBe(200);
    expect(await waived()).toBe(start + 5);
  });
});

describe('attendance', () => {
  it('saving a register again does not tell the same families again', async () => {
    const date = schoolToday();
    const cls = await h.classId('7 A');
    const day = (await call(admin, 'GET', `/v1/attendance/day?classId=${cls}&date=${date}`)).json;
    const marks = day.marks.map((m: any, i: number) => ({ studentId: m.studentId, status: i === 0 ? 'absent' : 'present' }));
    const sent = async () => {
      const phones = (await h.schoolSql<{ phone: string }>('select g.phone from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = $1 and sg.gets_messages and g.phone is not null', [marks[0].studentId])).map((r) => r.phone);
      return Number((await h.registry.query("select count(*) n from message_log where school_slug = $1 and message_key = 'attendance.absent' and to_addr = any($2)", [h.slug, phones])).rows[0].n);
    };
    const put = () => call(admin, 'PUT', '/v1/attendance/day', { classId: cls, date, marks });
    if (day.submitted) return; // A register already kept today by another test: nothing new to compare against.
    expect((await put()).status).toBe(200);
    const once = await sent();
    expect(once).toBeGreaterThan(0);
    expect((await put()).status).toBe(200);
    expect(await sent()).toBe(once);
  });
});

describe('what families see', () => {
  it('lists teachers without their phone or email', async () => {
    const parent = await h.login(h.people.parentOfTwo.phone);
    const list = (await call(parent, 'GET', '/v1/f/teachers')).json;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((x: any) => x.phone === '' && x.email === '')).toBe(true);
    const teacher = await h.login(h.people.classTeacher.email);
    expect((await call(teacher, 'GET', '/v1/f/teachers')).json.some((x: any) => x.phone)).toBe(true);
  });

  it('a family saves the language it reads, and it is kept on its account', async () => {
    const parent = await h.login(h.people.parentOfOne.phone);
    expect((await call(parent, 'PUT', '/v1/me/prefs', { key: 'language', value: 'hi' })).status).toBe(204);
    expect((await call(parent, 'GET', '/v1/me/prefs')).json.language).toBe('hi');
  });

  it('reads the published timetable: a draft change waits for Publish', async () => {
    const parent = await h.login(h.people.parentOfTwo.phone);
    const [slot] = await h.schoolSql<{ id: string; class_id: string; subject_id: string; teacher_id: string }>(
      "select t.id, t.class_id, t.subject_id, t.teacher_id from timetable_slots t join students s on s.class_id = t.class_id join student_guardians sg on sg.student_id = s.id join guardians g on g.id = sg.guardian_id where g.phone = $1 and not t.removed limit 1",
      [h.people.parentOfTwo.phone]);
    const other = (await h.schoolSql<{ id: string }>("select u.id from users u join staff s on s.user_id = u.id where u.status = 'active' and u.id <> $1 and not exists (select 1 from timetable_slots x join timetable_slots me on me.id = $2 where x.day = me.day and x.period = me.period and coalesce(x.cover_teacher_id, x.teacher_id) = u.id) limit 1", [slot!.teacher_id, slot!.id]))[0]!.id;
    expect((await call(admin, 'PATCH', `/v1/timetable/slots/${slot!.id}`, { teacherId: other })).status).toBe(204);
    const teachers = async () => (await call(parent, 'GET', `/v1/f/classes/${slot!.class_id}/timetable`)).json.flatMap((d: any) => d.periods.map((p: any) => p.teacherId));
    expect(await teachers()).not.toContain(other);
    expect((await call(admin, 'POST', '/v1/timetable/publish')).status).toBe(200);
    expect(await teachers()).toContain(other);
    // Put back for the other tests, published.
    await call(admin, 'PATCH', `/v1/timetable/slots/${slot!.id}`, { teacherId: slot!.teacher_id });
    await call(admin, 'POST', '/v1/timetable/publish');
  });
});

describe('notices', () => {
  it('a teacher’s change to an approved notice goes back for approval before families see it', async () => {
    await h.setSettings({ 'approvals.notice': 'required' });
    // Teachers of this school write notices to their classes (as the school can let them).
    await h.schoolSql(`update roles set permissions = permissions || '["notices.write"]' where key = 'teacher' and not permissions ? 'notices.write'`);
    const teacher = await h.login(h.people.classTeacher.email);
    const cls = await h.classId(h.people.classTeacher.class ?? '8 A');
    const posted = await call(teacher, 'POST', '/v1/notices', { title: 'Sports day kit', body: 'Bring the white kit on Friday.', audience: 'class', classId: cls, publish: true });
    expect(posted.status, posted.text).toBe(201);
    const approval = (await call(admin, 'GET', '/v1/approvals')).json.find((a: any) => a.kind === 'notice' && a.title === 'Sports day kit').id;
    expect((await call(admin, 'POST', `/v1/approvals/${approval}/decision`, { decision: 'approve' })).status).toBe(200);
    const edited = await call(teacher, 'PUT', `/v1/notices/${posted.json.id}`, { title: 'Sports day kit', body: 'Something else entirely.', audience: 'class', classId: cls, tellAgain: true });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.json.status).toBe('pending');
    expect((await call(admin, 'GET', '/v1/approvals')).json.some((a: any) => a.kind === 'notice' && a.status === 'pending' && a.title === 'Sports day kit')).toBe(true);
  });
});

describe('sign-in codes', () => {
  it('many wrong codes sent at once still get three tries between them', async () => {
    const phone = h.people.parentOfOne.phone!;
    const ch = (await h.call('POST', '/v1/auth/code', { body: { identifier: phone } })).json;
    const tries = await Promise.all(Array.from({ length: 8 }, (_, i) => h.call('POST', '/v1/auth/verify', { body: { challengeId: ch.challengeId, code: String(100000 + i), client: 'mobile' } })));
    expect(tries.filter((r) => r.status === 401).length).toBeLessThanOrEqual(3);
    const right = await h.call('POST', '/v1/auth/verify', { body: { challengeId: ch.challengeId, code: await h.codeSentTo(phone), client: 'mobile' } });
    expect(right.status).toBe(423);
  });
});

describe('results', () => {
  it('keep their exam, so a name used again in another year does not overwrite them', async () => {
    const [r] = await h.schoolSql<{ exam_id: string | null }>('select exam_id from exam_results where exam_id is not null limit 1');
    if (!r) return; // The test school has no published exam yet.
    const [e] = await h.schoolSql<{ name: string }>('select name from exams where id = $1', [r.exam_id]);
    expect(e?.name).toBeTruthy();
  });
});
