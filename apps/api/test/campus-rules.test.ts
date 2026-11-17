import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, codeForms, schoolInstant, schoolToday } from '@tangent/contracts';
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

/** The school's date (the demo school is in India), whatever the machine's zone. */
const today = () => schoolToday(new Date(), 'Asia/Kolkata');
const call = (token: string, method: string, path: string, body?: unknown) => h.call(method, path, { token, body });
const f = (token: string, url: string) => call(token, 'GET', `/v1/f${url}`);
const post = (token: string, url: string, body?: unknown) => call(token, 'POST', `/v1/f${url}`, body ?? {});
/** Priya's children with their year groups. */
const kids = () => h.schoolSql(
  `select s.id, c.grade, s.class_id from students s join classes c on c.id = s.class_id join student_guardians sg on sg.student_id = s.id
   join guardians g on g.id = sg.guardian_id join users u on u.id = g.user_id where u.email = 'priya.sharma@example.com' and s.status = 'active' order by s.id`);

describe('codeForms', () => {
  it('reads an ISBN in both its forms, and anything else as typed', () => {
    expect(codeForms('978-0-306-40615-7')).toEqual(['9780306406157', '0306406152']);
    expect(codeForms('0 306 40615 2')).toEqual(['0306406152', '9780306406157']);
    expect(codeForms('080442957x')).toEqual(['080442957X', '9780804429573']);
    expect(codeForms('lap-001')).toEqual(['LAP001']);
  });
});

describe('notice targets', () => {
  it('reaches only the year groups and houses chosen, and only someone who publishes may choose them', async () => {
    const mine = await kids();
    const grade = mine[0].grade;
    const other = (await h.schoolSql('select distinct grade from classes where grade <> all($1) order by grade limit 1', [mine.map((k: any) => k.grade)]))[0].grade;
    const make = (title: string, targets: unknown, audience = 'parents') => call(admin, 'POST', '/v1/notices', { title, body: 'A notice for some of the school.', audience, publish: true, targets });
    expect((await make('Targets: my year', { grades: [grade] })).status).toBeLessThan(300);
    expect((await make('Targets: another year', { grades: [other] })).status).toBeLessThan(300);
    expect((await make('Targets: no such year', { grades: [19] })).status).toBe(400);
    expect((await make('Targets: roles to families', { roles: ['principal'] })).status).toBe(400);
    await h.setSettings({ 'people.houses': [{ name: 'Red' }, { name: 'Blue' }] });
    await h.schoolSql("update students set house = 'Red' where id = any($1)", [mine.map((k: any) => k.id)]);
    expect((await make('Targets: red house', { houses: ['red'] })).status).toBeLessThan(300);
    expect((await make('Targets: blue house', { houses: ['Blue'] })).status).toBeLessThan(300);
    expect((await make('Targets: no such house', { houses: ['Green'] })).status).toBe(400);
    const titles = (await f(parent, '/notices')).json.map((n: any) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['Targets: my year', 'Targets: red house']));
    expect(titles).not.toContain('Targets: another year');
    expect(titles).not.toContain('Targets: blue house');
    // Aimed at some students, it is not one staff read.
    expect((await f(teacher, '/notices')).json.map((n: any) => n.title)).not.toContain('Targets: my year');
    // A teacher writes to the classes they teach, without targets.
    const taught = (await h.schoolSql("select c.id from classes c join users u on u.id = c.class_teacher_id where u.email = 'kavita.iyer@greenfield.edu.in' limit 1"))[0]?.id;
    expect((await call(teacher, 'POST', '/v1/notices', { title: 'Targets: by a teacher', body: 'Only some of my class.', audience: 'class', classId: taught, publish: true, targets: { houses: ['Red'] } })).status).toBe(403);
  });
});

describe('chat', () => {
  it('lets families write only to the teachers the school allows', async () => {
    const all = (await f(parent, '/contacts')).json;
    try {
      await h.setSettings({ 'chat.familiesWriteTo': ['classTeacher'] });
      const some = (await f(parent, '/contacts')).json;
      expect(some.every((c: any) => c.classTeacher)).toBe(true);
      expect(some.length).toBeLessThanOrEqual(all.length);
      const subjectOnly = all.find((c: any) => !c.classTeacher);
      if (subjectOnly) expect((await post(parent, '/threads', { teacherId: subjectOnly.id })).status).toBe(403);
    } finally {
      await h.setSettings({ 'chat.familiesWriteTo': ['classTeacher', 'subjectTeachers'] });
    }
  });
});

