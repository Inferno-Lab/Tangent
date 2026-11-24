import type pg from 'pg';
import { checkCustom, customText, rawOf, IMPORT_KINDS, PREVIEW_ROWS, importKind, type CustomEntity, type FieldDef, type ImportBatchRow, type ImportInput, type ImportKind, type ImportPreview, type ImportRowCheck, tx } from '@tangent/contracts';
import { ImportError, readTable, toCsv, xlsx, zip } from './files.js';
import { KINDS, type Impl, type Row, type Write } from './kinds.js';
import { savedSetting } from '../numbers.js';

type Q = pg.Pool | pg.PoolClient;
type Rec = Record<string, unknown>;
/** What one table write changed: the keys of rows it added and the rows it changed, as they were before. */
interface Change { table: string; pk: string[]; created: Rec[]; updated: Rec[] }

export const UNDO_DAYS = 30;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Other systems' exports, recognised by columns only they have. Their aliases are a working guess from those products'
 * usual export columns; replace them with real exports from the first schools that move (production plan, Phase 3).
 */
const SOURCES: { key: string; marks: string[]; aliases: Record<string, string> }[] = [
  { key: 'fedena', marks: ['batchname', 'firstname', 'admissionno'], aliases: { admissionno: 'admission_no', firstname: 'name', middlename: 'name', lastname: 'name', batchname: 'class', dateofbirth: 'dob', bloodgroup: 'blood_group', admissiondate: 'admitted_on', fathername: 'guardian_name', fathermobilephone: 'guardian_phone', fatheremail: 'guardian_email', mothername: 'guardian2_name', mothermobilephone: 'guardian2_phone', rollnumber: 'roll_no', employeenumber: 'external_id', employeename: 'name', employeedepartment: 'department', employeeposition: 'designation', mobilephone: 'phone' } },
  { key: 'entab', marks: ['admno', 'classsec', 'studentname'], aliases: { admno: 'admission_no', studentname: 'name', classsec: 'class', dob: 'dob', fname: 'guardian_name', fmobile: 'guardian_phone', femail: 'guardian_email', mname: 'guardian2_name', mmobile: 'guardian2_phone', rollno: 'roll_no', house: 'house', doa: 'admitted_on' } },
];

/** A file's table: its header row and data rows. Typed rows from the quick-entry grid come keyed by column already. */
function readInput(kind: ImportKind, input: Pick<ImportInput, 'csv' | 'rows'>): { headers: string[]; data: string[][] } {
  if (input.rows) {
    const headers = kind.columns.map((c) => c.key);
    return { headers, data: input.rows.map((r) => headers.map((h) => (r[h] ?? '').trim())).filter((r) => r.some(Boolean)) };
  }
  const table = readTable(input.csv ?? '');
  // A school's spreadsheet often has a title, a date or a blank line above its headers: the header row is the one among the
  // first ten whose cells name the most of this kind's columns (the first row when none names any).
  const named = (row: string[]) => Object.values(autoMap(kind, row, detectSource(kind, row))).filter(Boolean).length;
  const top = table.slice(0, 10).map(named);
  const at = top.indexOf(Math.max(0, ...top));
  const [headers = [], ...data] = table.slice(Math.max(0, at));
  return { headers, data };
}

function detectSource(kind: ImportKind, headers: string[]): string {
  const hs = new Set(headers.map(norm));
  if (kind.columns.filter((c) => c.required).every((c) => hs.has(norm(c.key)))) return 'tangent';
  return SOURCES.find((s) => s.marks.filter((m) => hs.has(m)).length >= 2)?.key ?? 'sheet';
}

