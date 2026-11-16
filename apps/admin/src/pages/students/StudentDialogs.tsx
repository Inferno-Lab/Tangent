import { useEffect, useState } from 'react';
import { currencySymbol, schoolToday, type ClassInfo } from '@tangent/contracts';
import { DateField, Dialog, ErrorLine, Field, FilePick, SelectField, useShake, t as tr } from '@tangent/web-ui';
import { DialogActions as Actions, fieldsOf, messageOf, useFeeHeads } from '../../app/kit';
import { useApp } from '../../app/context';
import { RecordFields, emptyRec } from './StudentRecord';

type Done = (message: string, openId?: string) => void;

export function AddStudentDialog({ classes, defaultClass, onClose, onDone }: { classes: ClassInfo[]; defaultClass?: string; onClose: () => void; onDone: Done }) {
  const { api } = useApp();
  const shake = useShake();
  const [f, setF] = useState({ name: '', classId: defaultClass ?? classes[0]?.id ?? '', rollNo: '', dob: '', guardianName: '', guardianPhone: '', ...emptyRec });
  // Opened before the classes arrived: take the first one when they do, as if it had been there.
  useEffect(() => { if (classes[0]) setF((s) => (s.classId ? s : { ...s, classId: classes[0]!.id })); }, [classes]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErr((e) => ({ ...e, [k]: '' })); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.name.trim().length < 2) local.name = tr('admin.student_dialogs.enter_the_full_name');
    if (!f.classId) local.classId = tr('admin.student_dialogs.choose_a_class');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dob)) local.dob = tr('admin.student_dialogs.choose_the_date_of_birth');
    if (f.guardianName.trim().length < 2) local.guardianName = tr('admin.student_dialogs.enter_the_guardian_s_name');
    if (!f.guardianPhone.trim()) local.guardianPhone = tr('admin.student_dialogs.enter_a_phone_number');
    if (Object.keys(local).length) { setErr(local); shake.hit(); return; }
    setBusy(true);
    try {
      const s = await api.students.create({ ...f, rollNo: f.rollNo || undefined, bloodGroup: f.bloodGroup || undefined, address: f.address || undefined, gender: (f.gender || undefined) as 'female' | undefined, house: f.house || undefined, admissionNo: f.admissionNo || undefined });
      onDone(tr('admin.student_dialogs.was_added_to', { name: s.name, className: s.className }), s.id);
    } catch (x) {
      setBusy(false); setErr(fieldsOf(x)); setGeneral(Object.keys(fieldsOf(x)).length ? '' : messageOf(x)); shake.hit();
    }
  };
  return (
    <Dialog title={tr('admin.student_dialogs.add_a_student')} onClose={onClose} shake={shake.cls} width={520}>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={tr('admin.student_dialogs.full_name')} value={f.name} onChange={set('name')} error={err.name} autoComplete="off" />
        <div className="two">
          <SelectField label={tr('admin.student_dialogs.class')} value={f.classId} onChange={set('classId')} options={classes.map((c) => ({ value: c.id, label: c.name }))} error={err.classId} />
          <Field label={tr('admin.student_dialogs.roll_no_optional')} value={f.rollNo} onChange={set('rollNo')} maxLength={10} />
        </div>
        <div className="two">
          <DateField label={tr('admin.student_dialogs.date_of_birth')} value={f.dob} onChange={set('dob')} error={err.dob} max={schoolToday()} />
        </div>
        <RecordFields f={f} set={set} err={err} adding />
        <Field label={tr('admin.student_dialogs.guardian')} value={f.guardianName} onChange={set('guardianName')} error={err.guardianName} />
        <Field label={tr('admin.student_dialogs.guardian_s_phone')} value={f.guardianPhone} onChange={set('guardianPhone')} error={err.guardianPhone} type="tel" hint={tr('admin.student_dialogs.they_sign_in_to_the')} />
        {general && <ErrorLine>{general}</ErrorLine>}
        <Actions onClose={onClose} busy={busy} label={tr('admin.student_dialogs.add_student')} />
      </form>
    </Dialog>
  );
}

/** What the import dialog says and calls for each kind of record a page imports itself (the one import engine on the server). */
const IMPORTS = {
  students: { one: 'student', many: 'students', columns: <><b>{tr('admin.student_dialogs.name_class_dob_guardian_phone')}</b> {tr('admin.student_dialogs.and')}{' '}<b>{tr('admin.student_dialogs.roll')}</b> {tr('admin.student_dialogs.or')}{' '}<b>{tr('admin.student_dialogs.admission_number')}</b> {tr('admin.student_dialogs.if_you_have_them')}</>, example: tr('admin.student_dialogs.name_class_dob_guardian_phone_2') },
  staff: { one: 'person', many: 'staff', columns: <><b>{tr('admin.student_dialogs.name_email')}</b> {tr('admin.student_dialogs.and')}{' '}<b>{tr('admin.student_dialogs.phone_designation_department_role_subjects')}</b> {tr('admin.student_dialogs.if_you_have_them')}</>, example: tr('admin.student_dialogs.name_email_phone_designation_role') },
};