describe('event replies', () => {
  it('keeps to the closing day, the grown-ups per family and the places, and counts a family’s grown-ups once', async () => {
    const mine = await kids();
    const day = addDays(today(), 10);
    const event = (b: Record<string, unknown>) => ({ title: 'Rules check', startsAt: schoolInstant(day, '10:00').toISOString(), kind: 'event', audience: 'everyone', needsRsvp: true, ...b });
    expect((await call(admin, 'POST', '/v1/events', event({ rsvpBy: addDays(day, 1) }))).status).toBe(400);
    const e = (await call(admin, 'POST', '/v1/events', event({ rsvpBy: addDays(day, -1), maxAdults: 1, capacity: mine.length + 1 }))).json;
    // Someone else's child holds one place.
    const outsider = (await h.schoolSql("select id from students where status = 'active' and id <> all($1) limit 1", [mine.map((k: any) => k.id)]))[0].id;
    await h.schoolSql("insert into event_rsvps (event_id, student_id, status, adults) values ($1, $2, 'going', 0)", [e.id, outsider]);
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'going', adults: 2 })).status).toBe(400);
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'going', adults: 1 })).status).toBe(200);
    // Changing their own reply when the event is full is fine.
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'going', adults: 1 })).status).toBe(200);
    const row = (await call(admin, 'GET', '/v1/events')).json.find((x: any) => x.id === e.id);
    expect(row).toMatchObject({ going: mine.length + 1, adults: 1, capacity: mine.length + 1, maxAdults: 1 });
    // A full event takes no one more, and its places cannot drop below those going.
    await h.schoolSql("update event_rsvps set status = 'going' where event_id = $1", [e.id]);
    expect((await call(admin, 'PUT', `/v1/events/${e.id}`, event({ capacity: 1 }))).status).toBe(400);
    await h.schoolSql("delete from event_rsvps where event_id = $1 and student_id = $2", [e.id, mine[0].id]);
    await h.schoolSql("insert into event_rsvps (event_id, student_id, status, adults) values ($1, $2, 'going', 0)", [e.id, (await h.schoolSql("select id from students where status = 'active' and id <> all($1) and id <> $2 limit 1", [mine.map((k: any) => k.id), outsider]))[0].id]);
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'going', studentIds: [mine[0].id] })).status).toBe(409);
    // Saying they cannot come always works; after the closing day nothing does.
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'cant', studentIds: [mine[0].id] })).status).toBe(200);
    await h.schoolSql('update events set rsvp_by = $2 where id = $1', [e.id, addDays(today(), -1)]);
    expect((await post(parent, `/events/${e.id}/rsvp`, { status: 'maybe' })).status).toBe(409);
    expect((await f(parent, '/events')).json.find((x: any) => x.id === e.id).rsvpBy).toBe(addDays(today(), -1));
  });
});

