import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// What each role sees: a teacher sees the students, registers, homework, marks, conversations and meeting times of the classes
// they teach, never another teacher's; whole-school roles (the principal, the office, accounts) see every class.
let h: Harness;
let principal: string;
let teacher: string;
let teacherId: string;
let mine: string[];
let other: string;
beforeAll(async () => {
  h = await startHarness();
  principal = await h.login();
  teacher = await h.login(h.people.classTeacher.email);
  teacherId = (await h.schoolSql<{ id: string }>('select id from users where lower(email) = lower($1)', [h.people.classTeacher.email]))[0]!.id;
  mine = (await h.schoolSql<{ id: string }>(
    'select id from classes where class_teacher_id = $1 union select class_id from live_slots where teacher_id = $1 or cover_teacher_id = $1', [teacherId])).map((r) => r.id);
  other = (await h.schoolSql<{ id: string }>('select id from classes where not (id = any($1)) order by grade, section limit 1', [mine]))[0]!.id;
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const get = (token: string, url: string) => h.call('GET', url, { token });

describe('a teacher sees only the classes they teach', () => {
  it('teaches some classes and not others (the test school is set up so)', () => {
    expect(mine.length).toBeGreaterThan(0);
    expect(other).toBeTruthy();
  });

  it('class pickers, the student list, its counts and search hold only their classes', async () => {
    const classes = (await get(teacher, '/v1/classes')).json as { id: string }[];
    expect(classes.length).toBe(mine.length);
    expect(classes.every((c) => mine.includes(c.id))).toBe(true);
    const list = (await get(teacher, '/v1/students?limit=100')).json;
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((s: any) => mine.includes(s.classId))).toBe(true);
    const whole = (await get(principal, '/v1/students?limit=1')).json.total;
    expect(list.total).toBeLessThan(whole);
    expect((await get(teacher, '/v1/students/summary')).json.total).toBe(list.total);
    const theirs = (await h.schoolSql<{ id: string; name: string }>("select id, name from students where class_id = $1 and status = 'active' limit 1", [other]))[0]!;
    expect((await get(teacher, `/v1/students/${theirs.id}`)).status).toBe(404);
    expect((await h.call('POST', `/v1/students/${theirs.id}/reveal`, { token: teacher })).status).toBe(404);
    const found = (await get(teacher, `/v1/search?q=${encodeURIComponent(theirs.name)}`)).json as { href: string }[];
    expect(found.some((x) => x.href.includes(theirs.id))).toBe(false);
    // The principal (whole school) opens the same student.
    expect((await get(principal, `/v1/students/${theirs.id}`)).status).toBe(200);
  });

  it('registers, homework, exams and marks of another class are refused or left out', async () => {
    const day = new Date().toISOString().slice(0, 10);
    expect((await get(teacher, `/v1/attendance/day?classId=${other}&date=${day}`)).status).toBe(403);
    expect((await get(teacher, `/v1/attendance/day?classId=${mine[0]}&date=${day}`)).status).toBe(200);
    expect((await h.call('POST', '/v1/attendance/remind', { token: teacher })).status).toBe(403);
    expect(((await get(teacher, '/v1/homework')).json as any[]).every((x) => mine.includes(x.classId))).toBe(true);
    const exams = (await get(teacher, '/v1/exams')).json as any[];
    expect(exams.every((x) => mine.includes(x.classId))).toBe(true);
    const theirExam = (await h.schoolSql<{ id: string }>('select id from exams where class_id = $1 limit 1', [other]))[0];
    if (theirExam) {
      expect((await get(teacher, `/v1/exams/${theirExam.id}/marks`)).status).toBe(403);
      expect((await get(teacher, `/v1/exams/${theirExam.id}/results`)).status).toBe(403);
    }
    // The app's routes hold the same line.
    expect((await get(teacher, `/v1/f/classes/${other}/homework`)).status).toBe(403);
    expect((await get(teacher, `/v1/f/classes/${other}/students`)).status).toBe(403);
    expect((await get(teacher, `/v1/f/classes/${mine[0]}/students`)).status).toBe(200);
  });

  it('family conversations are the ones assigned to them; the office sees every one', async () => {
    const theirs = (await get(teacher, '/v1/messages')).json as { id: string; assignedToId: string | null }[];
    expect(theirs.every((x) => x.assignedToId === teacherId)).toBe(true);
    const all = (await get(principal, '/v1/messages')).json as { id: string; assignedToId: string | null }[];
    const someoneElse = all.find((x) => x.assignedToId !== teacherId);
    if (someoneElse) expect((await get(teacher, `/v1/messages/${someoneElse.id}`)).status).toBe(404);
  });

  it('report cards, exam changes, files and the app’s marks and registers stop at their classes', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const theirs = (await h.schoolSql<{ id: string }>("select id from students where class_id = $1 and status = 'active' limit 1", [other]))[0]!;
    const theirExam = (await h.schoolSql<{ id: string }>('select id from exams where class_id = $1 limit 1', [other]))[0];
    if (theirExam) {
      expect((await get(teacher, `/v1/exams/${theirExam.id}/report-cards/${theirs.id}`)).status).toBe(403);
      expect((await h.call('DELETE', `/v1/exams/${theirExam.id}`, { token: teacher })).status).toBe(403);
    }
    const subject = (await h.schoolSql<{ id: string }>('select id from subjects limit 1'))[0]!.id;
    const exam = { name: 'Class test', kind: '', classId: other, alsoClassIds: [], startsOn: day, endsOn: day, subjects: [{ subjectId: subject, maxMarks: 20 }] };
    expect((await h.call('POST', '/v1/exams', { token: teacher, body: exam })).status).toBe(403);
    // The app's marks draft, period roll and today's marks hold the same line.
    expect((await get(teacher, `/v1/f/classes/${other}/marks?subject=${subject.replace(/^sub_/, '')}`)).status).toBe(403);
    expect([403, 423]).toContain((await get(teacher, `/v1/f/attendance/periods?classId=${other}&date=${day}`)).status);
    expect(Object.keys((await get(teacher, `/v1/f/attendance/today?students=${theirs.id}`)).json)).toEqual([]);
    // A child's documents follow their class.
    const doc = (await h.schoolSql<{ id: string }>("select id from files where kind = 'student_document' and owner_id = $1 limit 1", [theirs.id]))[0];
    if (doc) expect((await get(teacher, `/v1/files/${doc.id}/url`)).status).toBe(403);
  });

  it('who has not acknowledged a notice and who replied to an event are their classes’ families only', async () => {
    const notice = (await h.schoolSql<{ id: string }>("select id from notices where audience = 'all' limit 1"))[0];
    if (notice) {
      const families = (await get(teacher, `/v1/notices/${notice.id}/not-acknowledged`)).json as { id: string }[];
      const everyone = (await get(principal, `/v1/notices/${notice.id}/not-acknowledged`)).json as { id: string }[];
      expect(families.length).toBeLessThanOrEqual(everyone.length);
      const outside = await h.schoolSql<{ id: string }>(
        `select g.user_id id from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id
         where g.user_id = any($1) and not exists (select 1 from student_guardians sg2 join students s2 on s2.id = sg2.student_id where sg2.guardian_id = g.id and s2.class_id = any($2))`,
        [families.map((f) => f.id), mine]);
      expect(outside).toEqual([]);
    }
    const event = (await h.schoolSql<{ event_id: string }>('select event_id from event_rsvps limit 1'))[0];
    if (event) {
      const replies = (await get(teacher, `/v1/events/${event.event_id}/replies`)).json as { className: string }[];
      const names = (await h.schoolSql<{ name: string }>('select name from classes where id = any($1)', [mine])).map((c) => c.name);
      expect(replies.every((r) => names.includes(r.className))).toBe(true);
    }
  });

  it('accounts see every class (their work spans the school)', async () => {
    const accounts = await h.login(h.people.accountant.email);
    expect((await get(accounts, '/v1/students?limit=1')).json.total).toBe((await get(principal, '/v1/students?limit=1')).json.total);
  });
});