export function ImportDialog({ onClose, onDone, kind = 'students' }: { onClose: () => void; onDone: Done; kind?: keyof typeof IMPORTS }) {
  const { api } = useApp();
  const k = IMPORTS[kind];
  const run = kind === 'staff' ? api.staff.import : api.students.import;
  const template = kind === 'staff' ? api.staff.template : api.students.template;
  const n = (x: number) => `${x} ${x === 1 ? k.one : k.many}`;
  const shake = useShake();
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: { line: number; message: string }[] } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (csv.trim().length < 10) { setErr(tr('admin.student_dialogs.paste_your_sheet_here_or')); shake.hit(); return; }
    setBusy(true);
    try { setResult(await run(csv)); setBusy(false); } catch (x) { setBusy(false); setErr(messageOf(x)); shake.hit(); }
  };
  if (result) {
    const done = () => onDone(result.created || result.updated ? tr('admin.student_dialogs.imported', { n: n(result.created + result.updated) }) : '');
    return (
      <Dialog title={result.created ? tr('admin.student_dialogs.added', { n: n(result.created), p1: result.created === 1 ? 'was' : 'were' }) : result.updated ? tr('admin.student_dialogs.updated', { n: n(result.updated), p1: result.updated === 1 ? 'was' : 'were' }) : tr('admin.student_dialogs.no_one_was_added')} onClose={done} width={520}>
        <p>{result.created && result.updated ? tr('admin.student_dialogs.already_here_updated', { updated: result.updated, p1: result.updated === 1 ? 'was' : 'were' }) : ''}{result.skipped ? tr('admin.student_dialogs.skipped_fix_them_and_import', { skipped: result.skipped, p1: result.skipped === 1 ? 'line was' : 'lines were' }) : tr('admin.student_dialogs.every_line_was_imported')}</p>
        {result.errors.length > 0 && (
          <ul style={{ margin: '0 0 8px', paddingLeft: 20, font: '600 13px/1.7 var(--fb)', color: 'var(--ink2)', maxHeight: 180, overflow: 'auto' }}>
            {result.errors.slice(0, 20).map((x) => <li key={x.line}>{tr('admin.student_dialogs.line')}{' '}{x.line}: {x.message}</li>)}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn pri" onClick={done}>{tr('admin.student_dialogs.done')}</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title={tr('admin.student_dialogs.import', { many: k.many })} onClose={onClose} shake={shake.cls} width={560}>
      <p>{tr('admin.student_dialogs.choose_an_excel_sheet_xlsx')}{' '}{k.columns}{tr('admin.student_dialogs.or_an_export_from_your')}{kind === 'staff' ? tr('admin.student_dialogs.they_are_invited_to_sign') : ''}</p>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="fld">
          <label htmlFor="csv">{tr('admin.student_dialogs.your_sheet')}</label>
          <div className={`inp ${err ? 'err shake' : ''}`} style={{ height: 'auto', padding: 12, alignItems: 'stretch' }}>
            <textarea id="csv" value={file ? `${file} is ready to import.` : csv} readOnly={!!file} onChange={(e) => { setCsv(e.target.value); setErr(''); }} rows={7} placeholder={k.example} style={{ width: '100%', resize: 'vertical', font: '600 13px/1.5 ui-monospace,Consolas,monospace' }} />
          </div>
          {err && <ErrorLine>{err}</ErrorLine>}
        </div>
        <div className="tgrow">
          <FilePick className="btn sm" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onPick={(f) => {
            // An .xlsx goes as the file itself (the import engine reads it); a CSV as its text, so it shows here to check.
            if (/\.xlsx$/i.test(f.name)) { const r = new FileReader(); r.onload = () => { setCsv(String(r.result)); setFile(f.name); setErr(''); }; r.readAsDataURL(f); }
            else void f.text().then((t) => { setCsv(t); setFile(''); setErr(''); });
          }}>{tr('admin.student_dialogs.choose_a_file')}</FilePick>
          <button type="button" className="btn sm" onClick={() => void template().then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${kind}-template.xlsx`; a.click(); URL.revokeObjectURL(a.href); })}>{tr('admin.student_dialogs.download_the_template')}</button>
          {file && <span className="chip v">{file}</span>}
        </div>
        <Actions onClose={onClose} busy={busy} label={tr('admin.student_dialogs.import_2')} />
      </form>
    </Dialog>
  );
}

export function MessageDialog({ ids, label, onClose, onDone }: { ids: string[]; label: string; onClose: () => void; onDone: Done }) {
  const { api } = useApp();
  const shake = useShake();
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim().length < 2) { setErr(tr('admin.student_dialogs.write_the_message')); shake.hit(); return; }
    setBusy(true);
    try { const r = await api.students.message({ ids, body }); onDone(tr('admin.student_dialogs.sent_to', { sent: r.sent, p1: r.sent === 1 ? 'guardian' : 'guardians' })); }
    catch (x) { setBusy(false); setErr(messageOf(x)); shake.hit(); }
  };
  return (
    <Dialog title={tr('admin.student_dialogs.message_guardians')} onClose={onClose} shake={shake.cls}>
      <p>{tr('admin.student_dialogs.to_the_primary_guardian_of')}{' '}{label}.</p>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="help" style={{ marginTop: 0 }}>{tr('admin.student_dialogs.it_reaches_them_the_way')}</div>
        <div className="fld">
          <label htmlFor="msg">{tr('admin.student_dialogs.message')}</label>
          <div className={`inp ${err ? 'err shake' : ''}`} style={{ height: 'auto', padding: 12, alignItems: 'stretch' }}>
            <textarea id="msg" value={body} maxLength={500} rows={4} onChange={(e) => { setBody(e.target.value); setErr(''); }} style={{ width: '100%', resize: 'vertical', font: '600 15px/1.5 var(--fb)' }} />
          </div>
          {err ? <ErrorLine>{err}</ErrorLine> : <div className="help">{500 - body.length} {tr('admin.student_dialogs.characters_left')}</div>}
        </div>
        <Actions onClose={onClose} busy={busy} label={tr('admin.student_dialogs.send')} />
      </form>
    </Dialog>
  );
}

export function AssignFeeDialog({ ids, label, onClose, onDone }: { ids: string[]; label: string; onClose: () => void; onDone: Done }) {
  const { api } = useApp();
  const shake = useShake();
  const heads = useFeeHeads();
  const [f, setF] = useState({ head: '', title: '', amount: '', dueOn: '' });
  const head = f.head || heads[0]?.value || '';
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((s) => ({ ...s, [k]: v })); setErr((e) => ({ ...e, [k]: '' })); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.title.trim().length < 3) local.title = tr('admin.student_dialogs.name_the_fee');
    if (!(Number(f.amount) > 0)) local.amount = tr('admin.student_dialogs.enter_an_amount');
    if (!f.dueOn) local.dueOn = tr('admin.student_dialogs.choose_the_due_date');
    if (Object.keys(local).length) { setErr(local); shake.hit(); return; }
    setBusy(true);
    try { const r = await api.students.assignFee({ ids, head, title: f.title, amount: Math.round(Number(f.amount)), dueOn: f.dueOn }); onDone(tr('admin.student_dialogs.added_for', { title: f.title, created: r.created, p2: r.created === 1 ? 'student' : 'students' })); }
    catch (x) { setBusy(false); setErr({ ...fieldsOf(x), title: fieldsOf(x).title ?? (Object.keys(fieldsOf(x)).length ? '' : messageOf(x)) }); shake.hit(); }
  };
  return (
    <Dialog title={tr('admin.student_dialogs.assign_a_fee')} onClose={onClose} shake={shake.cls}>
      <p>{tr('admin.student_dialogs.for')}{' '}{label}{tr('admin.student_dialogs.it_appears_in_each_family')}</p>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SelectField label={tr('admin.student_dialogs.kind_of_fee')} value={head} onChange={set('head')} options={heads} />
        <Field label={tr('admin.student_dialogs.name_of_the_fee')} value={f.title} onChange={set('title')} error={err.title} placeholder={tr('admin.student_dialogs.annual_day_costume')} />
        <div className="two">
          <Field label={tr('admin.student_dialogs.amount', { currencySymbol: currencySymbol() })} value={f.amount} onChange={set('amount')} error={err.amount} inputMode="numeric" />
          <DateField label={tr('admin.student_dialogs.due_on')} value={f.dueOn} onChange={set('dueOn')} error={err.dueOn} />
        </div>
        <Actions onClose={onClose} busy={busy} label={tr('admin.student_dialogs.assign_fee')} />
      </form>
    </Dialog>
  );
}


