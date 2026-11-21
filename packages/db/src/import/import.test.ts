import { mkdtempSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDatabase, startDevPostgres, type DevPostgres } from '../dev.js';
import { migrate } from '../migrate.js';
import { seedSchool } from '../seed/school.js';
import { IMPORT_KINDS, setLocaleSource } from '@tangent/contracts';
import { commitImport, exportAll, listBatches, previewImport, templateXlsx, undoBatch } from './engine.js';
import { parseCsv, readTable, readXlsx } from './files.js';
import { classKey, isoDay } from './kinds.js';
import { sampleSchool } from './sample.js';

let server: DevPostgres;
let pool: pg.Pool;
const school = sampleSchool(300);
const n = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);

beforeAll(async () => {
  // The school's own country, as the API and console give it: local phone numbers are read as Indian ones.
  setLocaleSource(() => ({ country: 'IN', locale: 'en-IN', currency: 'INR' }));
  server = await startDevPostgres({ dataDir: path.join(mkdtempSync(path.join(tmpdir(), 'tangent-import-')), 'data'), fresh: true, throwaway: true });
  pool = new pg.Pool({ connectionString: await ensureDatabase(server.url, 'school_import'), max: 4 });
  await migrate(pool, 'school');
  // An empty school: settings, roles and the first admin, nothing else, the way a school starts before it moves in.
  await seedSchool(pool, {
    school: { name: 'Riverside School', shortName: 'Riverside', tagline: '', phone: '', email: '', address: '', color: '#2F5BD3', logoText: 'R', language: 'en' },
    admin: { name: 'Office Admin', email: 'office@riverside.test', phone: '+91 90000 00001', passwordHash: 'x' }, modules: ['people'], data: 'empty',
  });
}, 180_000);
afterAll(async () => { await pool?.end(); await server?.stop(); });

