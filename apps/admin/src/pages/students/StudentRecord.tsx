import { useState } from 'react';
import { CONTACT_CHANNELS, LEAVING_KINDS, LEAVING_KIND_LABELS, composeName, languageLabel, LANGUAGE_LIST, listKey, listLabel, listOptions, schoolToday, type ContactChannel, type LeavingKind, DEFAULT_ADDRESS_FORMAT, type AddressFormat, type AddressParts, type CustomFieldsSetting, type CustomValues, type ListItem, type ClassInfo, type GuardianRow, type StudentDetail } from '@tangent/contracts';
import { AddressFields, Checkbox, CustomFieldInputs, DateField, Dialog, ErrorLine, Field, SelectField, currentLanguage, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AreaField, problem, useSetting } from '../../app/kit';

export type Rec = { gender: string; house: string; admissionNo: string; bloodGroup: string; address: string };
export type Names = { name: string; givenName: string; familyName: string; nameLocal: string };

/**
 * A student's name: the full name, or a given and a family name that make it in the school's order (People → Settings), and
 * the name in a second script. Returns the name to save and an error for each field, or nothing.
 */
export function checkNames(f: Names, order: string): { name: string; errors: Record<string, string> } {
  const given = f.givenName.trim(), family = f.familyName.trim();
  if (given && family) return { name: composeName(given, family, order === 'family-given' ? 'family-given' : 'given-family'), errors: {} };
  const both = t('admin.student_record.enter_both_names');
  if (given || family) return { name: '', errors: given ? { familyName: both } : { givenName: both } };
  return f.name.trim().length < 2 ? { name: '', errors: { name: t('admin.student_record.enter_the_full_name') } } : { name: f.name.trim(), errors: {} };
}