describe('library rules', () => {
  it('lends by member type and item type, finds titles by any form of their code, and fines with grace days and a cap', async () => {
    const mine = await kids();
    const kid = mine[0];
    await h.setSettings({
      'library.itemTypes': [{ key: 'book', name: 'Book' }, { key: 'laptop', name: 'Laptop' }],
      'library.typeRules': { laptop: { loanDays: 2, maxRenewals: 0, finePerDay: 10 } },
      'library.memberTypes': [{ key: 'seniors', name: 'Seniors', staff: false, grades: [kid.grade], loanDays: 21, maxLoans: 1 }],
      'library.fineGraceDays': 2, 'library.fineCap': 15,
    });
    try {
      const add = (b: Record<string, unknown>) => call(admin, 'POST', '/v1/library/books', { author: '', category: 'General', shelf: '', copies: 2, ...b });
      expect((await add({ title: 'Drone', itemType: 'drone' })).status).toBe(400);
      const laptop = (await add({ title: 'Laptop 1', itemType: 'Laptop', barcode: 'LAP-001' })).json;
      expect(laptop.itemType).toBe('laptop');
      expect((await add({ title: 'Laptop 2', itemType: 'laptop', barcode: 'lap-001' })).status).toBe(400);
      const book = (await add({ title: 'Code forms', isbn: '0-306-40615-2' })).json;
      expect((await call(admin, 'GET', '/v1/library/scan?code=9780306406157')).json.id).toBe(book.id);
      expect((await call(admin, 'GET', '/v1/library/scan?code=LAP001')).json.id).toBe(laptop.id);
      expect((await call(admin, 'GET', '/v1/library/scan?code=nothing-here')).status).toBe(404);
      await h.schoolSql('update library_loans set returned_on = $2 where student_id = $1 and returned_on is null', [kid.id, today()]);
      const loan = (await call(admin, 'POST', '/v1/library/loans', { bookId: laptop.id, studentId: kid.id })).json;
      expect(loan.dueOn).toBe(addDays(today(), 2));
      // A senior may have one item out.
      expect((await call(admin, 'POST', '/v1/library/loans', { bookId: book.id, studentId: kid.id })).status).toBe(409);
      // Five days late, two of grace, ten a day: thirty, capped at fifteen.
      await h.schoolSql('update library_loans set due_on = $2 where id = $1', [loan.id, addDays(today(), -5)]);
      expect((await call(admin, 'GET', '/v1/library')).json.loans.find((l: any) => l.id === loan.id)).toMatchObject({ fine: 15, overdueDays: 5, maxRenewals: 0 });
      expect((await post(parent, `/library/books/${laptop.id}/renew`)).status).toBe(409);
      expect((await call(admin, 'POST', `/v1/library/loans/${loan.id}/return`, { outcome: 'returned', fine: 'paid' })).json.fine).toBe(15);
    } finally {
      await h.setSettings({ 'library.itemTypes': [{ key: 'book', name: 'Book' }], 'library.typeRules': {}, 'library.memberTypes': [], 'library.fineGraceDays': 0, 'library.fineCap': 0 });
    }
  });
});

describe('bus trips', () => {
  it('runs only the school’s trips the route runs, by its driver or attendant (a teaching attendant keeps the teachers’ app)', async () => {
    await h.setSettings({ 'transport.sessions': [{ key: 'morning', name: 'Morning', from: '00:00' }, { key: 'afternoon', name: 'Afternoon', from: '12:00' }, { key: 'late', name: 'Late bus', from: '16:30' }] });
    const route = (await call(admin, 'GET', '/v1/transport')).json.routes[0];
    const kavita = (await h.schoolSql("select id from users where email = 'kavita.iyer@greenfield.edu.in'"))[0].id;
    const body = (b: Record<string, unknown>) => ({ name: route.name, vehicle: route.vehicle, driverUserId: route.driverUserId, attendantName: '', attendantPhone: '', trackerId: route.trackerId, fee: route.fee,
      stops: route.stops.map((s: any) => ({ id: s.id, name: s.name, pickup: s.pickup, dropTime: s.dropTime, lat: s.lat, lng: s.lng })), ...b });
    expect((await call(admin, 'PUT', `/v1/transport/routes/${route.id}`, body({ sessions: ['night'] }))).status).toBe(400);
    if (route.driverUserId) expect((await call(admin, 'PUT', `/v1/transport/routes/${route.id}`, body({ attendantUserId: route.driverUserId }))).status).toBe(400);
    const saved = await call(admin, 'PUT', `/v1/transport/routes/${route.id}`, body({ sessions: ['late'], attendantUserId: kavita }));
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json).toMatchObject({ sessions: ['late'], attendantUserId: kavita });
    const crew = teacher;
    expect((await f(crew, '/me')).json.role ?? 'teacher').not.toBe('driver');
    const day = (await f(crew, '/driver/day')).json.routes.find((r: any) => r.id === route.id);
    expect(day.sessions.map((s: any) => s.key)).toEqual(['late']);
    expect((await post(crew, '/driver/trips', { routeId: route.id, kind: 'morning' })).status).toBe(400);
    const trip = await post(crew, '/driver/trips', { routeId: route.id, kind: 'late' });
    expect(trip.status).toBe(200);
    expect((await call(admin, 'GET', '/v1/transport')).json.routes.find((r: any) => r.id === route.id).trips.find((x: any) => x.id === trip.json.id).name).toBe('Late bus');
    await call(admin, 'PUT', `/v1/transport/routes/${route.id}`, body({ sessions: [], attendantUserId: null }));
  });
});