describe('reading what people type', () => {
  it('reads Indian dates and class names the ways schools write them', () => {
    expect(['2012-04-18', '18/04/2012', '18-04-2012', '18.04.2012', '18 Apr 2012'].map(isoDay)).toEqual(Array(5).fill('2012-04-18'));
    expect(isoDay('31/02/2012')).toBeNull();
    expect(['8 A', '8A', 'VIII-A', 'Class 8 - A', 'Std. 8 A'].map(classKey)).toEqual(Array(5).fill('8a'));
  });
  it('reads quoted CSV with commas, line breaks and a semicolon separator', () => {
    expect(parseCsv('﻿name,address\r\n"Rao, Ira","1 Main Rd\nPune"\r\n')).toEqual([['name', 'address'], ['Rao, Ira', '1 Main Rd\nPune']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('reads an .xlsx as Excel saves it: shared strings, dates and times by their format, the first sheet, gaps kept', () => {
    const xlsx = deflatedZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Kids" sheetId="2" r:id="rId7"/><sheet name="Old" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Type="x" Target="worksheets/sheet3.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>name</t></si><si><t>dob</t></si><si><r><t>Rao, </t></r><r><t xml:space="preserve">Ira &amp; co</t></r></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="20"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong sheet</t></is></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet3.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>start</t></is></c></row><row r="2" spans="1:4"/>'
        + '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><v>41017</v></c><c r="C3"><v>9822011002</v></c><c r="D3" s="2"><v>0.33333333333</v></c></row></sheetData></worksheet>',
    });
    expect(readTable(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsx.toString('base64')}`))
      .toEqual([['name', 'dob', '', 'start'], ['Rao, Ira & co', '2012-04-18', '9822011002', '08:00']]);
    expect(readTable(`data:text/csv;base64,${Buffer.from('a,b\n1,2').toString('base64')}`)).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('moving a school in', () => {
  it('imports every kind in order, and the school adds up to the rupee', async () => {
    for (const f of school.files) {
      const preview = await previewImport(pool, { kind: f.kind, csv: f.csv, fileName: f.name });
      expect(preview.missing, f.name).toEqual([]);
      expect(preview.rows.filter((r) => r.errors.length).map((r) => `${f.name}:${r.line} ${r.errors.join(' ')}`)).toEqual([]);
      const batch = await commitImport(pool, { kind: f.kind, csv: f.csv, fileName: f.name }, 'Migration team');
      expect(batch.created, f.name).toBe(preview.counts.create);
    }
    const e = school.expect;
    expect(await n('select count(*) n from students')).toBe(e.students);
    expect(await n('select count(*) n from classes')).toBe(e.classes);
    expect(await n("select count(*) n from users where kind = 'staff'")).toBe(e.staff + 1);
    expect(await n('select count(*) n from guardians')).toBe(e.families);
    expect(await n("select count(*) n from users where kind = 'guardian'")).toBe(e.families);
    expect(await n('select sum(amount) n from fee_invoices')).toBe(e.due);
    expect(await n('select sum(amount) n from payments')).toBe(e.paid);
    expect(await n('select count(*) n from attendance_marks')).toBe(e.attendanceMarks);
    // Every family can sign in: a guardian login with the phone, and the students joined to it.
    expect(await n('select count(*) n from guardians where user_id is null')).toBe(0);
    expect(await n('select count(*) n from students s where not exists (select 1 from student_guardians sg where sg.student_id = s.id)')).toBe(0);
    // Staff are not invited at import time.
    expect(await n("select count(*) n from users where kind = 'staff' and invited_at is not null")).toBe(0);
  }, 240_000);

  it('a second import of the same file updates instead of adding again', async () => {
    const f = school.files.find((x) => x.kind === 'students')!;
    const again = await commitImport(pool, { kind: 'students', csv: f.csv, fileName: f.name }, 'Migration team');
    expect(again.created).toBe(0);
    expect(again.updated).toBe(school.expect.students);
    expect(await n('select count(*) n from students')).toBe(school.expect.students);
  }, 60_000);

  it('reads another system’s export: its columns, its dates, first and last names apart', async () => {
    const p = await previewImport(pool, { kind: 'students', csv: school.fedenaStudents, fileName: 'fedena.csv' });
    expect(p.source).toBe('fedena');
    expect(p.mapping['First name']).toBe('name');
    expect(p.mapping['Last name']).toBe('name');
    expect(p.missing).toEqual([]);
    expect(p.rows.filter((r) => r.errors.length)).toEqual([]);
    expect(p.counts.update).toBe(school.expect.students);
    expect(p.rows[0]!.values.name.split(' ').length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('recognises an Entab CampusCare export by its columns', async () => {
    const csv = ['AdmNo,StudentName,ClassSec,DOB,FName,FMobile,House', 'E/2020/77,Meher Kapoor,8 A,14/03/2013,Rohit Kapoor,9822077001,Ruby'].join('\r\n');
    const p = await previewImport(pool, { kind: 'students', csv, fileName: 'entab.csv' });
    expect(p.source).toBe('entab');
    expect(p.missing).toEqual([]);
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.values).toMatchObject({ admission_no: 'E/2020/77', name: 'Meher Kapoor', guardian_phone: '9822077001', house: 'Ruby' });
  }, 60_000);

  it('rows typed into the quick-entry grid go through the same checks', async () => {
    const p = await previewImport(pool, { kind: 'admissions', rows: [{ child_name: 'Tara Joshi', grade_sought: 'LKG', guardian_name: 'Vir Joshi', phone: '9811100099' }, { child_name: 'No Grade', grade_sought: 'abc', guardian_name: 'A' }], fileName: '' });
    expect(p.source).toBe('typed');
    expect(p.counts).toMatchObject({ create: 1, skip: 1 });
    expect(p.rows[1]!.errors[0]).toMatch(/Grade is a number/);
    const bad = await previewImport(pool, { kind: 'students', csv: 'admission_no,name,class,dob,guardian_name,guardian_phone\n9/1,Ana,13 Z,2012-01-01,Ma,9800000000\n', fileName: '' });
    expect(bad.rows[0]!.errors).toEqual(['Class “13 Z” is not set up: import classes first.']);
  }, 60_000);

  it('undoes only the newest import, putting back what it changed', async () => {
    const before = await n("select count(*) n from transport_assignments");
    const batches = await listBatches(pool);
    expect(batches.filter((b) => b.canUndo)).toHaveLength(1);
    await expect(undoBatch(pool, batches[batches.length - 1]!.id)).rejects.toThrow(/Only the newest/);
    const f = school.files.find((x) => x.kind === 'transport')!;
    const moved = f.csv.replace(/Route 1 · Baner/g, 'Route 9 · Aundh');
    const b = await commitImport(pool, { kind: 'transport', csv: moved, fileName: 'routes.csv' }, 'Migration team');
    expect(await n("select count(*) n from transport_assignments where route = 'Route 9 · Aundh'")).toBeGreaterThan(0);
    await undoBatch(pool, b.id);
    expect(await n("select count(*) n from transport_assignments where route = 'Route 9 · Aundh'")).toBe(0);
    expect(await n('select count(*) n from transport_assignments')).toBe(before);
  }, 60_000);

  it('exports everything in the same templates, and the export imports back cleanly', async () => {
    const zip = await exportAll(pool);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(zip.toString('latin1')).toContain('09-students.csv');
    const start = zip.indexOf('09-students.csv') + '09-students.csv'.length;
    const csv = zip.subarray(start, zip.indexOf('PK', start)).toString('utf8');
    const p = await previewImport(pool, { kind: 'students', csv, fileName: 'export.csv' });
    expect(p.rows.filter((r) => r.errors.length)).toEqual([]);
    expect(p.counts).toMatchObject({ create: 0, update: school.expect.students });
  }, 60_000);

  it('numbers new children from a sheet without admission numbers, and knows them again by name and birthday', async () => {
    const csv = 'name,class,dob,guardian,phone\nNew Child,4 A,18/04/2017,Asha Kale,+91 98111 22233\n';
    const first = await commitImport(pool, { kind: 'students', csv, fileName: 'new.csv' }, 'Office');
    expect(first.created).toBe(1);
    const no = (await pool.query<{ admission_no: string }>("select admission_no from students where name = 'New Child'")).rows[0]!.admission_no;
    expect(no).toMatch(/^\d{4}\/0001$/);
    const again = await previewImport(pool, { kind: 'students', csv, fileName: 'new.csv' });
    expect(again.counts).toMatchObject({ create: 0, update: 1 });
    // The school's own series, as the office set it.
    await pool.query(`insert into settings (key, value) values ('people.admissionNumber', '"ADM-{yy}-{seq:3}"'), ('people.admissionStart', '40')`);
    try {
      await commitImport(pool, { kind: 'students', csv: 'name,class,dob,guardian\nOther Child,4 A,19/04/2017,Ravi Other\n', fileName: 'other.csv' }, 'Office');
      expect((await pool.query<{ admission_no: string }>("select admission_no from students where name = 'Other Child'")).rows[0]!.admission_no).toMatch(/^ADM-\d{2}-040$/);
    } finally { await pool.query("delete from settings where key in ('people.admissionNumber', 'people.admissionStart')"); }
  }, 60_000);

  it('gives every kind an Excel template that reads back as itself, with a dropdown wherever the values are fixed', async () => {
    for (const kind of IMPORT_KINDS) {
      const book = templateXlsx(kind.key);
      const rows = readXlsx(book);
      expect(rows[0], kind.key).toEqual(kind.columns.map((c) => c.label));
      const examples = kind.columns.map((c) => c.example);
      while (examples.at(-1) === '') examples.pop();
      expect(rows[1], kind.key).toEqual(examples);
      const p = await previewImport(pool, { kind: kind.key, csv: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${book.toString('base64')}`, fileName: `${kind.key}.xlsx` });
      expect(p.missing, kind.key).toEqual([]);
      expect(Object.values(p.mapping).filter((v) => !v), kind.key).toEqual([]);
      const lists = (book.toString('utf8').match(/<dataValidation /g) ?? []).length;
      expect(lists, kind.key).toBe(kind.columns.filter((c) => c.options).length);
    }
    expect(templateXlsx('periods').toString('utf8')).toContain('&quot;period,break,lunch,recess,assembly&quot;');
  }, 120_000);

  it('reads how a payment was made in the words schools use, and asks about anything else', async () => {
    const f = school.files.find((x) => x.kind === 'payments')!;
    const [head, a, b] = parseCsv(f.csv);
    const at = head!.indexOf('method');
    const row = (r: string[], m: string) => r.map((v, i) => (i === at ? m : v));
    const csv = [head!, row(a!, 'GPay'), row(b!, 'Cheque No 5')].map((r) => r.join(',')).join('\n');
    const p = await previewImport(pool, { kind: 'payments', csv, fileName: 'pay.csv' });
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[1]!.errors[0]).toMatch(/^Method is one of cash, upi, card, netbanking, cheque/);
  }, 60_000);

  it('takes children without a family phone, and a contact list gives their families one', async () => {
    const kids = ['name,class,dob,guardian', 'Devansh Zed,4 A,02/03/2017,Kiran Zed', 'Isha Zed,4 A,05/06/2017,Kiran Zed', 'Mira Qadri,4 A,07/08/2017,Lata Qadri'].join('\n');
    const k = await commitImport(pool, { kind: 'students', csv: kids, fileName: 'register.csv' }, 'Office');
    expect(k.created).toBe(3);
    expect(k.notes.join(' ')).toMatch(/still have no family phone|no family phone/i);
    const list = ['name,phone,child', 'Lata Qadri,+91 98111 77001,', 'Kiran Zed,98111 77002,', 'Kiran Zed,98111 77003,Devansh Zed', 'Asha Kale,+91 98111 22233,'].join('\n');
    const p = await previewImport(pool, { kind: 'contacts', csv: list, fileName: 'whatsapp.csv' });
    expect(p.rows.map((r) => r.errors.length)).toEqual([0, 1, 0, 0]);
    expect(p.rows[1]!.errors[0]).toMatch(/2 families without a phone are called “Kiran Zed”/);
    expect(p.counts).toMatchObject({ create: 2, update: 1, skip: 1 });
    const b = await commitImport(pool, { kind: 'contacts', csv: list, fileName: 'whatsapp.csv' }, 'Migration team');
    const phone = async (child: string) => (await pool.query<{ phone: string | null }>('select g.phone from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id where s.name = $1', [child])).rows[0]!.phone;
    expect(await phone('Mira Qadri')).toBe('+919811177001');
    expect(await phone('Devansh Zed')).toBe('+919811177003');
    expect(await phone('Isha Zed')).toBeNull();
    await undoBatch(pool, b.id);
    expect(await phone('Mira Qadri')).toBeNull();
  }, 60_000);
});

