import { useState } from 'react';
import { languageLabel, LANGUAGE_LIST, listKey, listLabel, listOptions, schoolToday, DEFAULT_ADDRESS_FORMAT, type AddressFormat, type AddressParts, type CustomFieldsSetting, type CustomValues, type ListItem, type ClassInfo, type GuardianRow, type StudentDetail } from '@tangent/contracts';
import { AddressFields, Checkbox, CustomFieldInputs, DateField, Dialog, ErrorLine, Field, SelectField, currentLanguage, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AreaField, problem, useSetting } from '../../app/kit';

export type Rec = { gender: string; house: string; admissionNo: string; bloodGroup: string; address: string };
export const emptyRec: Rec = { gender: '', house: '', admissionNo: '', bloodGroup: '', address: '' };
/** A school list as a form's choices, keeping a value that was retired since (or typed before the list existed). */
export const choices = (list: ListItem[], current: string) => {
  const items = listOptions(list, current).map((i) => ({ value: i.key, label: listLabel([i], i.key, currentLanguage()) }));
  return current && !items.some((o) => o.value === current) ? [...items, { value: current, label: current }] : items;
};

/**
 * The parts of a student's record beyond name, class and birth date. Which of them the school must fill is the console's
 * `students.required`; the rest say "optional". Houses are offered only when the school has them.
 */
export function RecordFields({ f, set, err, adding, custom, onCustom, address, onAddress }: {
  f: Rec; set: (k: keyof Rec) => (v: string) => void; err: Record<string, string>; adding?: boolean; custom: CustomValues; onCustom: (v: CustomValues) => void;
  address: AddressParts; onAddress: (v: AddressParts) => void;
}) {
  const format = useSetting<AddressFormat>('people.addressFormat', DEFAULT_ADDRESS_FORMAT);
  const own = useSetting<CustomFieldsSetting>('fields.custom', {}).student ?? [];
  const need = useSetting<string[]>('students.required', []);
  const houses = useSetting<{ key: string; name: string }[]>('people.houses', []);
  const genders = useSetting<ListItem[]>('lists.genders', []);
  const blood = useSetting<ListItem[]>('lists.bloodGroups', []);
  const opt = (k: keyof Rec, label: string) => (need.includes(k) ? label : t('admin.student_record.optional', { label }));
  return (
    <>
      <div className="two">
        <SelectField label={opt('gender', t('admin.student_record.gender'))} value={f.gender} onChange={set('gender')} error={err.gender} options={[{ value: '', label: t('admin.student_record.not_given') }, ...choices(genders, f.gender)]} />
        {houses.length > 0 && <SelectField label={opt('house', t('admin.student_record.house'))} value={f.house} onChange={set('house')} error={err.house} options={[{ value: '', label: t('admin.student_record.no_house') }, ...houses.map((h) => ({ value: h.name, label: h.name }))]} />}
      </div>
      <div className="two">
        <Field label={adding && !need.includes('admissionNo') ? t('admin.student_record.admission_number_blank_tangent_numbers') : opt('admissionNo', t('admin.student_record.admission_number'))} value={f.admissionNo} onChange={set('admissionNo')} error={err.admissionNo} maxLength={30} />
        <SelectField label={opt('bloodGroup', t('admin.student_record.blood_group'))} value={f.bloodGroup} onChange={set('bloodGroup')} error={err.bloodGroup} options={[{ value: '', label: t('admin.student_record.not_given') }, ...choices(blood, f.bloodGroup)]} />
      </div>
      <AddressFields format={format} parts={address} onChange={onAddress} errors={err} optional={!need.includes('address')} />
      {err.address && <ErrorLine>{err.address}</ErrorLine>}
      <CustomFieldInputs defs={own} values={custom} onChange={onCustom} errors={err} />
    </>
  );
}

/** Edits a student's record; a new class keeps their marks and attendance. */
export function EditStudentDialog({ s, classes, onClose, onDone }: { s: StudentDetail; classes: ClassInfo[]; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const [f, setF] = useState({ name: s.name, classId: classes.find((c) => c.name === s.className)?.id ?? '', rollNo: s.rollNo, dob: s.dob, gender: s.gender ?? '', house: s.house ?? '', admissionNo: s.admissionNo, bloodGroup: s.bloodGroup ?? '', address: s.address ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '' })); };
  const [custom, setCustom] = useState<CustomValues>(s.custom ?? {});
  const [address, setAddress] = useState<AddressParts>(Object.keys(s.addressParts ?? {}).length ? s.addressParts : { line1: s.address ?? '' });
  const save = async () => {
    if (f.name.trim().length < 2) { setErr({ name: t('admin.student_record.enter_the_full_name') }); shake.hit(); return; }
    setBusy(true);
    try {
      const next = await api.students.update(s.id, { ...f, gender: f.gender || undefined, custom, addressParts: address });
      onDone(next.className !== s.className ? t('admin.student_record.moved_to_their_marks_and', { name: next.name, className: next.className }) : t('admin.student_record.s_record_was_saved', { name: next.name }));
    } catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.edit', { name: s.name })} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.student_record.full_name')} value={f.name} onChange={set('name')} error={err.name} maxLength={80} />
        <div className="two">
          <SelectField label={t('admin.student_record.class')} value={f.classId} onChange={set('classId')} error={err.classId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          <Field label={t('admin.student_record.roll_number')} value={f.rollNo} onChange={set('rollNo')} error={err.rollNo} maxLength={10} />
        </div>
        <DateField label={t('admin.student_record.date_of_birth')} value={f.dob} onChange={set('dob')} error={err.dob} max={schoolToday()} />
        <RecordFields f={f} set={set} err={err} custom={custom} onCustom={setCustom} address={address} onAddress={setAddress} />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.student_record.cancel')}</button>
          <button className="btn pri" disabled={busy} onClick={() => void save()}>{busy ? t('admin.student_record.saving') : t('admin.student_record.save')}</button>
        </div>
      </div>
    </Dialog>
  );
}

