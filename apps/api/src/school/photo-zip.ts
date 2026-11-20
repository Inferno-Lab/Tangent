import { Body, Controller, Get, HttpCode, Injectable, Post, type OnModuleInit } from '@nestjs/common';
import { tx } from '@tangent/contracts';
import { enqueue, newId, unzip, type Job } from '@tangent/db';
import { ApiError, ZodPipe, notFound } from '@tangent/nest-kit';
import { z } from 'zod';
import { Core, CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { HubService } from './hub.service.js';
import { AuditService } from './support.js';

const MB = 1024 * 1024;
const Start = z.object({ fileId: z.string().min(1).max(60) });
export interface PhotoImportRow { id: string; status: 'waiting' | 'running' | 'done' | 'failed'; total: number; done: number; matched: number; unmatched: string[]; error: string | null; by: string; createdAt: string; doneAt: string | null }

/** An admission number or a file name as letters and digits only: "2019/0412" is saved as 2019-0412.jpg or 20190412.jpg. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const typeOf = (b: Buffer) => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png'
  : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null);

/**
 * Students' photos and documents from one zip (Moving in): each file is named by the student's admission number, in any folder.
 * A photo becomes the student's photo; a PDF (a report card, a transfer certificate, a birth certificate) is added to the
 * student's documents under the rest of its name ("2019-0412 Report card Term 1.pdf"). Names matching nobody, and files that
 * are neither, are listed.
 */
@Injectable()
export class PhotoZipService implements OnModuleInit {
  constructor(private readonly hubs: HubService, private readonly audit: AuditService) {}

  onModuleInit(): void {
    this.hubs.handle('people.photoZip', (job) => this.run(job));
  }

  async list(t: TenantCtx): Promise<PhotoImportRow[]> {
    const { rows } = await t.pool.query('select * from photo_imports order by created_at desc limit 20');
    return rows.map((r) => ({ id: r.id, status: r.status, total: r.total, done: r.done, matched: r.matched, unmatched: r.unmatched ?? [], error: r.error, by: r.by_name,
      createdAt: r.created_at.toISOString(), doneAt: r.done_at?.toISOString() ?? null }));
  }

  async start(t: TenantCtx, user: AuthedUser, fileId: string): Promise<PhotoImportRow[]> {
    const f = (await t.pool.query<{ status: string }>("select status from files where id = $1 and kind = 'photo_zip' and deleted_at is null", [fileId])).rows[0];
    if (!f) throw notFound(tx('That zip'));
    if (f.status === 'infected') throw new ApiError('validation', tx('The virus check found a problem in that zip. It was not kept.'));
    if ((await t.pool.query("select 1 from photo_imports where file_id = $1", [fileId])).rowCount) throw new ApiError('conflict', tx('That zip is already being read.'));
    const id = newId('phi');
    await t.pool.query('insert into photo_imports (id, file_id, by_name) values ($1,$2,$3)', [id, fileId, user.name]);
    await enqueue(this.hubs.hub.o.pool as never, 'people.photoZip', t.info.id, { importId: id });
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'photos.import', entity: 'file', entityId: fileId });
    return this.list(t);
  }

  private async run(job: Job): Promise<string> {
    const s = await this.hubs.schoolPool(job.schoolId ?? '');
    if (!s) return 'School not found.';
    const imp = (await s.pool.query<{ id: string; file_id: string; created_at: Date }>('select id, file_id, created_at from photo_imports where id = $1', [String(job.payload.importId)])).rows[0];
    if (!imp) return 'Nothing to do.';
    const fail = async (why: string) => { await s.pool.query("update photo_imports set status = 'failed', error = $2, done_at = now() where id = $1", [imp.id, why]); return why; };
    const f = (await s.pool.query<{ status: string; storage_key: string }>('select status, storage_key from files where id = $1', [imp.file_id])).rows[0];
    if (!f || f.status === 'infected') return fail(tx('The zip is gone, or the virus check found a problem in it.'));
    // The zip is read only once its virus check is done (the photos in it were checked with it).
    if (f.status !== 'clean') {
      if (Date.now() - imp.created_at.getTime() > 3600_000) return fail(tx('The virus check of the zip did not finish. Send it again.'));
      await enqueue(this.hubs.hub.o.pool as never, 'people.photoZip', s.id, { importId: imp.id, retry: Date.now() }, new Date(Date.now() + 60_000));
      return 'Waiting for the virus check.';
    }
    await s.pool.query("update photo_imports set status = 'running' where id = $1", [imp.id]);
    const r = await this.hubs.hub.resolve('storage', s.id, s.slug);
    let entries: Map<string, Buffer>;
    try { entries = unzip(await r.adapter.storage!.get(r.ctx, f.storage_key)); } catch { return fail(tx('This is not a zip Tangent can read.')); }
    // Photos and PDFs: folders, hidden files and the Mac's copies are left out.
    const photos = [...entries].filter(([name, data]) => data.length && !/(^|\/)(__MACOSX|\.)/.test(name) && /\.(jpe?g|png|webp|pdf)$/i.test(name));
    const students = new Map((await s.pool.query<{ id: string; admission_no: string }>("select id, admission_no from students where admission_no <> ''")).rows.map((x) => [norm(x.admission_no), x.id]));
    await s.pool.query('update photo_imports set total = $2 where id = $1', [imp.id, photos.length]);
    const unmatched: string[] = [];
    let matched = 0;
    let done = 0;
    const ids = new Map(students);
    for (const [name, data] of photos) {
      const base = name.split('/').pop()!.replace(/\.[^.]+$/, '');
      if (/\.pdf$/i.test(name)) {
        // The admission number is the name's first words; what follows names the document.
        const words = base.split(/[\s_]+/).filter(Boolean);
        const k = words.map((_, i) => words.length - i).find((n) => ids.has(norm(words.slice(0, n).join(''))));
        const student = k ? ids.get(norm(words.slice(0, k).join(''))) : undefined;
        if (!student || data.subarray(0, 5).toString('latin1') !== '%PDF-' || data.length > 15 * MB) unmatched.push(!student ? base : `${base} (${data.length > 15 * MB ? tx('over 15 MB') : tx('not a PDF')})`);
        else {
          const id = newId('fil');
          const label = words.slice(k).join(' ') || base;
          await r.adapter.storage!.put(r.ctx, `schools/${s.slug}/student_document/${id}/${base.replace(/[^\w.-]+/g, '_').slice(-80)}.pdf`, data, 'application/pdf');
          await s.pool.query("insert into files (id, kind, owner_id, name, mime, bytes, storage_key, status) values ($1,'student_document',$2,$3,'application/pdf',$4,$5,'clean')",
            [id, student, `${label}.pdf`, data.length, `schools/${s.slug}/student_document/${id}/${base.replace(/[^\w.-]+/g, '_').slice(-80)}.pdf`]);
          matched++;
        }
        if (++done % 20 === 0) await s.pool.query('update photo_imports set done = $2, matched = $3 where id = $1', [imp.id, done, matched]);
        continue;
      }
      const student = students.get(norm(base));
      const mime = typeOf(data);
      if (!student || !mime || data.length > 5 * MB) unmatched.push(!student ? base : `${base} (${!mime ? tx('not a photo') : tx('over 5 MB')})`);
      else {
        const id = newId('fil');
        const key = `schools/${s.slug}/student_photo/${id}/${name.split('/').pop()!.replace(/[^\w.-]+/g, '_').slice(-80)}`;
        await r.adapter.storage!.put(r.ctx, key, data, mime);
        await s.pool.query("insert into files (id, kind, owner_id, name, mime, bytes, storage_key, status) values ($1,'student_photo',$2,$3,$4,$5,$6,'clean')", [id, student, name.split('/').pop(), mime, data.length, key]);
        // The new photo replaces the old (kept deleted, as when the office approves a family's photo).
        await s.pool.query("update files set deleted_at = now() where kind = 'student_photo' and owner_id = $1 and id <> $2 and deleted_at is null", [student, id]);
        students.delete(norm(base));
        matched++;
      }
      if (++done % 20 === 0) await s.pool.query('update photo_imports set done = $2, matched = $3 where id = $1', [imp.id, done, matched]);
    }
    await s.pool.query("update photo_imports set status = 'done', done = $2, matched = $3, unmatched = $4, done_at = now() where id = $1", [imp.id, done, matched, JSON.stringify(unmatched.slice(0, 500))]);
    return `${matched} of ${photos.length} photos and documents matched.`;
  }
}

@Controller('v1/moving-in/photos')
@Core()
export class PhotoZipController {
  constructor(private readonly photos: PhotoZipService) {}

  @Get() @RequireModule('people') @Require('students.write')
  list(@Tenant() t: TenantCtx): Promise<PhotoImportRow[]> { return this.photos.list(t); }

  @Post() @HttpCode(200) @RequireModule('people') @Require('students.write')
  start(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(Start)) b: z.infer<typeof Start>): Promise<PhotoImportRow[]> { return this.photos.start(t, u, b.fileId); }
}