/** A ZIP with deflated entries, the way Excel writes an .xlsx (the export's own ZIP is stored, so this covers the other path). */
function deflatedZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], dir: Buffer[] = [];
  let offset = 0;
  for (const [n, text] of Object.entries(files)) {
    const name = Buffer.from(n), raw = Buffer.from(text), data = deflateRawSync(raw);
    const local = Buffer.alloc(30), head = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(8, 10); head.writeUInt32LE(crc32(raw), 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(name.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    dir.push(head, name);
    offset += 30 + name.length + data.length;
  }
  const d = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(dir.length / 2, 8); end.writeUInt16LE(dir.length / 2, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, d, end]);
}

describe('value mapping', () => {
  it('reads a file’s values through the mapping, reports values no choice matches, and remembers the mapping', async () => {
    const csv = 'Subject,Periods\nValue map check,six\nValue map extra,7\n';
    const first = await previewImport(pool, { kind: 'subjects', csv, fileName: 'subjects.csv' });
    expect(first.values).toEqual({});
    const values = { per_week: { ' SIX ': '6' } };
    const mapped = await previewImport(pool, { kind: 'subjects', csv, fileName: 'subjects.csv', values });
    expect(mapped.rows[0]!.values.per_week).toBe('6');
    await commitImport(pool, { kind: 'subjects', csv, fileName: 'subjects.csv', values }, 'Migration team');
    // The same file's columns next term: the values are read the same way without asking.
    expect((await previewImport(pool, { kind: 'subjects', csv, fileName: 'subjects.csv' })).rows[0]!.values.per_week).toBe('6');
    // A value that is none of a column's choices is listed to map; mapped, it is not.
    const students = 'Admission number,Name,Class,Status\nVM/1,Val Map,5 A,Current\n';
    expect((await previewImport(pool, { kind: 'students', csv: students, fileName: 's.csv' })).unmatched).toEqual({ status: ['Current'] });
    const fixed = await previewImport(pool, { kind: 'students', csv: students, fileName: 's.csv', values: { status: { current: 'active' } } });
    expect(fixed.unmatched).toEqual({});
    expect(fixed.rows[0]!.values.status).toBe('active');
  });
});

