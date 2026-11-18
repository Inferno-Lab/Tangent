import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, schoolToday } from '@tangent/contracts';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let admin: string;
let parent: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
  parent = await h.login('priya.sharma@example.com');
  teacher = await h.login('kavita.iyer@greenfield.edu.in');
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (token: string | undefined, method: string, path: string, body?: unknown) => h.call(method, path, { token, body });
const today = () => schoolToday(new Date(), 'Asia/Kolkata');
const trip = {
  title: 'Zoo trip consent', intro: 'The Year trip to the zoo.', audience: 'families', perChild: true, status: 'open',
  fields: [
    { key: 'goes', label: 'May your child go?', kind: 'yesno', required: true },
    { key: 'allergies', label: 'Allergies we should know', kind: 'longText', required: true },
    { key: 'lunch', label: 'Lunch', kind: 'choice', options: [{ key: 'own', name: 'Brings own' }, { key: 'school', name: 'School lunch' }] },
  ],
  conditions: { allergies: { key: 'goes', equals: 'yes' } },
};

describe('forms', () => {
  it('refuses a condition on a later question, or on one that is not a choice', async () => {
    expect((await call(admin, 'POST', '/v1/forms', { ...trip, conditions: { goes: { key: 'allergies', equals: 'x' } } })).status).toBe(400);
    expect((await call(admin, 'POST', '/v1/forms', { ...trip, conditions: { lunch: { key: 'allergies', equals: 'x' } } })).status).toBe(400);
    expect((await call(teacher, 'POST', '/v1/forms', trip)).status).toBe(403);
  });

  it('asks families once per child, only the questions that apply, and keeps the questions once answered', async () => {
    const f = (await call(admin, 'POST', '/v1/forms', trip)).json;
    const mine = (await call(parent, 'GET', '/v1/f/forms')).json.find((x: any) => x.id === f.id);
    expect(mine.pending.length).toBeGreaterThan(0);
    const child = mine.pending[0];
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { answers: { goes: true } })).status).toBe(400);
    // Going: the allergies question applies and is needed.
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { studentId: child, answers: { goes: 'yes' } })).status).toBe(400);
    // Not going: the allergies question does not apply, and an answer to it is not kept.
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { studentId: child, answers: { goes: 'no', allergies: 'Nuts' } })).status).toBe(200);
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { studentId: 'stu_somebody_else', answers: { goes: 'no' } })).status).toBe(400);
    // A second answer for the same child replaces the first.
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { studentId: child, answers: { goes: 'yes', allergies: 'Nuts', lunch: 'own' } })).status).toBe(200);
    const r = (await call(admin, 'GET', `/v1/forms/${f.id}/responses`)).json;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].answers).toMatchObject({ goes: true, allergies: 'Nuts', lunch: 'own' });
    expect((await call(parent, 'GET', '/v1/f/forms')).json.find((x: any) => x.id === f.id).pending).not.toContain(child);
    expect((await call(teacher, 'GET', '/v1/f/forms')).json.some((x: any) => x.id === f.id)).toBe(false);
    expect((await call(teacher, 'POST', `/v1/f/forms/${f.id}`, { answers: { goes: 'no' } })).status).toBe(403);
    const csv = await h.call('GET', `/v1/forms/${f.id}/responses.csv`, { token: admin });
    expect(csv.text).toContain('Nuts');
    // Answered: a question cannot be taken away or change kind, nor can the form be deleted; closing it ends answers.
    expect((await call(admin, 'PUT', `/v1/forms/${f.id}`, { ...trip, fields: trip.fields.slice(0, 2), conditions: trip.conditions })).status).toBe(409);
    expect((await call(admin, 'DELETE', `/v1/forms/${f.id}`)).status).toBe(409);
    expect((await call(admin, 'PUT', `/v1/forms/${f.id}`, { ...trip, title: 'Zoo trip consent (closed)', status: 'closed' })).status).toBe(200);
    expect((await call(parent, 'POST', `/v1/f/forms/${f.id}`, { studentId: child, answers: { goes: 'no' } })).status).toBe(409);
  });

  it('takes answers by link without signing in, closes on its day, and limits one address', async () => {
    const f = (await call(admin, 'POST', '/v1/forms', { title: 'Open day feedback', audience: 'link', status: 'open', closesOn: addDays(today(), 3),
      fields: [{ key: 'rating', label: 'How was it?', kind: 'number', required: true }] })).json;
    expect(f.token).toBeTruthy();
    expect((await call(undefined, 'GET', `/v1/forms/link/${f.token}`)).json).toMatchObject({ title: 'Open day feedback', open: true });
    expect((await call(undefined, 'GET', '/v1/forms/link/not-a-token')).status).toBe(404);
    expect((await call(undefined, 'POST', `/v1/forms/link/${f.token}`, { answers: { rating: 'great' } })).status).toBe(400);
    // A robot filling the hidden field is told it worked, and nothing is kept.
    expect((await call(undefined, 'POST', `/v1/forms/link/${f.token}`, { answers: { rating: 5 }, website: 'spam.example' })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await call(undefined, 'POST', `/v1/forms/link/${f.token}`, { answers: { rating: i } })).status).toBe(200);
    expect((await call(undefined, 'POST', `/v1/forms/link/${f.token}`, { answers: { rating: 5 } })).status).toBe(429);
    expect((await call(admin, 'GET', `/v1/forms/${f.id}/responses`)).json.rows).toHaveLength(10);
    await h.schoolSql('update forms set closes_on = $2 where id = $1', [f.id, addDays(today(), -1)]);
    expect((await call(undefined, 'GET', `/v1/forms/link/${f.token}`)).json.open).toBe(false);
    // A draft is nobody's to fill.
    const draft = (await call(admin, 'POST', '/v1/forms', { title: 'Draft link', audience: 'link', fields: [{ key: 'a', label: 'A', kind: 'text' }] })).json;
    expect((await call(undefined, 'GET', `/v1/forms/link/${draft.token}`)).status).toBe(404);
  });
});