/** File column -> import column. Several file columns may feed one (first, middle and last name are joined). */
function autoMap(kind: ImportKind, headers: string[], source: string): Record<string, string> {
  const preset = SOURCES.find((s) => s.key === source)?.aliases ?? {};
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const h of headers) {
    const n = norm(h);
    // A known system's own columns first (its "Mother name" is the second guardian); then the first column this header
    // names that no earlier header took, so "Father name" and "Mother name" in one file become two guardians, not one.
    const named = kind.columns.filter((c) => norm(c.key) === n || norm(c.label) === n || norm(rawOf(c).label) === n || (c.aliases ?? []).some((a) => norm(a) === n));
    const hit = (kind.columns.some((c) => c.key === preset[n]) ? preset[n] : undefined)
      ?? (named.find((c) => !taken.has(c.key)) ?? named[0])?.key
      ?? (n === 'firstname' || n === 'middlename' || n === 'lastname' ? kind.columns.find((c) => c.key === 'name')?.key : undefined);
    if (hit) taken.add(hit);
    out[h] = hit ?? '';
  }
  return out;
}

const signature = (kind: string, headers: string[]) => `${kind}:${headers.map(norm).sort().join('|')}`;

interface Checked { preview: ImportPreview; valid: Row[]; impl: Impl<unknown>; lookups: unknown; own: FieldDef[] }

// A big file is read and checked a few thousand rows at a time, letting the server answer everyone else in between: one
// long loop over a year of attendance held every other request for seconds.
const TICK = 2000;
const tick = () => new Promise<void>((ok) => setImmediate(ok));
async function each<T, U>(list: T[], fn: (x: T, i: number) => U): Promise<U[]> {
  const out: U[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    if (i && i % TICK === 0) await tick();
    out[i] = fn(list[i]!, i);
  }
  return out;
}

/** Who runs an import, when it is a school's own staff: the permissions they hold, so a sheet cannot give more than they have. */
export interface ImportBy { grants?: readonly string[] }

async function check(db: Q, input: ImportInput, by: ImportBy = {}): Promise<Checked> {
  const kind = await ownKind(db, input.kind);
  const impl = KINDS[input.kind] as Impl<unknown> | undefined;
  if (!kind || !impl) throw new ImportError(tx('There is no import for “{kind}”.', { kind: input.kind }));
  const own = await ownFields(db, input.kind);
  const { headers, data } = readInput(kind, input);
  const source = input.rows ? 'typed' : detectSource(kind, headers);
  const saved = input.rows ? undefined : (await db.query<{ mapping: Record<string, string>; value_map: Record<string, Record<string, string>> }>('select mapping, value_map from import_mappings where signature = $1', [signature(kind.key, headers)])).rows[0];
  const mapping = input.mapping ?? saved?.mapping ?? autoMap(kind, headers, source);
  // Typed rows are taken as typed; a file's values are read through the mapping it was given or had last time.
  const values = input.rows ? {} : input.values ?? saved?.value_map ?? {};
  const same = (v: string) => v.trim().toLowerCase();
  const meaning = Object.fromEntries(Object.entries(values).map(([k, m]) => [k, new Map(Object.entries(m).map(([from, to]) => [same(from), to]))]));
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing = kind.columns.filter((c) => c.required && !mapped.has(c.key)).map((c) => c.label);
  const rows: Row[] = await each(data, (cells) => {
    const r: Row = {};
    for (const col of kind.columns) r[col.key] = '';
    headers.forEach((h, i) => { const k = mapping[h]; if (k && cells[i]) r[k] = r[k] ? `${r[k]} ${cells[i]}` : cells[i]!; });
    for (const [k, m] of Object.entries(meaning)) if (r[k] && m.has(same(r[k]))) r[k] = m.get(same(r[k]))!;
    return r;
  });
  // Values none of a column's choices match, for the person to say what each means.
  const unmatched: Record<string, string[]> = {};
  if (!input.rows) {
    for (const c of kind.columns.filter((x) => x.options?.length)) {
      const ok = new Set(c.options!.map(same));
      const odd = [...new Set(rows.map((r) => r[c.key]!).filter((v) => v && !ok.has(same(v))))].slice(0, 30);
      if (odd.length) unmatched[c.key] = odd;
    }
  }
  const lookups = await impl.load(db, rows, by);
  const seen = new Map<string, number>();
  const checks: ImportRowCheck[] = await each(rows, (r, i): ImportRowCheck => {
    const line = input.rows ? i + 1 : i + 2;
    if (missing.length) return { line, values: r, action: 'skip', errors: [`Nothing is matched to ${missing.join(', ')}.`] };
    const errors = kind.columns.filter((c) => c.required && !r[c.key]).map((c) => tx('{column} is empty.', { column: c.label }));
    const res = errors.length ? { key: '', errors: [], exists: false } : impl.check(r, lookups);
    errors.push(...res.errors);
    // The school's own fields: an empty cell leaves the record's value as it is, so only typed ones are checked.
    const typed = Object.fromEntries(own.filter((f) => r[customKey(f)]).map((f) => [f.key, r[customKey(f)]]));
    for (const [k, m] of Object.entries(checkCustom(own, typed, false).errors)) errors.push(`${own.find((f) => f.key === k)!.label}: ${m}`);
    if (!errors.length && res.key) {
      const before = seen.get(res.key);
      if (before) errors.push(tx('Same {columns} as line {line}.', { columns: kind.matchOn.map((k) => kind.columns.find((c) => c.key === k)?.label.toLowerCase()).join(' / '), line: before }));
      else seen.set(res.key, line);
    }
    return { line, values: r, action: errors.length ? 'skip' : res.exists ? 'update' : 'create', errors };
  });
  const valid = rows.filter((_, i) => checks[i]!.action !== 'skip');
  const counts = { create: checks.filter((c) => c.action === 'create').length, update: checks.filter((c) => c.action === 'update').length, skip: checks.filter((c) => c.action === 'skip').length, total: checks.length };
  return { preview: { kind: kind.key, source, headers, mapping, values, unmatched, missing, rows: checks, partial: false, counts, totals: impl.totals(valid, lookups), columns: kind.columns.map((c) => ({ ...rawOf(c), label: c.label })) }, valid, impl, lookups, own };
}