describe('files as other systems and offices write them', () => {
  it('finds the header row under a title and a date, as a school’s own spreadsheet has them', async () => {
    const csv = 'Riverside School · Holiday list\nAs approved by the committee\n\nOccasion,From Date,To Date\nTitle row check,15/08/2026,\n';
    const p = await previewImport(pool, { kind: 'holidays', csv, fileName: 'holidays.csv' });
    expect(p.missing).toEqual([]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.values).toMatchObject({ name: 'Title row check', starts_on: '15/08/2026' });
  });

  it('makes a Fedena export’s father and mother two guardians, not one', async () => {
    const csv = 'Admission no,First name,Last name,Batch name,Date of birth,Father name,Father mobile phone,Mother name,Mother mobile phone\nFD/1,Ira,Rao,5-A,02/03/2016,Anil Rao,98450 11111,Meera Rao,98450 22222\n';
    const p = await previewImport(pool, { kind: 'students', csv, fileName: 'fedena.csv' });
    expect(p.mapping).toMatchObject({ 'Father name': 'guardian_name', 'Mother name': 'guardian2_name', 'Mother mobile phone': 'guardian2_phone' });
    expect(p.rows[0]!.values).toMatchObject({ guardian_name: 'Anil Rao', guardian2_name: 'Meera Rao' });
  });

  it('reads an aSc Timetables XML export as lessons, each period by its start time', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><timetable importtype="database"><periods><period name="1" period="1" starttime="8:30" endtime="9:10"/><period name="2" period="2" starttime="9:10" endtime="9:50"/></periods>
      <subjects><subject id="S1" name="Mathematics" short="Ma"/></subjects><teachers><teacher id="T1" name="Asha Rao" email="asha@riverside.test"/></teachers>
      <classrooms><classroom id="R1" name="Room 5A"/></classrooms><classes><class id="C1" name="5 A"/><class id="C2" name="5 B"/></classes>
      <lessons><lesson id="L1" classids="C1,C2" subjectid="S1" teacherids="T1" classroomids="R1"/></lessons><cards><card lessonid="L1" period="2" days="101000"/></cards></timetable>`;
    expect(readTable(xml)).toEqual([['class', 'day', 'period', 'subject', 'teacher', 'room'], ['5 A', 'Monday', '9:10', 'Mathematics', 'asha@riverside.test', 'Room 5A'], ['5 A', 'Wednesday', '9:10', 'Mathematics', 'asha@riverside.test', 'Room 5A'],
      ['5 B', 'Monday', '9:10', 'Mathematics', 'asha@riverside.test', 'Room 5A'], ['5 B', 'Wednesday', '9:10', 'Mathematics', 'asha@riverside.test', 'Room 5A']]);
    expect(() => readTable('<timetable><lessons/></timetable>')).toThrow(/no lessons/);
  });

  it('reads a Koha MARC export as the catalogue: title, author, ISBN, subject and a copy per holding', () => {
    const record = marcRecord([['020', '  \x1fa9789351234567'], ['100', '1 \x1faNarayan, R. K.,'], ['245', '10\x1faMalgudi days /'], ['650', ' 0\x1faFiction'],
      ['952', '  \x1foFIC-3\x1fpRV00001\x1fyBK'], ['952', '  \x1foFIC-3\x1fpRV00002\x1fyBK']]);
    const rows = readTable(`data:application/marc;base64,${Buffer.concat([record, record]).toString('base64')}`);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['Malgudi days', 'Narayan, R. K', '9789351234567', 'Fiction', 'FIC-3', '2', 'Book', 'RV00001']);
  });

  it('places a timetable row by its period’s start time as well as its number', async () => {
    await commitImport(pool, { kind: 'periods', csv: 'number,label,starts_at,ends_at,kind\n1,Period 1,08:00,08:40,\n2,Break,08:40,09:00,break\n3,Period 2,09:00,09:40,\n', fileName: 'bell.csv' }, 'Migration team');
    const p = await previewImport(pool, { kind: 'timetable', csv: 'class,day,period,subject,teacher,room\nNoClass,Monday,9:00,Mathematics,nobody@riverside.test,\n', fileName: 'tt.csv' });
    expect(p.rows[0]!.errors.join(' ')).not.toMatch(/Period .* is not set up/);
    const q = await previewImport(pool, { kind: 'timetable', csv: 'class,day,period,subject,teacher,room\nNoClass,Monday,9:20,Mathematics,nobody@riverside.test,\n', fileName: 'tt.csv' });
    expect(q.rows[0]!.errors.join(' ')).toMatch(/Period 9:20 is not set up/);
  });
});

/** One MARC 21 record (ISO 2709) from its fields: the leader, the directory, then each field ended by 0x1e. */
function marcRecord(fields: [string, string][]): Buffer {
  const bodies = fields.map(([tag, v]) => [tag, Buffer.from(`${v}\x1e`, 'utf8')] as const);
  let at = 0;
  const dir = bodies.map(([tag, b]) => { const e = `${tag}${String(b.length).padStart(4, '0')}${String(at).padStart(5, '0')}`; at += b.length; return e; }).join('');
  const base = 24 + dir.length + 1;
  const leader = `${String(base + at + 1).padStart(5, '0')}nam a22${String(base).padStart(5, '0')} a 4500`;
  return Buffer.concat([Buffer.from(leader + dir, 'latin1'), Buffer.from([0x1e]), ...bodies.map(([, b]) => b), Buffer.from([0x1d])]);
}