type G = Omit<GuardianRow, 'hasApp'> & { key: string };

/** Every guardian of a student: who to contact first, and who may collect the child from school. */
export function GuardiansDialog({ s, onClose, onDone }: { s: StudentDetail; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const rels = useSetting<ListItem[]>('lists.relationships', []);
  // Relations typed before the list existed ("Mother") open as the list's item when one matches.
  const [list, setList] = useState<G[]>(s.guardians.map((g) => ({ ...g, relation: listKey(rels, g.relation) ?? g.relation, key: g.id })));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const upd = (i: number, p: Partial<G>) => { setList(list.map((g, j) => (j === i ? { ...g, ...p } : p.isPrimary ? { ...g, isPrimary: false } : g))); setErr({}); };
  const save = async () => {
    setBusy(true);
    try {
      await api.students.setGuardians(s.id, { guardians: list.map(({ key: _k, ...g }) => ({ ...g, id: g.id || undefined })) });
      onDone(t('admin.student_record.s_guardians_were_saved', { name: s.name }));
    } catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.guardians_of', { name: s.name })} onClose={onClose} width={620} shake={shake.cls}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>{t('admin.student_record.each_guardian_signs_in_to')}</p>
        {list.map((g, i) => (
          <div key={g.key} className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
            <div className="two">
              <Field label={t('admin.student_record.name')} value={g.name} onChange={(name) => upd(i, { name })} maxLength={80} />
              <SelectField label={t('admin.student_record.relation')} value={g.relation} onChange={(relation) => upd(i, { relation })} options={choices(rels, g.relation)} />
            </div>
            <div className="two">
              <Field label={t('admin.student_record.phone')} type="tel" value={g.phone} onChange={(phone) => upd(i, { phone })} maxLength={20} hint={g.id ? t('admin.student_record.shown_hidden_type_a_new') : undefined} />
              <Field label={t('admin.student_record.email_optional')} type="email" value={g.email} onChange={(email) => upd(i, { email })} maxLength={120} />
            </div>
            <SelectField label={t('admin.student_record.reads_messages_in')} value={g.language} onChange={(language) => upd(i, { language })}
              options={[{ value: '', label: t('admin.student_record.the_school_s_language') }, ...LANGUAGE_LIST.map((l) => ({ value: l.code, label: languageLabel(l.code) }))]} />
            <div className="tgrow">
              <Checkbox checked={g.isPrimary} onChange={(c) => c && upd(i, { isPrimary: true })} label={t('admin.student_record.contact_first')} />
              <Checkbox checked={g.canCollect} onChange={(canCollect) => upd(i, { canCollect })} label={t('admin.student_record.may_collect_from_school')} />
              <span className="grow"></span>
              <button className="btn sm" disabled={list.length === 1} onClick={() => { const n = list.filter((_, j) => j !== i); if (g.isPrimary && n[0]) n[0] = { ...n[0], isPrimary: true }; setList(n); }}>{t('admin.student_record.remove')}</button>
            </div>
          </div>
        ))}
        {list.length < 4 && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setList([...list, { key: `new-${Date.now()}`, id: '', name: '', phone: '', email: '', relation: listOptions(rels).find((r) => r.key === 'parent')?.key ?? listOptions(rels)[0]?.key ?? '', canCollect: true, isPrimary: false, language: '' }])}>{t('admin.student_record.add_a_guardian')}</button>}
        {Object.values(err)[0] && <ErrorLine>{Object.values(err)[0]}</ErrorLine>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.student_record.cancel')}</button>
          <button className="btn pri" disabled={busy} onClick={() => void save()}>{busy ? t('admin.student_record.saving') : t('admin.student_record.save_guardians')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Records that a student left: off the rolls and fee runs, records kept for the school's retention period, undone from Academic year. */
export function LeaveDialog({ s, onClose, onDone }: { s: StudentDetail; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const [f, setF] = useState({ leftOn: schoolToday(), reason: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.reason.trim().length < 2) { setErr({ reason: t('admin.student_record.say_why_for_the_record') }); shake.hit(); return; }
    setBusy(true);
    try { await api.year.leaver({ studentId: s.id, leftOn: f.leftOn, reason: f.reason.trim() }); onDone(t('admin.student_record.is_recorded_as_left_academic', { name: s.name })); }
    catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.is_leaving', { name: s.name })} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <DateField label={t('admin.student_record.last_day')} value={f.leftOn} onChange={(leftOn) => setF({ ...f, leftOn })} error={err.leftOn} />
        <AreaField label={t('admin.student_record.why')} value={f.reason} onChange={(reason) => { setF({ ...f, reason }); setErr({}); }} error={err.reason} rows={3} maxLength={200} placeholder={t('admin.student_record.moved_to_another_city')} />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.student_record.cancel')}</button>
          <button className="btn dng" disabled={busy} onClick={() => void save()}>{busy ? t('admin.student_record.saving') : t('admin.student_record.record_as_left')}</button>
        </div>
      </div>
    </Dialog>
  );
}