export function NameFields({ f, set, err }: { f: Names; set: (k: keyof Names) => (v: string) => void; err: Record<string, string> }) {
  const order = useSetting<string>('people.nameOrder', 'given-family');
  const made = checkNames(f, order);
  const parts = !!(f.givenName.trim() && f.familyName.trim());
  const pair = [
    <Field key="g" label={t('admin.student_record.given_name')} value={f.givenName} onChange={set('givenName')} error={err.givenName} maxLength={60} />,
    <Field key="f" label={t('admin.student_record.family_name')} value={f.familyName} onChange={set('familyName')} error={err.familyName} maxLength={60} />,
  ];
  return (
    <>
      <Field label={t('admin.student_record.full_name')} value={parts ? made.name : f.name} onChange={set('name')} error={err.name} maxLength={80} disabled={parts}
        hint={parts ? t('admin.student_record.made_from_the_given_and') : t('admin.student_record.or_give_the_given_and')} />
      <div className="two">{order === 'family-given' ? pair.reverse() : pair}</div>
      <Field label={t('admin.student_record.name_in_a_second_script')} value={f.nameLocal} onChange={set('nameLocal')} error={err.nameLocal} maxLength={80} hint={t('admin.student_record.shown_beside_the_name_and')} />
    </>
  );
}
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
  const order = useSetting<string>('people.nameOrder', 'given-family');
  const [f, setF] = useState({ name: s.name, givenName: s.givenName ?? '', familyName: s.familyName ?? '', nameLocal: s.nameLocal ?? '', classId: classes.find((c) => c.name === s.className)?.id ?? '', rollNo: s.rollNo, dob: s.dob, gender: s.gender ?? '', house: s.house ?? '', admissionNo: s.admissionNo, bloodGroup: s.bloodGroup ?? '', address: s.address ?? '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '' })); };
  const [custom, setCustom] = useState<CustomValues>(s.custom ?? {});
  const [address, setAddress] = useState<AddressParts>(Object.keys(s.addressParts ?? {}).length ? s.addressParts : { line1: s.address ?? '' });
  const save = async () => {
    const named = checkNames(f, order);
    if (Object.keys(named.errors).length) { setErr(named.errors); shake.hit(); return; }
    setBusy(true);
    try {
      // With both parts the server makes the name from them; a full name alone drops parts that no longer match it.
      const { givenName, familyName, ...rest } = f;
      const names = givenName.trim() && familyName.trim() ? { givenName, familyName } : { name: named.name };
      const next = await api.students.update(s.id, { ...rest, ...names, name: names.name, nameLocal: f.nameLocal.trim(), gender: f.gender || undefined, custom, addressParts: address });
      onDone(next.className !== s.className ? t('admin.student_record.moved_to_their_marks_and', { name: next.name, className: next.className }) : t('admin.student_record.s_record_was_saved', { name: next.name }));
    } catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.edit', { name: s.name })} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <NameFields f={f} set={set} err={err} />
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
const CHANNEL: Record<ContactChannel, string> = { sms: t('admin.student_record.text_message'), whatsapp: t('admin.student_record.whatsapp'), email: t('admin.student_record.email'), push: t('admin.student_record.the_app') };

/** Every guardian of a student: who to contact first, who gets the messages and the bills, how to reach them, and who may collect the child. */
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
              <Checkbox checked={g.getsMessages} onChange={(getsMessages) => upd(i, { getsMessages })} label={t('admin.student_record.gets_the_school_s_messages')} />
              <Checkbox checked={g.getsBills} onChange={(getsBills) => upd(i, { getsBills })} label={t('admin.student_record.gets_the_bills')} />
            </div>
            <div className="tgrow">
              <span className="lbl">{t('admin.student_record.reach_them_by')}</span>
              {CONTACT_CHANNELS.map((c) => (
                <Checkbox key={c} checked={!g.channelsOff.includes(c)} label={CHANNEL[c]}
                  onChange={(on) => upd(i, { channelsOff: on ? g.channelsOff.filter((x) => x !== c) : [...g.channelsOff, c] })} />
              ))}
              <span className="grow"></span>
              <button className="btn sm" disabled={list.length === 1} onClick={() => { const n = list.filter((_, j) => j !== i); if (g.isPrimary && n[0]) n[0] = { ...n[0], isPrimary: true }; setList(n); }}>{t('admin.student_record.remove')}</button>
            </div>
          </div>
        ))}
        {list.length < 4 && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setList([...list, { key: `new-${Date.now()}`, id: '', name: '', phone: '', email: '', relation: listOptions(rels).find((r) => r.key === 'parent')?.key ?? listOptions(rels)[0]?.key ?? '', canCollect: true, isPrimary: false, language: '', getsMessages: true, getsBills: false, channelsOff: [] }])}>{t('admin.student_record.add_a_guardian')}</button>}
        {!list.some((g) => g.getsMessages) && <p className="help" style={{ margin: 0 }}>{t('admin.student_record.nobody_gets_messages')}</p>}
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
  const [f, setF] = useState<{ leftOn: string; reason: string; kind: LeavingKind; transferTo: string }>({ leftOn: schoolToday(), reason: '', kind: 'withdrawn', transferTo: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const local: Record<string, string> = {};
    if (f.reason.trim().length < 2) local.reason = t('admin.student_record.say_why_for_the_record');
    if (f.kind === 'transferred' && !f.transferTo.trim()) local.transferTo = t('admin.student_record.enter_the_school_they_moved');
    if (Object.keys(local).length) { setErr(local); shake.hit(); return; }
    setBusy(true);
    try {
      await api.year.leaver({ studentId: s.id, leftOn: f.leftOn, reason: f.reason.trim(), kind: f.kind, transferTo: f.kind === 'transferred' ? f.transferTo.trim() : undefined });
      onDone(t('admin.student_record.is_recorded_as_left_academic', { name: s.name }));
    }
    catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.is_leaving', { name: s.name })} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <DateField label={t('admin.student_record.last_day')} value={f.leftOn} onChange={(leftOn) => setF({ ...f, leftOn })} error={err.leftOn} />
        <SelectField label={t('admin.student_record.leaving_because')} value={f.kind} onChange={(kind) => { setF({ ...f, kind: kind as LeavingKind }); setErr({}); }} options={LEAVING_KINDS.map((k) => ({ value: k, label: LEAVING_KIND_LABELS[k] }))} />
        {f.kind === 'transferred' && <Field label={t('admin.student_record.the_school_they_moved_to')} value={f.transferTo} onChange={(transferTo) => { setF({ ...f, transferTo }); setErr({}); }} error={err.transferTo} maxLength={120} />}
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

/** Leave the office records itself (a long illness, a family abroad): approved at once; the roll call starts with it. */
export function AwayDialog({ s, onClose, onDone }: { s: StudentDetail; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const [f, setF] = useState<{ from: string; to: string; halfDay: '' | 'am' | 'pm'; reason: string }>({ from: schoolToday(), to: schoolToday(), halfDay: '', reason: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const put = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setErr({}); };
  const save = async () => {
    const local: Record<string, string> = {};
    if (f.reason.trim().length < 2) local.reason = t('admin.student_record.give_a_reason');
    if (!f.halfDay && f.to < f.from) local.to = t('admin.student_record.before_the_first_day');
    if (Object.keys(local).length) { setErr(local); shake.hit(); return; }
    setBusy(true);
    try {
      await api.students.recordLeave(s.id, { from: f.from, to: f.halfDay ? f.from : f.to, halfDay: f.halfDay || undefined, reason: f.reason.trim() });
      onDone(t('admin.student_record.leave_recorded_for', { name: s.name }));
    } catch (e) { setBusy(false); setErr(problem(e)); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.student_record.record_leave_for', { name: s.name })} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>{t('admin.student_record.the_roll_call_starts_with')}</p>
        <SelectField label={t('admin.student_record.how_long')} value={f.halfDay} onChange={(h) => put({ halfDay: h as typeof f.halfDay })}
          options={[{ value: '', label: t('admin.student_record.whole_days') }, { value: 'am', label: t('admin.student_record.a_morning') }, { value: 'pm', label: t('admin.student_record.an_afternoon') }]} />
        <div className="two">
          <DateField label={f.halfDay ? t('admin.student_record.day') : t('admin.student_record.first_day')} value={f.from} onChange={(from) => put({ from, to: f.to < from ? from : f.to })} error={err.from} />
          {!f.halfDay && <DateField label={t('admin.student_record.last_day')} value={f.to} onChange={(to) => put({ to })} error={err.to} min={f.from} />}
        </div>
        <AreaField label={t('admin.student_record.why')} value={f.reason} onChange={(reason) => put({ reason })} error={err.reason} rows={3} maxLength={200} />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.student_record.cancel')}</button>
          <button className="btn pri" disabled={busy} onClick={() => void save()}>{busy ? t('admin.student_record.saving') : t('admin.student_record.record_leave')}</button>
        </div>
      </div>
    </Dialog>
  );
}
