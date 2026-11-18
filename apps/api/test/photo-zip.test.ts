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
});
