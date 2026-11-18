import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zip } from '@tangent/db';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let admin: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
  teacher = await h.login('kavita.iyer@greenfield.edu.in');
}, 240_000);
afterAll(async () => {
  await h?.close();
});

// The first bytes of a JPEG and of a PNG are all the job looks at.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);

describe('photos from a zip', () => {
  it('makes each photo named by an admission number that student’s photo, and lists what matched nobody', async () => {
    const [a, b, c] = await h.schoolSql("select id, admission_no from students where status = 'active' and admission_no <> '' order by admission_no limit 3");
    const file = zip([
      { name: `class 5/${a.admission_no.replace(/\//g, '-')}.JPG`, content: jpeg },
      { name: `${b.admission_no.replace(/\//g, '')}.png`, content: png },
      { name: 'NOBODY-123.jpg', content: jpeg },
      { name: 'notes.txt', content: 'not a photo' },
      { name: '__MACOSX/._x.jpg', content: jpeg },
      { name: `${c.admission_no.replace(/\//g, '_')}.webp`, content: Buffer.from('this is no webp') },
    ]);
    // The zip as the school's upload leaves it: in storage, checked.
    const { HubService } = await import('../src/school/hub.service.js');
    const hubs = h.app.get(HubService);
    const school = (await h.registry.query('select id from schools where slug = $1', [h.slug])).rows[0].id;
    const r = await hubs.hub.resolve('storage', school, h.slug);
    await r.adapter.storage!.put(r.ctx, `schools/${h.slug}/photo_zip/fil_zip1/photos.zip`, file, 'application/zip');
    await h.schoolSql("insert into files (id, kind, owner_id, name, mime, bytes, storage_key, status) values ('fil_zip1', 'photo_zip', 'school', 'photos.zip', 'application/zip', $1, $2, 'clean')",
      [file.length, `schools/${h.slug}/photo_zip/fil_zip1/photos.zip`]);
    expect((await h.call('POST', '/v1/moving-in/photos', { token: teacher, body: { fileId: 'fil_zip1' } })).status).toBe(403);
    const started = await h.call('POST', '/v1/moving-in/photos', { token: admin, body: { fileId: 'fil_zip1' } });
    expect(started.status, JSON.stringify(started.json)).toBe(200);
    expect((await h.call('POST', '/v1/moving-in/photos', { token: admin, body: { fileId: 'fil_zip1' } })).status).toBe(409);
    // The worker's turn, run here.
    const { PhotoZipService } = await import('../src/school/photo-zip.js');
    const msg = await (h.app.get(PhotoZipService) as any).run({ id: 'job_t', schoolId: school, kind: 'people.photoZip', payload: { importId: started.json[0].id }, attempts: 0 });
    expect(msg).toBe('2 of 4 photos matched.');
    const row = (await h.call('GET', '/v1/moving-in/photos', { token: admin })).json[0];
    expect(row).toMatchObject({ status: 'done', total: 4, done: 4, matched: 2 });
    expect(row.unmatched).toEqual(['NOBODY-123', `${c.admission_no.replace(/\//g, '_')} (not a photo)`]);
    const photos = await h.schoolSql("select owner_id, mime from files where kind = 'student_photo' and deleted_at is null and owner_id = any($1) order by owner_id", [[a.id, b.id]]);
    expect(photos.map((p: any) => p.owner_id).sort()).toEqual([a.id, b.id].sort());
    expect(photos.find((p: any) => p.owner_id === b.id).mime).toBe('image/png');
  });

  it('keeps a photo’s small copy beside it: only an image, only small, only by whoever added the photo', async () => {
    const me = (await h.call('GET', '/v1/me', { token: admin })).json;
    const userId = me.user?.id ?? me.id;
    await h.schoolSql("insert into files (id, kind, owner_id, name, mime, bytes, storage_key, status, created_by) values ('fil_ph1', 'gallery', 'alb_x', 'p.jpg', 'image/jpeg', 204, 'schools/x/gallery/fil_ph1/p.jpg', 'clean', $1)", [userId]);
    const data = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`;
    expect((await h.call('POST', '/v1/files/fil_ph1/thumb', { token: teacher, body: { data: data(jpeg) } })).status).toBe(403);
    expect((await h.call('POST', '/v1/files/fil_ph1/thumb', { token: admin, body: { data: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}` } })).status).toBe(400);
    expect([400, 413]).toContain((await h.call('POST', '/v1/files/fil_ph1/thumb', { token: admin, body: { data: data(Buffer.concat([jpeg, Buffer.alloc(410 * 1024)])) } })).status);
    const ok = await h.call('POST', '/v1/files/fil_ph1/thumb', { token: admin, body: { data: data(jpeg) } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json.thumbId).toMatch(/^fil_/);
    // A second copy replaces the first; neither is listed as a photo of its own.
    const again = (await h.call('POST', '/v1/files/fil_ph1/thumb', { token: admin, body: { data: data(jpeg) } })).json;
    expect(again.thumbId).not.toBe(ok.json.thumbId);
    expect((await h.schoolSql("select count(*)::int n from files where owner_id = 'thumb:fil_ph1' and deleted_at is null"))[0].n).toBe(1);
    expect((await h.schoolSql("select count(*)::int n from files where owner_id = 'alb_x' and deleted_at is null"))[0].n).toBe(1);
  });
});