/** Reads, matches and checks a file without changing anything: what would be added, changed and left out, and the totals. */
export async function previewImport(db: Q, input: ImportInput, by: ImportBy = {}): Promise<ImportPreview> {
  const p = (await check(db, input, by)).preview;
  if (p.rows.length <= PREVIEW_ROWS) return p;
  const bad = p.rows.filter((r) => r.errors.length).slice(0, PREVIEW_ROWS);
  const good = p.rows.filter((r) => !r.errors.length).slice(0, PREVIEW_ROWS - bad.length);
  return { ...p, rows: [...bad, ...good].sort((a, b) => a.line - b.line), partial: true };
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const CHUNK = 5000;
async function chunks<T>(list: T[], fn: (part: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < list.length; i += CHUNK) await fn(list.slice(i, i + CHUNK));
}

const differs = (a: unknown, b: unknown) => (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null)
  ? JSON.stringify(a ?? {}) !== JSON.stringify(b ?? {}) : String(a ?? '') !== String(b ?? '');

/** Adds the rows that are new and changes `cols` of the ones that exist, in a few statements, remembering what it did. */
async function apply(client: pg.PoolClient, w: Write): Promise<Change> {
  const change: Change = { table: w.table, pk: w.pk, created: [], updated: [] };
  if (!w.rows.length) return change;
  const t = ident(w.table);
  const pkList = w.pk.map(ident).join(', ');
  const keyOf = (r: Rec) => JSON.stringify(w.pk.map((k) => String(r[k])));
  const existing = new Map<string, Rec>();
  await chunks(w.rows, async (part) => {
    const { rows } = await client.query<{ j: Rec }>(
      `select row_to_json(t) j from ${t} t where (${pkList}) in (select ${pkList} from json_populate_recordset(null::${t}, $1))`,
      [JSON.stringify(part.map((r) => Object.fromEntries(w.pk.map((k) => [k, r[k]]))))]);
    for (const r of rows) existing.set(keyOf(r.j), r.j);
  });
  const fresh: Rec[] = [];
  const changed: Rec[] = [];
  for (let i = 0; i < w.rows.length; i++) {
    if (i && i % TICK === 0) await tick();
    const r = w.rows[i]!;
    const before = existing.get(keyOf(r));
    if (!before) fresh.push(r);
    else if (w.cols.some((c) => differs(before[c], r[c]))) { changed.push(r); change.updated.push(before); }
  }
  if (fresh.length) {
    const cols = Object.keys(fresh[0]!).map(ident).join(', ');
    await chunks(fresh, (part) => client.query(`insert into ${t} (${cols}) select ${cols} from json_populate_recordset(null::${t}, $1)`, [JSON.stringify(part)]));
    change.created = fresh.map((r) => Object.fromEntries(w.pk.map((k) => [k, r[k]])));
  }
  if (changed.length) {
    const set = w.cols.map((c) => `${ident(c)} = x.${ident(c)}`).join(', ');
    const on = w.pk.map((k) => `t.${ident(k)} = x.${ident(k)}`).join(' and ');
    await chunks(changed, (part) => client.query(`update ${t} t set ${set} from json_populate_recordset(null::${t}, $1) x where ${on}`, [JSON.stringify(part)]));
  }
  return change;
}

const LOCK = "select pg_advisory_xact_lock(hashtext('imports'))";

/** Adds each row's own-field values to the record it writes, on top of what the record already had. */
async function withCustom(client: pg.PoolClient, kind: string, w: Write, rows: Row[], own: FieldDef[]): Promise<Write> {
  const c = CUSTOM[kind];
  if (!c || w.table !== c.table || w.rows.length !== rows.length) return w;
  const ids = w.rows.map((r) => String(r[c.pk]));
  const had = new Map((await client.query<{ id: string; custom: Record<string, unknown> }>(`select ${ident(c.pk)} id, custom from ${ident(c.table)} where ${ident(c.pk)} = any($1)`, [ids])).rows.map((x) => [x.id, x.custom]));
  return {
    ...w, cols: [...w.cols, 'custom'],
    rows: w.rows.map((rec, i) => {
      const typed = Object.fromEntries(own.filter((f) => rows[i]![customKey(f)]).map((f) => [f.key, rows[i]![customKey(f)]]));
      return { ...rec, custom: { ...had.get(String(rec[c.pk])), ...checkCustom(own, typed, false).values } };
    }),
  };
}

/**
 * After a bulk write, the planner's picture of the tables is refreshed: until autovacuum gets to it, it still sees them as
 * nearly empty and picks plans that crawl once they are full (a year of attendance went from milliseconds to a timeout).
 */
export async function freshStats(pool: pg.Pool, tables: string[]): Promise<void> {
  for (const t of [...new Set(tables)]) await pool.query(`analyze ${ident(t)}`).catch(() => undefined);
}

/** Imports the rows that passed the checks as one batch, in one transaction, and records how to undo it. Rows with problems are left out. */
export async function commitImport(pool: pg.Pool, input: ImportInput, byName: string, by: ImportBy = {}): Promise<ImportBatchRow> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local statement_timeout = 0');
    await client.query(LOCK);
    const { preview, valid, impl, lookups, own } = await check(client, input, by);
    if (preview.missing.length) throw new ImportError(tx('Match a column to {p0} first.', { p0: preview.missing.join(', ') }));
    if (!valid.length) throw new ImportError('Nothing to import: every row has a problem. Fix them in the grid and check again.');
    const changes: Change[] = [];
    for (const w of impl.writes(valid, lookups)) changes.push(await apply(client, own.length ? await withCustom(client, input.kind, w, valid, own) : w));
    const notes = impl.notes ? await impl.notes(client, valid, lookups) : [];
    const id = `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const report = { totals: preview.totals, notes, skipped: preview.rows.filter((r) => r.action === 'skip').slice(0, 500).map((r) => ({ line: r.line, errors: r.errors })) };
    await client.query(
      'insert into import_batches (id, kind, source, file_name, created, updated, skipped, report, changes, by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, preview.kind, preview.source, input.fileName, preview.counts.create, preview.counts.update, preview.counts.skip, JSON.stringify(report), JSON.stringify(changes), byName]);
    if (!input.rows) {
      await client.query('insert into import_mappings (signature, mapping, value_map) values ($1,$2,$3) on conflict (signature) do update set mapping = excluded.mapping, value_map = excluded.value_map, updated_at = now()',
        [signature(preview.kind, preview.headers), JSON.stringify(preview.mapping), JSON.stringify(preview.values)]);
    }
    if (input.uploadId) await client.query("update import_uploads set status = 'imported', batch_id = $2 where id = $1", [input.uploadId, id]);
    await client.query('commit');
    await freshStats(pool, changes.map((c) => c.table));
    return (await listBatches(pool)).find((b) => b.id === id)!;
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function listBatches(db: Q): Promise<ImportBatchRow[]> {
  const { rows } = await db.query<{ id: string; kind: string; source: string; file_name: string; created: number; updated: number; skipped: number; report: { totals: ImportBatchRow['totals']; notes: string[] }; by_name: string; at: Date; undone_at: Date | null }>(
    'select id, kind, source, file_name, created, updated, skipped, report, by_name, at, undone_at from import_batches order by at desc limit 200');
  const newest = rows.find((r) => !r.undone_at);
  const limit = Date.now() - UNDO_DAYS * 86_400_000;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, source: r.source, fileName: r.file_name, created: r.created, updated: r.updated, skipped: r.skipped,
    totals: r.report.totals ?? [], notes: r.report.notes ?? [], byName: r.by_name, at: r.at.toISOString(), undoneAt: r.undone_at?.toISOString() ?? null,
    canUndo: r === newest && r.at.getTime() > limit,
  }));
}

/**
 * Puts the school back as it was before a batch: rows it added are removed and rows it changed get their old values.
 * ponytail: only the newest batch can be undone (an older one may have been built on); a per-row history would lift that.
 */
export async function undoBatch(pool: pg.Pool, id: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local statement_timeout = 0');
    await client.query(LOCK);
    const batch = (await listBatches(client)).find((b) => b.id === id);
    if (!batch) throw new ImportError('That import does not exist.');
    if (!batch.canUndo) throw new ImportError(batch.undoneAt ? 'That import was already undone.' : `Only the newest import from the last ${UNDO_DAYS} days can be undone.`);
    const changes = (await client.query<{ changes: Change[] }>('select changes from import_batches where id = $1', [id])).rows[0]!.changes;
    for (const c of [...changes].reverse()) {
      const t = ident(c.table);
      if (c.updated.length) {
        const cols = Object.keys(c.updated[0]!).filter((k) => !c.pk.includes(k));
        const set = cols.map((k) => `${ident(k)} = x.${ident(k)}`).join(', ');
        const on = c.pk.map((k) => `t.${ident(k)} = x.${ident(k)}`).join(' and ');
        if (set) await chunks(c.updated, (part) => client.query(`update ${t} t set ${set} from json_populate_recordset(null::${t}, $1) x where ${on}`, [JSON.stringify(part)]));
      }
      if (c.created.length) {
        const pkList = c.pk.map(ident).join(', ');
        await chunks(c.created, (part) => client.query(`delete from ${t} where (${pkList}) in (select ${pkList} from json_populate_recordset(null::${t}, $1))`, [JSON.stringify(part)]));
      }
    }
    await client.query('update import_batches set undone_at = now() where id = $1', [id]);
    // The school's file it came from waits to be imported again, so the admin's Moving in no longer says it is in.
    await client.query("update import_uploads set status = 'new', batch_id = null where batch_id = $1", [id]);
    await client.query('commit');
    await freshStats(pool, changes.map((c) => c.table));
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The template as an .xlsx: the columns by their names with an example row, a dropdown on every column that takes fixed
 * values, and a second sheet that says what each column is, whether it is needed and what it takes.
 */
export function templateXlsx(of: string | ImportKind): Buffer {
  const kind = typeof of === 'string' ? importKind(of) : of;
  if (!kind) throw new ImportError(tx('There is no import for “{key}”.', { key: String(of) }));
  const opts = (c: (typeof kind.columns)[number]) => c.options;
  const lists = Object.fromEntries(kind.columns.flatMap((c, i) => (opts(c) && c.key !== 'relation' ? [[i, opts(c)!]] : [])));
  const help = [[tx('Column'), tx('Needed'), tx('Example'), tx('What it takes')], ...kind.columns.map((c) => [c.label, c.required ? tx('Yes') : tx('No'), c.example, opts(c) ? opts(c)!.join(', ') : c.aliases?.length ? tx('Also read as: {names}', { names: c.aliases.join(', ') }) : ''])];
  return xlsx([
    { name: kind.label, rows: [kind.columns.map((c) => c.label), kind.columns.map((c) => c.example)], lists, widths: kind.columns.map((c) => Math.max(14, c.label.length + 4)) },
    { name: 'How to fill', rows: help, widths: [26, 10, 22, 70] },
  ]);
}

/**
 * Records that take the school's own fields (§3.6.3): which kind imports them, the table they are kept in, its key, and the
 * column that finds a record again in an export (the kind's match column).
 */
const CUSTOM: Record<string, { entity: CustomEntity; table: string; pk: string; find: string; sql: string }> = {
  students: { entity: 'student', table: 'students', pk: 'id', find: 'admission_no', sql: 'select admission_no k, custom from students' },
  staff: { entity: 'staff', table: 'staff', pk: 'user_id', find: 'email', sql: 'select lower(u.email) k, s.custom from staff s join users u on u.id = s.user_id' },
};
const customKey = (f: FieldDef) => `custom.${f.key}`;
async function ownFields(db: Q, key: string): Promise<FieldDef[]> {
  const c = CUSTOM[key];
  return c ? (await savedSetting(db, 'fields.custom'))[c.entity] ?? [] : [];
}

/** A kind as this school has it: its lists in the dropdowns, and a column for each of its own fields. */
export async function ownKind(db: Q, key: string): Promise<ImportKind | undefined> {
  const kind = importKind(key);
  if (!kind) return undefined;
  const columns = [];
  for (const c of kind.columns) {
    columns.push(c.list ? { ...c, options: (await savedSetting(db, c.list)).filter((i) => i.active !== false).map((i) => i.name) } : c);
  }
  for (const f of await ownFields(db, key)) {
    columns.push({ key: customKey(f), label: f.label, example: '', required: false, options: f.options?.filter((o) => o.active !== false).map((o) => o.name), aliases: [f.key] });
  }
  return { ...kind, columns };
}

/** Everything the school has, in the same templates it can be imported from: one CSV per kind in a ZIP. Leaving is easy too. */
export async function exportAll(db: Q, kinds: string[] = IMPORT_KINDS.map((k) => k.key)): Promise<Buffer> {
  const files: { name: string; content: string }[] = [];
  for (const base of IMPORT_KINDS.filter((k) => kinds.includes(k.key))) {
    const kind = (await ownKind(db, base.key))!;
    const rows = await KINDS[kind.key]!.export(db);
    const c = CUSTOM[kind.key];
    const own = c ? await ownFields(db, kind.key) : [];
    if (c && own.length) {
      const values = new Map((await db.query<{ k: string; custom: Record<string, never> }>(c.sql)).rows.map((x) => [String(x.k).toLowerCase(), x.custom]));
      for (const r of rows) {
        const v = values.get(String(r[c.find] ?? '').toLowerCase()) ?? {};
        for (const f of own) r[customKey(f)] = customText(f, v[f.key]);
      }
    }
    files.push({ name: `${String(IMPORT_KINDS.indexOf(base) + 1).padStart(2, '0')}-${kind.key}.csv`, content: toCsv([kind.columns.map((c) => c.key), ...rows.map((r) => kind.columns.map((c) => r[c.key] ?? ''))]) });
  }
  return zip(files);
}

/** One kind's rows in its template columns (with the row id where the kind has one), for the school's own setup screens. */
export async function exportRows(db: Q, key: string): Promise<Record<string, string>[]> {
  const impl = KINDS[key];
  if (!impl) throw new ImportError(tx('There is no import for “{key}”.', { key }));
  return impl.export(db);
}
