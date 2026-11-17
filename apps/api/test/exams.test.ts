import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, schoolToday } from '@tangent/contracts';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let token: string;
beforeAll(async () => {
  h = await startHarness();
  token = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (method: string, path: string, body?: unknown) => h.call(method, path, { token, body });
const staffId = async (q: string) => (await call('GET', `/v1/staff?query=${q}`)).json[0].id as string;
const subjects = async () => (await call('GET', '/v1/subjects')).json.map((s: any) => s.id) as string[];

describe('exams the school’s way', () => {
  it('takes its kind from the school’s list and keeps an invigilator to one room at a time', async () => {
    const [a, b] = await subjects();
    const day = addDays(schoolToday(), 20);
    const kavita = await staffId('Kavita');
    const exam = (kind: string, papers: unknown[]) => call('POST', '/v1/exams', { name: `Check ${kind || 'none'} ${Math.random().toString(36).slice(2, 6)}`, kind, classId: 'cls_7a', startsOn: day, endsOn: day, subjects: papers });
    expect((await exam('nonsense', [{ subjectId: a, onDate: day, maxMarks: 50 }])).status).toBe(400);
    const twice = [{ subjectId: a, onDate: day, startsAt: '09:00', endsAt: '10:00', invigilatorId: kavita }, { subjectId: b, onDate: day, startsAt: '09:30', endsAt: '10:30', invigilatorId: kavita }];
    expect((await exam('term', twice)).status).toBe(409);
    const made = await exam('term', [{ subjectId: a, onDate: day, startsAt: '09:00', endsAt: '10:00', invigilatorId: kavita }]);
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ kind: 'term' });
    expect(made.json.subjects[0]).toMatchObject({ invigilatorId: kavita, invigilatorName: expect.stringContaining('Kavita') });
    // Another exam that day cannot take her at the same time.
    expect((await call('POST', '/v1/exams', { name: 'Clash', classId: 'cls_7b', startsOn: day, endsOn: day, subjects: [{ subjectId: a, onDate: day, startsAt: '09:45', endsAt: '10:15', invigilatorId: kavita }] })).status).toBe(409);
    await call('DELETE', `/v1/exams/${made.json.id}`);
  });

  it('grades a subject straight away where its scheme says so, and counts the grade as its band', async () => {
    const [a, b] = await subjects();
    await h.setSettings({ 'grading.schemes': [{ key: 'early', name: 'Early years', kind: 'bands', passPct: 40, entry: 'grade', subjects: [b], bands: [{ grade: 'Exceeding', minPct: 80 }, { grade: 'Expected', minPct: 50 }, { grade: 'Emerging', minPct: 0 }] }] });
    try {
      const day = addDays(schoolToday(), -2);
      const e = (await call('POST', '/v1/exams', { name: `Mixed ${Date.now()}`, classId: 'cls_6b', startsOn: day, endsOn: day, subjects: [{ subjectId: a, maxMarks: 50 }, { subjectId: b, maxMarks: 50 }] })).json;
      expect(e.subjects.find((s: any) => s.subjectId === b).grades).toEqual(['Exceeding', 'Expected', 'Emerging']);
      const stu = (await call('GET', `/v1/exams/${e.id}/marks`)).json.students[0].studentId;
      expect((await call('PUT', `/v1/exams/${e.id}/marks`, { marks: [{ studentId: stu, subjectId: b, score: 40 }] })).status).toBe(400);
      expect((await call('PUT', `/v1/exams/${e.id}/marks`, { marks: [{ studentId: stu, subjectId: b, score: null, grade: 'Brilliant' }] })).status).toBe(400);
      expect((await call('PUT', `/v1/exams/${e.id}/marks`, { marks: [{ studentId: stu, subjectId: a, score: null, grade: 'Expected' }] })).status).toBe(400);
      const put = await call('PUT', `/v1/exams/${e.id}/marks`, { marks: [{ studentId: stu, subjectId: b, score: null, grade: 'expected' }, { studentId: stu, subjectId: a, score: 45.5 }] });
      expect(put.json.students.find((s: any) => s.studentId === stu).marks[b]).toMatchObject({ grade: 'Expected', score: null });
      // 45.5 of 50 and "Expected" (50%) of 50: 70.5 of 100.
      const row = (await call('GET', `/v1/exams/${e.id}/results`)).json.rows.find((r: any) => r.studentId === stu);
      expect(row).toMatchObject({ total: 70.5, max: 100, pct: 71 });
      // A remark, shown on the report card.
      expect((await call('PUT', `/v1/exams/${e.id}/remarks`, { remarks: [{ studentId: stu, remark: 'Reads widely and well.' }] })).json.students.find((s: any) => s.studentId === stu).remark).toBe('Reads widely and well.');
      expect((await call('PUT', `/v1/exams/${e.id}/remarks`, { remarks: [{ studentId: 'stu_nobody', remark: 'x' }] })).status).toBe(400);
      await call('DELETE', `/v1/exams/${e.id}`);
    } finally {
      await h.setSettings({ 'grading.schemes': [] });
    }
  });

  it('ranks across the year group when the school says so, and weighs each kind of exam in the year’s result', async () => {
    const [a] = await subjects();
    const day = addDays(schoolToday(), -3);
    const name = `Year check ${Date.now()}`;
    const made = (await call('POST', '/v1/exams', { name, kind: 'term', classId: 'cls_9a', alsoClassIds: ['cls_9b'], startsOn: day, endsOn: day, subjects: [{ subjectId: a, maxMarks: 10 }] })).json;
    const ids = (await call('GET', '/v1/exams')).json.filter((x: any) => x.name === name).map((x: any) => x.id);
    expect(ids).toHaveLength(2);
    for (const [i, id] of ids.entries()) {
      const stus = (await call('GET', `/v1/exams/${id}/marks`)).json.students;
      await call('PUT', `/v1/exams/${id}/marks`, { marks: stus.map((s: any, j: number) => ({ studentId: s.studentId, subjectId: a, score: i === 0 ? Math.min(10, 2 + (j % 3)) : 10 })) });
    }
    const classOnly = (await call('GET', `/v1/exams/${made.id}/results`)).json.rows;
    await h.setSettings({ 'results.rankWithin': 'year' });
    try {
      const across = (await call('GET', `/v1/exams/${ids.find((x: string) => x !== made.id) ?? ids[0]}/results`)).json.rows;
      // The other class scored 10 of 10 everywhere, so its best are first in the year either way; the first class's best fall back.
      expect(across.every((r: any) => r.rank === 1)).toBe(true);
      const mine = (await call('GET', `/v1/exams/${ids[0]}/results`)).json.rows;
      if (mine[0].pct < 100) expect(Math.min(...mine.map((r: any) => r.rank))).toBeGreaterThan(Math.min(...classOnly.map((r: any) => r.rank)));
    } finally {
      await h.setSettings({ 'results.rankWithin': 'class' });
    }
    for (const id of ids) await call('POST', `/v1/exams/${id}/publish`);
    await h.setSettings({ 'exams.weights': { term: 2, unit: 1 } });
    try {
      const r = (await call('GET', '/v1/reports/results-year?classId=cls_9b')).json;
      expect(r.columns.map((c: any) => c.key)).toEqual(['student', 'class', 'exams', 'pct', 'grade']);
      expect(r.rows.length).toBeGreaterThan(10);
    } finally {
      await h.setSettings({ 'exams.weights': {} });
    }
  });

  it('takes marks from the teachers’ app: absent as -1 both ways, a half mark kept when the app sends it back rounded, grades for a graded subject', async () => {
    const teacher = await h.login('kavita.iyer@greenfield.edu.in');
    const app = (method: string, path: string, body?: unknown) => h.call(method, `/v1/f${path}`, { token: teacher, body });
    const day = addDays(schoolToday(), -1);
    const e = (await call('POST', '/v1/exams', { name: `App marks ${Date.now()}`, classId: 'cls_8a', startsOn: day, endsOn: day, subjects: [{ subjectId: 'sub_maths', maxMarks: 50 }] })).json;
    const [a, b] = (await call('GET', `/v1/exams/${e.id}/marks`)).json.students.map((s: any) => s.studentId);
    expect((await app('POST', '/classes/cls_8a/marks', { subject: 'maths', values: { [a]: -1, [b]: 40 } })).status).toBe(200);
    expect((await app('GET', '/classes/cls_8a/marks?subject=maths')).json.marks).toMatchObject({ [a]: -1, [b]: 40 });
    await call('PUT', `/v1/exams/${e.id}/marks`, { marks: [{ studentId: b, subjectId: 'sub_maths', score: 45.5 }] });
    expect((await app('GET', '/classes/cls_8a/marks?subject=maths')).json.marks[b]).toBe(46);
    await app('POST', '/classes/cls_8a/marks', { subject: 'maths', values: { [b]: 46 } });
    expect((await call('GET', `/v1/exams/${e.id}/marks`)).json.students.find((s: any) => s.studentId === b).marks.sub_maths.score).toBe(45.5);
    await h.setSettings({ 'grading.schemes': [{ key: 'm', name: 'Maths', kind: 'bands', passPct: 40, entry: 'grade', subjects: ['sub_maths'], bands: [{ grade: 'Secure', minPct: 60 }, { grade: 'Developing', minPct: 0 }] }] });
    try {
      const draft = (await app('GET', '/classes/cls_8a/marks?subject=maths')).json;
      expect(draft.grades).toEqual(['Secure', 'Developing']);
      expect((await app('POST', '/classes/cls_8a/marks', { subject: 'maths', values: {}, grades: { [b]: 'secure' } })).status).toBe(200);
      expect((await app('GET', '/classes/cls_8a/marks?subject=maths')).json.gradeMarks[b]).toBe('Secure');
    } finally {
      await h.setSettings({ 'grading.schemes': [] });
      await call('DELETE', `/v1/exams/${e.id}`);
    }
  });
});
