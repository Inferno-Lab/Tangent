import { useState, type ReactNode } from 'react';
import { APP_CATALOG, APP_ROLES, APP_ROLE_LABELS, hasKey, type AppRole } from '@tangent/config-engine';
import { AdmissionStages, CERTIFICATE_PLACEHOLDERS, DEFAULT_ADMISSION_STAGES, DEFAULT_CERTIFICATE_TYPES, DEFAULT_LEAVE_TYPES, DEFAULT_TRIP_SESSIONS, TimetableCycle, type CertificateType, type LeaveType, listLabel, readPlace, type LateRule, type LibraryMember, type LibraryTypeRule, type TripSession, type AdmissionStage, rawOf, tx, VOCAB_CONCEPTS, languageLabel, wordsFor, type VocabConcept, type Vocabulary, type Word, ATTENDANCE_MARKS, CATEGORY_TONES, CATEGORY_TONE_LABELS, DEFAULT_BRAND, MARK_MEANING_LABELS, MESSAGE_EVENTS, PAYMENT_KINDS, PAYMENT_KIND_LABELS, type AppLayout, type AttendanceMarkDef, type Category, type ListItem, ADDRESS_PARTS, ADDRESS_PART_LABELS, SCHEME_KINDS, SCHEME_KIND_LABELS, BLOCK_KINDS, BLOCK_KIND_LABELS, DEFAULT_TEMPLATES, DOC_KINDS, DOC_KIND_LABELS, DOC_PLACEHOLDERS, PAGE_SIZES, type Block, type DocKind, type DocTemplate, type DocTemplates, type GradeBand, type GradingScheme, type AddressFormat, CUSTOM_ENTITIES, FIELD_KINDS, DEFAULT_STEP, PROCESS_LABELS, STEP_ACTORS, STEP_ACTOR_LABELS, STEP_TIMEOUTS, STEP_TIMEOUT_LABELS, WORKFLOW_PROCESSES, type StepDef, type WorkflowProcess, type WorkflowsSetting, type CustomEntity, type CustomFieldsSetting, type FieldDef, type FieldKind, type PaymentMethod, type SettingMeta } from '@tangent/contracts';
import { Checkbox, DateField, FilePick, NumberField, TimeField } from './fields';
import { ColourField } from './ColourPicker';
import { ErrorLine, Field, SelectField } from './forms';
import { Select } from './Select';
import { Icon } from './Icon';
import { currentLanguage, t as tr } from './i18n';

/** What a setting's editor picks from: the school's classes and fee heads, and what it has, so the app's choices fit its modules. */
export interface SettingCtx {
  classes: { id: string; name: string }[];
  feeHeads: { key: string; name: string }[];
  entitled: readonly string[];
  features: readonly string[];
  /** The settings as they apply now: the words editor offers the school's languages. */
  values?: Record<string, unknown>;
  /** Who a request's step can name: the school's roles (by key) and its staff. */
  roles?: { key: string; name: string }[];
  staff?: { id: string; name: string }[];
  /** The subjects a grading scheme can be for. */
  subjects?: { id: string; name: string }[];
  /** Prints a document template being edited (the admin passes it; the console has no school data to print with). */
  previewDocument?: (kind: DocKind, template: DocTemplate) => Promise<Blob>;
}

/** The channels a message can go through, as the Hub sends them. */
const CHANNELS = [['push', tr('ui.settings.app')], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', tr('ui.settings.email')]] as const;
const ta = { width: '100%', minHeight: 90, resize: 'vertical', border: 0, outline: 0, background: 'none', font: '400 14px/1.5 var(--fb)', color: 'var(--ink)', padding: '10px 0' } as const;

/**
 * One setting's editor, built from its SETTINGS_META entry: the console (Tangent) and the school's admin draw every setting
 * with this, so a new setting needs no new screen in either.
 */
export function SettingRow({ meta, value, error, disabled, ctx, logo, onLogo, onChange, note, after }: {
  meta: SettingMeta; value: unknown; error?: string; disabled: boolean; ctx: SettingCtx; logo?: File | null; onLogo?: (f: File | null) => void; onChange: (v: unknown) => void;
  /** Why it is read-only (a Tangent lock), or anything else to say under it. */
  note?: ReactNode;
  /** Shown under the control (the console's colour card under the brand colour). */
  after?: ReactNode;
}) {
  const label = <>{meta.label}{meta.risky && <span className="chip a" style={{ marginInlineStart: 8 }}>{tr('ui.settings.needs_a_second_person')}</span>}</>;
  const help = note ?? meta.help;
  const str = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (key: string, max?: number) => onChange(list.includes(key) ? list.filter((x) => x !== key) : max && list.length >= max ? list : [...list, key]);
  const box = (body: React.ReactNode) => (
    <div className="fld" style={{ marginTop: 12 }}>
      <label>{label}</label>
      {body}
      {error ? <ErrorLine>{error}</ErrorLine> : help ? <div className="help">{help}</div> : null}
    </div>
  );
  const pick = (options: { key: string; label: string }[], max?: number) => box(
    <div className="tgrow">{options.map((o) => {
      const at = list.indexOf(o.key);
      return <button key={o.key} type="button" className={`chip ${at >= 0 ? 'v' : ''}`} aria-pressed={at >= 0} disabled={disabled} onClick={() => toggle(o.key, max)} style={{ cursor: disabled ? 'default' : 'pointer' }}>{at >= 0 && meta.kind !== 'classes' && meta.kind !== 'multi' && meta.kind !== 'appRoles' ? `${at + 1}. ` : ''}{o.label}</button>;
    })}{max && <span className="help">{list.length} {tr('ui.settings.of')}{' '}{max}</span>}</div>,
  );
  switch (meta.kind) {
    case 'bool':
      return box(<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button type="button" className={`sw ${value === true ? 'on' : ''}`} role="switch" aria-checked={value === true} aria-label={meta.label} disabled={disabled} onClick={() => onChange(value !== true)} /><span className="help" style={{ margin: 0 }}>{value === true ? tr('ui.settings.on') : tr('ui.settings.off')}</span></div>);
    case 'enum': case 'language':
      return box(<Select value={str} onChange={onChange} disabled={disabled} aria-label={meta.label} options={(meta.options ?? []).map(([v, l]) => ({ value: v, label: l }))} />);
    case 'number':
      return <div style={{ marginTop: 12 }}><NumberField label={meta.label} min={meta.min} max={meta.max} value={value == null ? '' : String(value)} onChange={(v) => onChange(v === '' ? null : Number(v))} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /></div>;
    case 'color':
      return box(<><ColourField label={meta.label} value={str || DEFAULT_BRAND} onChange={onChange} disabled={disabled} />{after}</>);
    case 'time': case 'date':
      return <div style={{ marginTop: 12 }}>{meta.kind === 'date' ? <DateField label={meta.label} value={str} onChange={(v) => onChange(v || null)} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /> : <TimeField label={meta.label} value={str} onChange={(v) => onChange(v || null)} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} />}</div>;
    case 'textarea':
      return box(<div className={`inp ${error ? 'err' : ''}`} style={{ height: 'auto' }}><textarea value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={meta.label} style={ta} /></div>);
    case 'logo':
      return box(<LogoPick has={!!str} picked={logo ?? null} disabled={disabled || !onLogo} onPick={(f) => onLogo?.(f)} />);
    case 'multi':
      // `tax.heads` names the school's own fee heads; every other list names its options.
      return pick(meta.options ? meta.options.map(([key, l]) => ({ key, label: l })) : ctx.feeHeads.map((h) => ({ key: h.key, label: h.name })));
    case 'appRoles': return pick(APP_ROLES.map((r) => ({ key: r, label: APP_ROLE_LABELS[r] })));
    case 'appLayout':
      return box(<AppLayoutEditor value={(value ?? {}) as Record<AppRole, AppLayout>} has={{ modules: ctx.entitled, features: ctx.features }} disabled={disabled} onChange={onChange} />);
    case 'classes': return pick(ctx.classes.map((c) => ({ key: c.id, label: c.name })), meta.max);
    case 'strings':
      return box(<ListEditor items={list} max={meta.max ?? 12} disabled={disabled} placeholder={tr('ui.settings.add_one')} onChange={onChange} />);
    case 'houses':
      return box(<HousesEditor value={(Array.isArray(value) ? value : []) as { key: string; name: string; color: string }[]} max={meta.max ?? 12} disabled={disabled} onChange={onChange} />);
    case 'categories':
      return box(<CategoriesEditor value={(Array.isArray(value) ? value : []) as Category[]} max={meta.max ?? 16} disabled={disabled} onChange={onChange} />);
    case 'attendanceMarks':
      return box(<AttendanceMarksEditor value={(Array.isArray(value) ? value : []) as AttendanceMarkDef[]} max={meta.max ?? 20} disabled={disabled} onChange={onChange} />);
    case 'paymentMethods':
      return box(<PaymentMethodsEditor value={(Array.isArray(value) ? value : []) as PaymentMethod[]} max={meta.max ?? 16} disabled={disabled} onChange={onChange} />);
    case 'vocabulary': {
      const v = ctx.values ?? {};
      const langs = [...new Set([String(v['school.language'] ?? 'en'), ...(Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : [])])];
      return box(<VocabularyEditor value={(value ?? {}) as Vocabulary} languages={langs} disabled={disabled} onChange={onChange} />);
    }
    case 'list': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<ListItemsEditor value={(Array.isArray(value) ? value : []) as ListItem[]} languages={others} max={meta.max ?? 40} disabled={disabled} onChange={onChange} />);
    }
    case 'customFields': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<CustomFieldsEditor value={(value ?? {}) as CustomFieldsSetting} languages={others} disabled={disabled} onChange={onChange} />);
    }
    case 'workflows': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<WorkflowsEditor value={(value ?? {}) as WorkflowsSetting} languages={others} roles={ctx.roles ?? []} staff={ctx.staff ?? []} disabled={disabled} onChange={onChange} />);
    }
    case 'taxSplit': {
      const parts = (Array.isArray(value) ? value : []) as { name: string; sharePct: number }[];
      const put = (i: number, patch: Partial<{ name: string; sharePct: number }>) => onChange(parts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      return box(<div>
        {!parts.length && <div className="help" style={{ margin: 0 }}>{tr('ui.settings.one_tax_line')}</div>}
        {parts.map((x, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 140 }}><Field label={tr('ui.settings.part')} value={x.name} maxLength={20} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
            <div style={{ width: 160 }}><NumberField label={tr('ui.settings.share_pct')} min={0} max={100} decimals value={String(x.sharePct)} disabled={disabled} onChange={(v) => put(i, { sharePct: v === '' ? 0 : Number(v) })} /></div>
            <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(parts.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
        ))}
        {parts.length < 4 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...parts, { name: tr('ui.settings.part_n', { n: parts.length + 1 }), sharePct: parts.length ? 0 : 100 }])}>{tr('ui.settings.add_a_part')}</button>}
      </div>);
    }
    case 'addressFormat': {
      const fmt = (Array.isArray(value) ? value : []) as AddressFormat;
      return box(<div>
        {ADDRESS_PARTS.map((k) => {
          const at = fmt.findIndex((p) => p.key === k);
          const on = at >= 0;
          return (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
              <div style={{ width: 150, paddingBottom: 10 }}><Checkbox checked={on} disabled={disabled || (on && fmt.length <= 1)} label={ADDRESS_PART_LABELS[k]}
                onChange={(v) => onChange(v ? ADDRESS_PARTS.flatMap((x) => (x === k ? [{ key: k, label: ADDRESS_PART_LABELS[k] }] : fmt.filter((p) => p.key === x))) : fmt.filter((p) => p.key !== k))} /></div>
              {on && <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.called')} value={fmt[at]!.label} maxLength={30} disabled={disabled} onChange={(v) => onChange(fmt.map((p) => (p.key === k ? { ...p, label: v } : p)))} /></div>}
            </div>
          );
        })}
      </div>);
    }
    case 'weights': {
      // One number for each of the school's kinds of exam (exams.types); a kind left empty counts nothing.
      const kinds = (Array.isArray(ctx.values?.['exams.types']) ? (ctx.values!['exams.types'] as ListItem[]) : []).filter((i) => i.active !== false);
      const w = (value ?? {}) as Record<string, number>;
      return box(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {kinds.map((k) => <div key={k.key} style={{ width: 170 }}><NumberField label={listLabel(kinds, k.key, currentLanguage())} min={0} max={meta.max ?? 100} value={w[k.key] === undefined ? '' : String(w[k.key])} disabled={disabled}
            onChange={(v) => { const next = { ...w }; if (v === '') delete next[k.key]; else next[k.key] = Math.min(meta.max ?? 100, Math.max(0, Number(v) || 0)); onChange(next); }} /></div>)}
          {!kinds.length && <div className="help" style={{ margin: 0 }}>{tr('ui.settings.add_kinds_of_exam_first')}</div>}
        </div>,
      );
    }
    case 'lateRule': {
      const r = (value ?? null) as LateRule | null;
      const heads = (ctx.feeHeads ?? []);
      const put = (p: Partial<LateRule>) => onChange({ kind: 'percent', amount: 0, every: 'month', graceDays: 0, cap: 0, heads: [], ...r, ...p });
      return box(
        <div>
          <Checkbox checked={!!r} disabled={disabled} label={tr('ui.settings.use_a_late_fee_rule')} onChange={(on) => onChange(on ? { kind: 'percent', amount: 2, every: 'month', graceDays: 0, cap: 0, heads: [] } : null)} />
          {r && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
            <div style={{ width: 200 }}><SelectField label={tr('ui.settings.late_fee_is')} value={r.kind} disabled={disabled} onChange={(k) => put({ kind: k as LateRule['kind'] })} options={[{ value: 'percent', label: tr('ui.settings.a_percent_of_what_is_owed') }, { value: 'fixed', label: tr('ui.settings.a_fixed_amount') }]} /></div>
            <div style={{ width: 130 }}><NumberField label={r.kind === 'percent' ? tr('ui.settings.percent') : tr('ui.settings.amount')} min={0} max={r.kind === 'percent' ? 25 : 1000000} decimals value={String(r.amount)} disabled={disabled} onChange={(v) => put({ amount: Number(v) || 0 })} /></div>
            <div style={{ width: 180 }}><SelectField label={tr('ui.settings.charged')} value={r.every} disabled={disabled} onChange={(e) => put({ every: e as LateRule['every'] })} options={[{ value: 'once', label: tr('ui.settings.once') }, { value: 'day', label: tr('ui.settings.every_day') }, { value: 'week', label: tr('ui.settings.every_week_late') }, { value: 'month', label: tr('ui.settings.every_month') }]} /></div>
            <div style={{ width: 130 }}><NumberField label={tr('ui.settings.grace_days')} min={0} max={90} value={String(r.graceDays)} disabled={disabled} onChange={(v) => put({ graceDays: Number(v) || 0 })} /></div>
            <div style={{ width: 150 }}><NumberField label={tr('ui.settings.cap_0_none')} min={0} decimals value={String(r.cap)} disabled={disabled} onChange={(v) => put({ cap: Number(v) || 0 })} /></div>
          </div>}
          {r && heads.length > 0 && <div className="tgrow" style={{ marginTop: 8 }}><span className="lbl">{tr('ui.settings.on_these_fees')}</span>{heads.map((h) => <Checkbox key={h.key} checked={r.heads.includes(h.key)} disabled={disabled} label={h.name} onChange={(on) => put({ heads: on ? [...r.heads, h.key] : r.heads.filter((x) => x !== h.key) })} />)}<span className="help" style={{ margin: 0 }}>{tr('ui.settings.none_ticked_every_fee')}</span></div>}
        </div>,
      );
    }
    case 'reminderDays': {
      const days = (Array.isArray(value) ? value : []) as number[];
      const put = (next: number[]) => onChange([...new Set(next)].sort((a, b) => a - b).slice(0, 8));
      return box(
        <div>
          <div className="tgrow">{days.map((d) => <button key={d} type="button" className="chip v" disabled={disabled} onClick={() => put(days.filter((x) => x !== d))} aria-label={tr('ui.settings.remove')}>
            {d < 0 ? tr('ui.settings.days_before', { n: -d }) : d === 0 ? tr('ui.settings.on_the_day') : tr('ui.settings.days_after', { n: d })} ×</button>)}</div>
          <ReminderDayAdd disabled={disabled} onAdd={(d) => put([...days, d])} />
        </div>,
      );
    }
    case 'libraryTypes': {
      // A row for each of the library's item types (library.itemTypes); an empty box is the library's own rule.
      const types = (Array.isArray(ctx.values?.['library.itemTypes']) ? (ctx.values!['library.itemTypes'] as ListItem[]) : [{ key: 'book', name: 'Book' }]).filter((i) => i.active !== false);
      const all = (value ?? {}) as Record<string, LibraryTypeRule>;
      const put = (key: string, k: keyof LibraryTypeRule, v: string) => {
        const rule = { ...all[key] };
        if (v === '') delete rule[k]; else rule[k] = Number(v);
        const next = { ...all };
        if (Object.keys(rule).length) next[key] = rule; else delete next[key];
        onChange(next);
      };
      const num = (r: LibraryTypeRule | undefined, k: keyof LibraryTypeRule) => (r?.[k] === undefined ? '' : String(r[k]));
      return box(
        <div className="stack" style={{ gap: 8 }}>
          {types.map((ty) => (
            <div key={ty.key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <b style={{ width: 140, paddingBottom: 12 }}>{listLabel(types, ty.key, currentLanguage())}</b>
              <div style={{ width: 130 }}><NumberField label={tr('ui.settings.loan_days')} min={1} max={365} value={num(all[ty.key], 'loanDays')} disabled={disabled} onChange={(v) => put(ty.key, 'loanDays', v)} /></div>
              <div style={{ width: 150 }}><NumberField label={tr('ui.settings.fine_per_day')} min={0} max={100000} decimals value={num(all[ty.key], 'finePerDay')} disabled={disabled} onChange={(v) => put(ty.key, 'finePerDay', v)} /></div>
              <div style={{ width: 130 }}><NumberField label={tr('ui.settings.renewals')} min={0} max={10} value={num(all[ty.key], 'maxRenewals')} disabled={disabled} onChange={(v) => put(ty.key, 'maxRenewals', v)} /></div>
            </div>
          ))}
        </div>,
      );
    }
    case 'libraryMembers': {
      const kinds = (Array.isArray(value) ? value : []) as LibraryMember[];
      const put = (i: number, p: Partial<LibraryMember>) => onChange(kinds.map((m, j) => (j === i ? { ...m, ...p } : m)));
      // Year groups as a range: both empty is every year.
      const range = (m: LibraryMember) => (m.grades.length ? [Math.min(...m.grades), Math.max(...m.grades)] : [null, null]) as [number | null, number | null];
      const setRange = (i: number, from: number | null, to: number | null) => {
        const a = from ?? to, b = to ?? from;
        put(i, { grades: a === null || b === null ? [] : Array.from({ length: Math.min(20, Math.abs(b - a) + 1) }, (_, k) => Math.min(a, b) + k) });
      };
      const add = () => onChange([...kinds, { key: `m${Date.now().toString(36)}`, name: '', staff: false, grades: [], loanDays: 14, maxLoans: 3 }]);
      return box(
        <div className="stack" style={{ gap: 8 }}>
          {kinds.map((m, i) => {
            const [from, to] = range(m);
            return (
              <div key={m.key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 180 }}><Field label={tr('ui.settings.name')} value={m.name} disabled={disabled} maxLength={40} onChange={(v) => put(i, { name: v })} /></div>
                <div style={{ width: 150 }}><SelectField label={tr('ui.settings.who')} value={m.staff ? 'staff' : 'students'} disabled={disabled} onChange={(v) => put(i, { staff: v === 'staff', grades: [] })}
                  options={[{ value: 'students', label: tr('ui.settings.students') }, { value: 'staff', label: tr('ui.settings.staff') }]} /></div>
                {!m.staff && <>
                  <div style={{ width: 110 }}><NumberField label={tr('ui.settings.from_year')} min={-3} max={20} value={from === null ? '' : String(from)} disabled={disabled} onChange={(v) => setRange(i, v === '' ? null : Number(v), to)} /></div>
                  <div style={{ width: 110 }}><NumberField label={tr('ui.settings.to_year')} min={-3} max={20} value={to === null ? '' : String(to)} disabled={disabled} onChange={(v) => setRange(i, from, v === '' ? null : Number(v))} /></div>
                </>}
                <div style={{ width: 120 }}><NumberField label={tr('ui.settings.loan_days')} min={1} max={365} value={String(m.loanDays)} disabled={disabled} onChange={(v) => put(i, { loanDays: Math.max(1, Number(v) || 1) })} /></div>
                <div style={{ width: 120 }}><NumberField label={tr('ui.settings.items_at_once')} min={1} max={50} value={String(m.maxLoans)} disabled={disabled} onChange={(v) => put(i, { maxLoans: Math.max(1, Number(v) || 1) })} /></div>
                <button type="button" className="btn sm" disabled={disabled} style={{ marginBottom: 6 }} onClick={() => onChange(kinds.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
              </div>
            );
          })}
          {kinds.length < 12 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={disabled} onClick={add}><Icon name="plus" />{tr('ui.settings.add_member_type')}</button>}
        </div>,
      );
    }
    case 'tripSessions': {
      const trips = (Array.isArray(value) && value.length ? value : DEFAULT_TRIP_SESSIONS) as TripSession[];
      const put = (i: number, p: Partial<TripSession>) => onChange(trips.map((s, j) => (j === i ? { ...s, ...p } : s)));
      // A key the school never sees, made once from the first name it is given, so trips already run keep their name.
      const add = () => onChange([...trips, { key: `trip${Date.now().toString(36).slice(-5)}`, name: '', from: '15:00' }]);
      return box(
        <div className="stack" style={{ gap: 8 }}>
          {trips.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ width: 220 }}><Field label={tr('ui.settings.name')} value={s.name} disabled={disabled} maxLength={40} onChange={(v) => put(i, { name: v })} /></div>
              <div style={{ width: 140 }}><TimeField label={tr('ui.settings.offered_from')} value={s.from} disabled={disabled} onChange={(v) => put(i, { from: v })} /></div>
              <button type="button" className="btn sm" style={{ marginBottom: 6 }} disabled={disabled || trips.length <= 1} onClick={() => onChange(trips.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
            </div>
          ))}
          {trips.length < 8 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={disabled} onClick={add}><Icon name="plus" />{tr('ui.settings.add_a_trip')}</button>}
        </div>,
      );
    }
    case 'leaveTypes': {
      const types = (Array.isArray(value) && value.length ? value : DEFAULT_LEAVE_TYPES) as LeaveType[];
      const put = (i: number, p: Partial<LeaveType>) => onChange(types.map((x, j) => (j === i ? { ...x, ...p } : x)));
      // A key nobody sees, made once, so leave already taken keeps its type when the name changes.
      const add = () => onChange([...types, { key: `lt${Date.now().toString(36).slice(-6)}`, name: '', days: 0, accrual: 'year', carry: 0, halfDays: true, paid: true }]);
      return box(
        <div className="stack" style={{ gap: 10 }}>
          {types.map((x, i) => (
            <div key={x.key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ width: 180 }}><Field label={tr('ui.settings.name')} value={x.name} disabled={disabled} maxLength={40} onChange={(v) => put(i, { name: v })} /></div>
              <div style={{ width: 110 }}><NumberField label={tr('ui.settings.days_a_year')} min={0} max={366} value={String(x.days)} disabled={disabled} onChange={(v) => put(i, { days: Math.max(0, Number(v) || 0) })} /></div>
              <div style={{ width: 210 }}><SelectField label={tr('ui.settings.given')} value={x.accrual} disabled={disabled} onChange={(v) => put(i, { accrual: v as LeaveType['accrual'] })}
                options={[{ value: 'year', label: tr('ui.settings.all_at_the_start') }, { value: 'month', label: tr('ui.settings.a_twelfth_each_month') }]} /></div>
              <div style={{ width: 120 }}><NumberField label={tr('ui.settings.carries_over')} min={0} max={366} value={String(x.carry)} disabled={disabled} onChange={(v) => put(i, { carry: Math.max(0, Number(v) || 0) })} /></div>
              <Checkbox checked={x.halfDays} disabled={disabled} label={tr('ui.settings.half_days')} onChange={(on) => put(i, { halfDays: on })} />
              <Checkbox checked={x.paid} disabled={disabled} label={tr('ui.settings.paid')} onChange={(on) => put(i, { paid: on })} />
              <Checkbox checked={x.active !== false} disabled={disabled} label={tr('ui.settings.offered')} onChange={(on) => put(i, { active: on ? undefined : false })} />
            </div>
          ))}
          {types.length < 20 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={disabled} onClick={add}><Icon name="plus" />{tr('ui.settings.add_a_leave_type')}</button>}
        </div>,
      );
    }
    case 'certificateTypes': {
      const types = (Array.isArray(value) && value.length ? value : DEFAULT_CERTIFICATE_TYPES) as CertificateType[];
      const put = (i: number, p: Partial<CertificateType>) => onChange(types.map((x, j) => (j === i ? { ...x, ...p } : x)));
      const add = () => onChange([...types, { key: `ct${Date.now().toString(36).slice(-6)}`, name: '', text: '', series: '', fee: 0, noDues: false, families: true }]);
      return box(
        <div className="stack" style={{ gap: 14 }}>
          <small className="help">{tr('ui.settings.certificate_words_help', { names: CERTIFICATE_PLACEHOLDERS.map((p) => `{${p}}`).join(' ') })}</small>
          {types.map((x, i) => (
            <div key={x.key} className="stack" style={{ gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ width: 220 }}><Field label={tr('ui.settings.name')} value={x.name} disabled={disabled} maxLength={60} onChange={(v) => put(i, { name: v })} /></div>
                <div style={{ width: 190 }}><Field label={tr('ui.settings.own_numbering')} value={x.series} disabled={disabled} maxLength={40} onChange={(v) => put(i, { series: v })} /></div>
                <div style={{ width: 120 }}><NumberField label={tr('ui.settings.fee')} min={0} max={1000000} decimals value={String(x.fee)} disabled={disabled} onChange={(v) => put(i, { fee: Math.max(0, Number(v) || 0) })} /></div>
                <Checkbox checked={x.noDues} disabled={disabled} label={tr('ui.settings.only_when_nothing_is_owed')} onChange={(on) => put(i, { noDues: on })} />
                <Checkbox checked={x.families} disabled={disabled} label={tr('ui.settings.families_ask_in_the_app')} onChange={(on) => put(i, { families: on })} />
                <Checkbox checked={x.active !== false} disabled={disabled} label={tr('ui.settings.offered')} onChange={(on) => put(i, { active: on ? undefined : false })} />
              </div>
              <div className="inp" style={{ height: 'auto' }}><textarea style={ta} value={x.text} disabled={disabled} maxLength={3000} aria-label={tr('ui.settings.words')} placeholder={tr('ui.settings.words')}
                onChange={(e) => put(i, { text: e.target.value })} /></div>
            </div>
          ))}
          {types.length < 30 && <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={disabled} onClick={add}><Icon name="plus" />{tr('ui.settings.add_a_certificate')}</button>}
        </div>,
      );
    }
    case 'hours': {
      const h = (value ?? null) as { from: string; to: string } | null;
      return box(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Checkbox checked={!!h} disabled={disabled} label={tr('ui.settings.only_at_set_hours')} onChange={(on) => onChange(on ? { from: '08:00', to: '16:00' } : null)} />
          {h && <><div style={{ width: 140 }}><TimeField label={tr('ui.settings.from')} value={h.from} disabled={disabled} onChange={(v) => onChange({ ...h, from: v })} /></div>
            <div style={{ width: 140 }}><TimeField label={tr('ui.settings.until')} value={h.to} disabled={disabled} onChange={(v) => onChange({ ...h, to: v })} /></div></>}
        </div>,
      );
    }
    case 'timetableCycle': {
      const c = TimetableCycle.safeParse(value).data ?? { kind: 'week' as const, length: 6 };
      return box(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 260 }}><SelectField label={tr('ui.settings.repeats')} value={c.kind} disabled={disabled} onChange={(k) => onChange({ ...c, kind: k })}
            options={[{ value: 'week', label: tr('ui.settings.every_week') }, { value: 'ab', label: tr('ui.settings.a_and_b_weeks') }, { value: 'days', label: tr('ui.settings.a_cycle_of_days') }]} /></div>
          {c.kind === 'days' && <div style={{ width: 150 }}><NumberField label={tr('ui.settings.days_in_the_cycle')} min={2} max={10} value={String(c.length)} disabled={disabled} onChange={(v) => onChange({ ...c, length: Math.min(10, Math.max(2, Number(v) || 2)) })} /></div>}
          {c.kind !== 'week' && <div style={{ width: 220 }}><DateField label={c.kind === 'ab' ? tr('ui.settings.a_day_in_week_a') : tr('ui.settings.day_1_is')} value={c.startsOn ?? ''} disabled={disabled} onChange={(d) => onChange({ ...c, startsOn: d || undefined })} /></div>}
        </div>,
      );
    }
    case 'admissionStages': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      const parsed = AdmissionStages.safeParse(value ?? DEFAULT_ADMISSION_STAGES);
      return box(<AdmissionStagesEditor value={parsed.success ? parsed.data : DEFAULT_ADMISSION_STAGES} languages={others} disabled={disabled} onChange={onChange} />);
    }
    case 'documentTemplates': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<DocumentTemplatesEditor value={(value ?? {}) as DocTemplates} languages={others} preview={ctx.previewDocument} disabled={disabled} onChange={onChange} />);
    }
    case 'gradingSchemes':
      return box(<GradingSchemesEditor value={(Array.isArray(value) ? value : []) as GradingScheme[]} subjects={ctx.subjects ?? []} disabled={disabled} onChange={onChange} />);
    case 'gradingScale':
      return box(<GradingEditor value={(Array.isArray(value) ? value : []) as { grade: string; minPct: number }[]} max={meta.max ?? 12} disabled={disabled} onChange={onChange} />);
    case 'notifyRules': {
      const rules = (value ?? {}) as Record<string, { push: boolean; sms: boolean; email: boolean; whatsapp?: boolean }>;
      const set = (ev: string, ch: (typeof CHANNELS)[number][0], on: boolean) => {
        const base = rules[ev] ?? MESSAGE_EVENTS.find((e) => e.key === ev)!.defaults;
        onChange({ ...rules, [ev]: { ...base, [ch]: on } });
      };
      return box(<div>{MESSAGE_EVENTS.map((e) => {
        const r = rules[e.key] ?? e.defaults;
        return (
          <div key={e.key} className="kv" style={{ flexWrap: 'wrap', gap: 8 }}>{e.label}{e.urgent ? tr('ui.settings.sent_in_quiet_hours') : ''}
            <b style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{CHANNELS.map(([ch, label]) => (
              <Checkbox key={ch} checked={!!(r as Record<string, boolean | undefined>)[ch]} disabled={disabled} onChange={(c) => set(e.key, ch, c)} label={label} />
            ))}</b>
          </div>
        );
      })}</div>);
    }
    case 'templates': {
      const v = ctx.values ?? {};
      const school = String(v['school.language'] ?? 'en');
      const langs = [...new Set([school, ...(Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : [])])];
      return box(<TemplatesEditor value={(value ?? {}) as Record<string, string | Record<string, string>>} school={school} languages={langs} disabled={disabled} onChange={onChange} />);
    }
    case 'place':
      return <PlaceField label={label} value={str} help={typeof help === 'string' ? help : undefined} error={error} disabled={disabled} onChange={(v) => onChange(v)} />;
    default:
      return <div style={{ marginTop: 12 }}><Field label={meta.label} value={str} onChange={onChange} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /></div>;
  }
}

/** A point on the earth as "lat, lng": typed or pasted from a map, or this device's own position (the browser asks first). */
function PlaceField({ label, value, help, error, disabled, onChange }: { label: ReactNode; value: string; help?: string; error?: string; disabled?: boolean; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const at = readPlace(value);
  const here = () => {
    if (!('geolocation' in navigator)) { setErr(tr('ui.settings.place_no_location')); return; }
    setBusy(true); setErr('');
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); onChange(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`); },
      (e) => { setBusy(false); setErr(e.code === e.PERMISSION_DENIED ? tr('ui.settings.place_denied') : tr('ui.settings.place_no_location')); },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  };
  const shown = error || err || (value.trim() && !at ? tr('ui.settings.place_invalid') : '');
  return (
    <div className="fld" style={{ marginTop: 12 }}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}><Field label="" aria-label={typeof label === 'string' ? label : tr('ui.settings.place')} value={value} placeholder="51.5074, -0.1278" maxLength={60} disabled={disabled} onChange={onChange} /></div>
        <button type="button" className="btn sm" disabled={disabled || busy} onClick={here}><Icon name="map" />{busy ? tr('ui.settings.place_finding') : tr('ui.settings.place_here')}</button>
        {at && <a className="btn sm" href={`https://www.openstreetmap.org/?mlat=${at.lat}&mlon=${at.lng}#map=18/${at.lat}/${at.lng}`} target="_blank" rel="noreferrer">{tr('ui.settings.place_map')}</a>}
      </div>
      {shown ? <ErrorLine>{shown}</ErrorLine> : help ? <div className="help">{help}</div> : null}
    </div>
  );
}

/** The logo is a file: picked here, sent with the rest of the change when it is saved. */
function LogoPick({ has, picked, disabled, onPick }: { has: boolean; picked: File | null; disabled: boolean; onPick: (f: File | null) => void }) {
  const [err, setErr] = useState('');
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`chip ${picked ? 'a' : has ? 'g' : ''}`}>{picked ? tr('ui.settings.not_saved_yet', { name: picked.name }) : has ? tr('ui.settings.logo_set') : tr('ui.settings.letters_only')}</span>
        <FilePick accept="image/png,image/jpeg" disabled={disabled} className="btn sm" onPick={(f) => {
          if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr(tr('ui.settings.choose_a_png_or_jpeg'));
          if (f.size > 2 * 1024 * 1024) return setErr(tr('ui.settings.the_logo_must_be_2'));
          setErr(''); onPick(f);
        }}>{has || picked ? tr('ui.settings.choose_another') : tr('ui.settings.choose_a_logo')}</FilePick>
        {picked && <button className="btn sm" onClick={() => onPick(null)}>{tr('ui.settings.keep_the_old_one')}</button>}
      </div>
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  );
}

/** For each app role: its bottom tabs, Home cards and quick buttons, in order, from what the school's modules offer that role. */
function AppLayoutEditor({ value, has, disabled, onChange }: { value: Record<AppRole, AppLayout>; has: { modules: readonly string[]; features: readonly string[] }; disabled: boolean; onChange: (v: unknown) => void }) {
  const [role, setRole] = useState<AppRole>('parent');
  const cur = value[role] ?? { dock: [], home: [], quick: [] };
  const slots = [['dock', tr('ui.settings.bottom_tabs'), 4], ['home', tr('ui.settings.home_cards'), 12], ['quick', tr('ui.settings.quick_buttons'), 6]] as const;
  const set = (slot: keyof AppLayout, key: string, max: number) => {
    const list = cur[slot];
    const next = list.includes(key) ? list.filter((x) => x !== key) : list.length >= max ? list : [...list, key];
    onChange({ ...value, [role]: { ...cur, [slot]: next } });
  };
  return (
    <div>
      <div style={{ maxWidth: 260 }}><Select value={role} onChange={(r) => setRole(r as AppRole)} aria-label={tr('ui.settings.role')} options={APP_ROLES.map((r) => ({ value: r, label: APP_ROLE_LABELS[r] }))} /></div>
      {slots.map(([slot, title, max]) => {
        const offered = APP_CATALOG[slot].filter((c) => c.roles.includes(role) && has.modules.includes(c.module) && hasKey(has, c.feature));
        return (
          <div key={slot} style={{ marginTop: 10 }}>
            <div className="help" style={{ margin: '0 0 4px' }}><b>{title}</b> · {cur[slot].length} {tr('ui.settings.of')}{' '}{max}{slot === 'dock' ? tr('ui.settings.profile_is_always_last') : ''}</div>
            <div className="tgrow">{offered.length ? offered.map((o) => {
              const at = cur[slot].indexOf(o.key);
              return <button key={o.key} type="button" className={`chip ${at >= 0 ? 'v' : ''}`} aria-pressed={at >= 0} disabled={disabled} onClick={() => set(slot, o.key, max)}>{at >= 0 ? `${at + 1}. ` : ''}{o.label}</button>;
            }) : <span className="help" style={{ margin: 0 }}>{tr('ui.settings.the_school_s_modules_offer')}</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A short list of words (leave reasons): add, rename in place, remove. */
function ListEditor({ items, max, disabled, placeholder, onChange }: { items: string[]; max: number; disabled: boolean; placeholder: string; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !items.includes(v) && items.length < max) { onChange([...items, v]); setDraft(''); } };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Field label={tr('ui.settings.item', { p0: i + 1 })} value={it} maxLength={40} disabled={disabled} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} /></div>
          <button type="button" className="btn sm" disabled={disabled || items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {items.length < max && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Field label={tr('ui.settings.new')} value={draft} maxLength={40} disabled={disabled} placeholder={placeholder} onChange={setDraft} /></div>
          <button type="button" className="btn sm" disabled={disabled || !draft.trim()} onClick={add}>{tr('ui.settings.add')}</button>
        </div>
      )}
    </div>
  );
}

const keyOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';

/** The school's houses and their colours. */
function HousesEditor({ value, max, disabled, onChange }: { value: { key: string; name: string; color: string }[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<{ name: string; color: string }>) => onChange(value.map((h, j) => (j === i ? { ...h, ...patch, ...(patch.name !== undefined ? { key: keyOf(patch.name) } : {}) } : h)));
  return (
    <div>
      {!value.length && <div className="help" style={{ margin: 0 }}>{tr('ui.settings.no_houses_profiles_and_the')}</div>}
      {value.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.house')} value={h.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <ColourField label={tr('ui.settings.colour')} value={h.color} disabled={disabled} onChange={(c) => put(i, { color: c })} />
          <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `house-${value.length + 1}`, name: tr('ui.settings.house_2', { p0: value.length + 1 }), color: DEFAULT_BRAND }])}>{tr('ui.settings.add_a_house')}</button>}
    </div>
  );
}

/** Categories of notices or events: a name and the colour pair they are drawn in. */
function CategoriesEditor({ value, max, disabled, onChange }: { value: Category[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<Category>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      {value.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.category')} value={c.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 160 }}><SelectField label={tr('ui.settings.colour')} value={c.tone} disabled={disabled} onChange={(t) => put(i, { tone: t as Category['tone'] })} options={CATEGORY_TONES.map((t) => ({ value: t, label: CATEGORY_TONE_LABELS[t] }))} /></div>
          <span className={`chip ${c.tone}`} style={{ marginBottom: 10 }}>{c.name || tr('ui.settings.category')}</span>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `cat-${Date.now().toString(36).slice(-6)}`, name: tr('ui.settings.new_category'), tone: 'v' }])}>{tr('ui.settings.add_a_category')}</button>}
      <div className="help">{tr('ui.settings.a_category_s_key_stays')}</div>
    </div>
  );
}

/** Grades from the lowest percentage that earns each, highest first. */
function GradingEditor({ value, max, disabled, onChange, points }: { value: GradeBand[]; max: number; disabled: boolean; onChange: (v: unknown) => void; points?: boolean }) {
  const sorted = (rows: GradeBand[]) => [...rows].sort((a, b) => b.minPct - a.minPct);
  const put = (i: number, patch: Partial<GradeBand>) => onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const lowest = value.length ? Math.min(...value.map((g) => g.minPct)) : 0;
  return (
    <div>
      {value.map((g, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ width: 120 }}><Field label={tr('ui.settings.grade')} value={g.grade} maxLength={4} disabled={disabled} onChange={(v) => put(i, { grade: v })} /></div>
          <div style={{ width: 160 }}><NumberField label={tr('ui.settings.from')} min={0} max={100} value={String(g.minPct)} disabled={disabled} onChange={(v) => put(i, { minPct: v === '' ? 0 : Number(v) })} /></div>
          {points !== undefined && <>
            {points && <div style={{ width: 120 }}><NumberField label={tr('ui.settings.points')} min={0} max={100} decimals value={g.points === undefined ? '' : String(g.points)} disabled={disabled} onChange={(v) => put(i, { points: v === '' ? undefined : Number(v) })} /></div>}
            <div style={{ flex: 1, minWidth: 140 }}><Field label={tr('ui.settings.descriptor')} value={g.descriptor ?? ''} maxLength={40} disabled={disabled} onChange={(v) => put(i, { descriptor: v || undefined })} /></div>
          </>}
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {value.length < max && <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...value, { grade: '?', minPct: 0 }])}>{tr('ui.settings.add_a_grade')}</button>}
        <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(sorted(value))}>{tr('ui.settings.put_in_order')}</button>
      </div>
      {lowest > 0 && <div className="help">{tr('ui.settings.no_grade_starts_at_0')}{' '}{lowest}{tr('ui.settings.would_get_no_grade_add')}</div>}
    </div>
  );
}


/** The ways the school takes money: the name the office uses, and what kind of money it is (reports group by the kind). */
/** A school list (§3.6.5): rename, add, retire or bring back an item, and name it in the school's other languages. */
function ListItemsEditor({ value, languages, max, disabled, onChange }: { value: ListItem[]; languages: string[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<ListItem>) => onChange(value.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      {value.map((it, i) => {
        const off = it.active === false;
        return (
          <div key={it.key} style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', opacity: off ? 0.6 : 1 }}>
              <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.item', { p0: i + 1 })} value={it.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
              <div style={{ width: 100 }}><Field label={tr('ui.settings.code')} value={it.code ?? ''} maxLength={8} disabled={disabled} onChange={(v) => put(i, { code: v || undefined })} /></div>
              {languages.length > 0 && <button type="button" className="btn sm" aria-expanded={open === i} disabled={disabled} onClick={() => setOpen(open === i ? null : i)}>{tr('ui.settings.other_languages')}</button>}
              <button type="button" className="btn sm" disabled={disabled || (!off && value.filter((x) => x.active !== false).length <= 1)} onClick={() => put(i, { active: off ? undefined : false })}>{off ? tr('ui.settings.bring_back') : tr('ui.settings.retire')}</button>
            </div>
            {open === i && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
              <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={it.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
                const names = { ...it.names, [l]: v };
                if (!v) delete names[l];
                put(i, { names: Object.keys(names).length ? names : undefined });
              }} /></div>
            ))}</div>}
          </div>
        );
      })}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        let n = value.length + 1;
        while (value.some((x) => x.key === `item-${n}`)) n++;
        onChange([...value, { key: `item-${n}`, name: tr('ui.settings.new_item') }]);
      }}>{tr('ui.settings.add_an_item')}</button>}
      <div className="help">{tr('ui.settings.an_item_keeps_its_key')}</div>
    </div>
  );
}

const ENTITY_LABEL: Record<CustomEntity, string> = { student: tr('ui.settings.student_records'), staff: tr('ui.settings.staff_records'), visitor: tr('ui.settings.visitor_records') };
const KIND_LABEL: Record<FieldKind, string> = {
  text: tr('ui.settings.kind_text'), longText: tr('ui.settings.kind_long_text'), number: tr('ui.settings.kind_number'), date: tr('ui.settings.kind_date'), choice: tr('ui.settings.kind_choice'),
  multi: tr('ui.settings.kind_multi'), yesno: tr('ui.settings.kind_yesno'), phone: tr('ui.settings.kind_phone'), email: tr('ui.settings.kind_email'),
};

/** The school's own fields (§3.6.3), per kind of record: name, kind, choices, whether it is needed and whether families see it. */
function CustomFieldsEditor({ value, languages, disabled, onChange }: { value: CustomFieldsSetting; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [entity, setEntity] = useState<CustomEntity>('student');
  const list = value[entity] ?? [];
  const setList = (next: FieldDef[]) => onChange({ ...value, [entity]: next });
  return (
    <div>
      <div style={{ maxWidth: 260 }}><Select value={entity} onChange={(e) => setEntity(e as CustomEntity)} aria-label={tr('ui.settings.records')} options={CUSTOM_ENTITIES.map((e) => ({ value: e, label: ENTITY_LABEL[e] }))} /></div>
      <FieldListEditor list={list} setList={setList} languages={languages} disabled={disabled} />
      <div className="help">{tr('ui.settings.removing_a_field_keeps')}</div>
    </div>
  );
}

/** A list of fields (or a form's questions): name, kind, needed, shown in the app, hint, names in other languages, choices. */
export function FieldListEditor({ list, setList, languages, disabled, inApp = true, max = 30 }: { list: FieldDef[]; setList: (next: FieldDef[]) => void; languages: string[]; disabled: boolean; inApp?: boolean; max?: number }) {
  const put = (i: number, patch: Partial<FieldDef>) => setList(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => {
    let n = list.length + 1;
    while (list.some((f) => f.key === `field_${n}`)) n++;
    setList([...list, { key: `field_${n}`, label: tr('ui.settings.new_field'), kind: 'text' }]);
  };
  return (
    <div>
      {!list.length && <div className="help">{tr('ui.settings.no_fields_yet')}</div>}
      {list.map((f, i) => (
        <div key={f.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.field_name')} value={f.label} maxLength={40} disabled={disabled} onChange={(v) => put(i, { label: v })} /></div>
            <div style={{ width: 180 }}><SelectField label={tr('ui.settings.field_kind')} value={f.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as FieldKind, options: k === 'choice' || k === 'multi' ? f.options ?? [{ key: 'one', name: tr('ui.settings.first_choice') }] : undefined })} options={FIELD_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></div>
            <button type="button" className="btn sm" disabled={disabled} onClick={() => setList(list.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          <div className="tgrow" style={{ marginTop: 8 }}>
            <Checkbox checked={!!f.required} disabled={disabled} label={tr('ui.settings.needed')} onChange={(on) => put(i, { required: on || undefined })} />
            {inApp && <Checkbox checked={!!f.app} disabled={disabled} label={tr('ui.settings.shown_in_the_app')} onChange={(on) => put(i, { app: on || undefined })} />}
          </div>
          <div style={{ marginTop: 6 }}><Field label={tr('ui.settings.field_hint')} value={f.hint ?? ''} maxLength={120} disabled={disabled} onChange={(v) => put(i, { hint: v || undefined })} /></div>
          {languages.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
            <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={f.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
              const names = { ...f.names, [l]: v };
              if (!v) delete names[l];
              put(i, { names: Object.keys(names).length ? names : undefined });
            }} /></div>
          ))}</div>}
          {(f.kind === 'choice' || f.kind === 'multi') && <div style={{ marginTop: 8 }}><div className="help" style={{ margin: 0 }}><b>{tr('ui.settings.choices')}</b></div><ListItemsEditor value={f.options ?? []} languages={languages} max={40} disabled={disabled} onChange={(o) => put(i, { options: o as ListItem[] })} /></div>}
        </div>
      ))}
      {list.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={add}>{tr('ui.settings.add_a_field')}</button>}
    </div>
  );
}

/** The school's steps for each kind of request (§3.6.1): in order, who takes each, above which amount, and what a long wait does. */
function WorkflowsEditor({ value, languages, roles, staff, disabled, onChange }: {
  value: WorkflowsSetting; languages: string[]; roles: { key: string; name: string }[]; staff: { id: string; name: string }[]; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const [kind, setKind] = useState<WorkflowProcess>('leave');
  const own = value[kind];
  const steps = own?.length ? own : [DEFAULT_STEP];
  const setSteps = (next: StepDef[]) => onChange({ ...value, [kind]: next.length === 1 && next[0]!.who === 'permission' && next[0]!.above === undefined && !next[0]!.days && next[0]!.key === 'decide' ? undefined : next });
  const put = (i: number, patch: Partial<StepDef>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const next = [...steps]; [next[i], next[i + d]] = [next[i + d]!, next[i]!]; setSteps(next); };
  const add = () => {
    let n = steps.length + 1;
    while (steps.some((s) => s.key === `step-${n}`)) n++;
    setSteps([...steps, { key: `step-${n}`, name: tr('ui.settings.new_step'), who: 'permission' }]);
  };
  return (
    <div>
      <div style={{ maxWidth: 320 }}><Select value={kind} onChange={(k) => setKind(k as WorkflowProcess)} aria-label={tr('ui.settings.kind_of_request')} options={WORKFLOW_PROCESSES.map((p) => ({ value: p, label: PROCESS_LABELS[p] }))} /></div>
      {steps.map((s, i) => (
        <div key={s.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <span className="chip" style={{ marginBottom: 10 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.step')} value={s.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
            <div style={{ width: 230 }}><SelectField label={tr('ui.settings.who_takes_it')} value={s.who} disabled={disabled} onChange={(w) => put(i, { who: w as StepDef['who'], ref: undefined })} options={STEP_ACTORS.map((a) => ({ value: a, label: STEP_ACTOR_LABELS[a] }))} /></div>
            {s.who === 'role' && <div style={{ width: 200 }}><SelectField label={tr('ui.settings.role')} value={s.ref ?? ''} disabled={disabled} onChange={(r) => put(i, { ref: r })} options={[{ value: '', label: tr('ui.settings.choose') }, ...roles.map((r) => ({ value: r.key, label: r.name }))]} /></div>}
            {s.who === 'person' && <div style={{ width: 200 }}><SelectField label={tr('ui.settings.person')} value={s.ref ?? ''} disabled={disabled} onChange={(r) => put(i, { ref: r })} options={[{ value: '', label: tr('ui.settings.choose') }, ...staff.map((p) => ({ value: p.id, label: p.name }))]} /></div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
            {(kind === 'fee_waiver' || kind === 'receipt_cancel') && <div style={{ width: 200 }}><NumberField label={tr('ui.settings.only_above_amount')} min={0} value={s.above === undefined ? '' : String(s.above)} disabled={disabled} onChange={(v) => put(i, { above: v === '' ? undefined : Math.round(Number(v)) })} /></div>}
            <div style={{ width: 160 }}><NumberField label={tr('ui.settings.days_to_answer')} min={1} max={60} value={s.days === undefined ? '' : String(s.days)} disabled={disabled} onChange={(v) => put(i, { days: v === '' ? undefined : Number(v), then: v === '' ? undefined : s.then ?? 'remind' })} /></div>
            {s.days !== undefined && <div style={{ width: 260 }}><SelectField label={tr('ui.settings.then')} value={s.then ?? 'remind'} disabled={disabled} onChange={(v) => put(i, { then: v as StepDef['then'] })} options={STEP_TIMEOUTS.map((x) => ({ value: x, label: STEP_TIMEOUT_LABELS[x] }))} /></div>}
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_up')} disabled={disabled || i === 0} onClick={() => move(i, -1)}><Icon name="caretUp" /></button>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_down')} disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)}><Icon name="caretDown" /></button>
            <button type="button" className="btn sm" disabled={disabled || steps.length <= 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          {languages.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
            <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={s.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
              const names = { ...s.names, [l]: v };
              if (!v) delete names[l];
              put(i, { names: Object.keys(names).length ? names : undefined });
            }} /></div>
          ))}</div>}
        </div>
      ))}
      {steps.length < 6 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={add}>{tr('ui.settings.add_a_step')}</button>}
      <div className="help">{tr('ui.settings.steps_help')}</div>
    </div>
  );
}

/** The school's other grading schemes (§3.6.6): what each grades, for which year groups and subjects, and its pass mark. */
function GradingSchemesEditor({ value, subjects, disabled, onChange }: { value: GradingScheme[]; subjects: { id: string; name: string }[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<GradingScheme>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const years = (s: GradingScheme) => (s.grades ?? []).join(', ');
  return (
    <div>
      {!value.length && <div className="help" style={{ margin: 0 }}>{tr('ui.settings.no_other_schemes')}</div>}
      {value.map((s, i) => (
        <div key={s.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.scheme')} value={s.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
            <div style={{ width: 220 }}><SelectField label={tr('ui.settings.grades_by')} value={s.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as GradingScheme['kind'], ...(k === 'rubric' && !s.criteria?.length ? { criteria: ['a', 'b', 'c', 'd'].map((x) => ({ key: x, name: tr('ui.settings.criterion_n', { n: x.toUpperCase() }), max: 8 })) } : {}) })} options={SCHEME_KINDS.map((k) => ({ value: k, label: SCHEME_KIND_LABELS[k] }))} /></div>
            <div style={{ width: 130 }}><NumberField label={tr('ui.settings.pass_mark')} min={0} max={100} value={String(s.passPct)} disabled={disabled} onChange={(v) => put(i, { passPct: v === '' ? 0 : Number(v) })} /></div>
            <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          <div style={{ marginTop: 6, maxWidth: 320 }}><Field label={tr('ui.settings.year_groups')} value={years(s)} disabled={disabled} hint={tr('ui.settings.year_groups_hint')}
            onChange={(v) => { const g = v.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n)); put(i, { grades: g.length ? g : undefined }); }} /></div>
          {subjects.length > 0 && <div className="fld" role="group" aria-label={tr('ui.settings.subjects')} style={{ marginTop: 6 }}>
            <label>{tr('ui.settings.subjects')}</label>
            <div className="tgrow">{subjects.map((sub) => {
              const on = !!s.subjects?.includes(sub.id);
              return <button key={sub.id} type="button" className={`chip ${on ? 'v' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => { const next = on ? (s.subjects ?? []).filter((x) => x !== sub.id) : [...(s.subjects ?? []), sub.id]; put(i, { subjects: next.length ? next : undefined }); }}>{sub.name}</button>;
            })}</div>
          </div>}
          {s.kind === 'rubric' && <div className="fld" style={{ marginTop: 8 }}>
            <label>{tr('ui.settings.criteria')}</label>
            {(s.criteria ?? []).map((c, ci) => (
              <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
                <div style={{ flex: 1, minWidth: 180 }}><Field label={tr('ui.settings.criterion')} value={c.name} maxLength={60} disabled={disabled} onChange={(v) => put(i, { criteria: s.criteria!.map((x, j) => (j === ci ? { ...x, name: v } : x)) })} /></div>
                <div style={{ width: 120 }}><NumberField label={tr('ui.settings.top_level')} min={1} max={100} value={String(c.max)} disabled={disabled} onChange={(v) => put(i, { criteria: s.criteria!.map((x, j) => (j === ci ? { ...x, max: Math.max(1, Math.min(100, Number(v) || 1)) } : x)) })} /></div>
                <button type="button" className="btn sm" style={{ marginBottom: 6 }} disabled={disabled || s.criteria!.length <= 1} onClick={() => put(i, { criteria: s.criteria!.filter((_, j) => j !== ci) })}>{tr('ui.settings.remove')}</button>
              </div>
            ))}
            {(s.criteria?.length ?? 0) < 12 && <button type="button" className="btn sm" style={{ marginTop: 6 }} disabled={disabled} onClick={() => {
              let n = (s.criteria?.length ?? 0) + 1;
              while (s.criteria?.some((c) => c.key === `c${n}`)) n++;
              put(i, { criteria: [...(s.criteria ?? []), { key: `c${n}`, name: tr('ui.settings.criterion_n', { n }), max: 8 }] });
            }}>{tr('ui.settings.add_a_criterion')}</button>}
            <div className="help">{tr('ui.settings.rubric_help')}</div>
          </div>}
          {s.kind !== 'passfail' && <div style={{ marginTop: 8 }}><GradingEditor value={s.bands} max={15} disabled={disabled} points={s.kind === 'points'} onChange={(b) => put(i, { bands: b as GradeBand[] })} /></div>}
        </div>
      ))}
      {value.length < 12 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        let n = value.length + 1;
        while (value.some((s) => s.key === `scheme-${n}`)) n++;
        onChange([...value, { key: `scheme-${n}`, name: tr('ui.settings.new_scheme'), kind: 'bands', passPct: 40, bands: [{ grade: 'A', minPct: 80 }, { grade: 'B', minPct: 60 }, { grade: 'C', minPct: 40 }, { grade: 'D', minPct: 0 }] }]);
      }}>{tr('ui.settings.add_a_scheme')}</button>}
    </div>
  );
}

/**
 * The layout and wording of the school's printed documents (§3.6.2): blocks in order, each with its words (in the school's
 * other languages too) and {placeholders} the document fills; a preview prints it with the school's own data.
 */
/** Adds a reminder day: so many days before or after the due date, or on it. */
function ReminderDayAdd({ disabled, onAdd }: { disabled: boolean; onAdd: (d: number) => void }) {
  const [n, setN] = useState('3');
  const [when, setWhen] = useState('before');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
      <div style={{ width: 110 }}><NumberField label={tr('ui.settings.days')} min={0} max={120} value={n} disabled={disabled} onChange={setN} /></div>
      <div style={{ width: 180 }}><SelectField label={tr('ui.settings.when')} value={when} disabled={disabled} onChange={setWhen} options={[{ value: 'before', label: tr('ui.settings.before_the_due_date') }, { value: 'after', label: tr('ui.settings.after_the_due_date') }]} /></div>
      <button type="button" className="btn sm" disabled={disabled} onClick={() => onAdd((when === 'before' ? -1 : 1) * Math.min(when === 'before' ? 60 : 120, Number(n) || 0))}>{tr('ui.settings.add')}</button>
    </div>
  );
}

/** Names typed with commas between them: kept as typed while typing, split into the list when the field is left. */
function CommaList({ label, hint, value, max, disabled, onChange }: { label: string; hint?: string; value: string[]; max: number; disabled: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const done = () => { const list = [...new Set(text.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, max); setText(list.join(', ')); onChange(list); };
  return <Field label={label} hint={hint} value={text} disabled={disabled} onChange={setText} onBlur={done} />;
}

/** The school's admission stages (§4.2): in order, each with what it needs. Enquiry, Enrolled and Declined are always there. */
function AdmissionStagesEditor({ value, languages, disabled, onChange }: { value: AdmissionStage[]; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<AdmissionStage>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const next = [...value]; [next[i], next[i + d]] = [next[i + d]!, next[i]!]; onChange(next); };
  // A new stage's key comes from its place in the list; the name is the school's to change any time.
  const add = () => {
    let n = value.length + 1;
    while (value.some((s) => s.key === `stage-${n}`)) n++;
    onChange([...value, { key: `stage-${n}`, name: tr('ui.settings.new_stage'), hint: '', needsDate: false, scored: false, documents: [], tellFamily: false }]);
  };
  return (
    <div>
      <div className="help" style={{ marginTop: 0 }}>{tr('ui.settings.stages_fixed')}</div>
      {value.map((s, i) => (
        <div key={s.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <span className="chip" style={{ marginBottom: 10 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.stage')} value={s.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
            <div style={{ flex: 2, minWidth: 200 }}><Field label={tr('ui.settings.stage_hint')} value={s.hint} maxLength={80} disabled={disabled} onChange={(v) => put(i, { hint: v })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <Checkbox checked={s.needsDate} disabled={disabled} label={tr('ui.settings.stage_on_a_day')} onChange={(on) => put(i, { needsDate: on })} />
            <Checkbox checked={s.scored} disabled={disabled} label={tr('ui.settings.stage_scored')} onChange={(on) => put(i, { scored: on })} />
            <Checkbox checked={s.tellFamily} disabled={disabled} label={tr('ui.settings.stage_tells_family')} onChange={(on) => put(i, { tellFamily: on })} />
            <span className="grow"></span>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_up')} disabled={disabled || i === 0} onClick={() => move(i, -1)}><Icon name="caretUp" /></button>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_down')} disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}><Icon name="caretDown" /></button>
            <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          <div style={{ marginTop: 6 }}><CommaList label={tr('ui.settings.stage_documents')} value={s.documents} disabled={disabled} hint={tr('ui.settings.stage_documents_hint')} max={12}
            onChange={(documents) => put(i, { documents })} /></div>
          {languages.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
            <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={s.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
              const names = { ...s.names, [l]: v };
              if (!v) delete names[l];
              put(i, { names: Object.keys(names).length ? names : undefined });
            }} /></div>
          ))}</div>}
        </div>
      ))}
      {value.length < 10 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={add}>{tr('ui.settings.add_a_stage')}</button>}
    </div>
  );
}

function DocumentTemplatesEditor({ value, languages, preview, disabled, onChange }: {
  value: DocTemplates; languages: string[]; preview?: (kind: DocKind, template: DocTemplate) => Promise<Blob>; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const [kind, setKind] = useState<DocKind>('receipt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tpl = value[kind] ?? DEFAULT_TEMPLATES[kind];
  const own = !!value[kind];
  const setTpl = (next: DocTemplate | undefined) => onChange({ ...value, [kind]: next });
  const blocks = tpl.blocks;
  const put = (i: number, patch: Partial<Block>) => setTpl({ ...tpl, blocks: blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const move = (i: number, d: number) => { const next = [...blocks]; [next[i], next[i + d]] = [next[i + d]!, next[i]!]; setTpl({ ...tpl, blocks: next }); };
  const show = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try { window.open(URL.createObjectURL(await preview(kind, tpl)), '_blank', 'noopener'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const words = (b: Block, field: 'text' | 'value') => languages.length > 0 && (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
      <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={b.names?.[l]?.[field] ?? ''} maxLength={field === 'text' ? 2000 : 400} disabled={disabled} onChange={(v) => {
        const names = { ...b.names, [l]: { ...b.names?.[l], [field]: v || undefined } };
        put(blocks.indexOf(b), { names });
      }} /></div>
    ))}</div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 220 }}><Select value={kind} onChange={(k) => setKind(k as DocKind)} aria-label={tr('ui.settings.document')} options={DOC_KINDS.map((k) => ({ value: k, label: DOC_KIND_LABELS[k] }))} /></div>
        <div style={{ width: 140 }}><Select value={tpl.size} disabled={disabled} onChange={(s) => setTpl({ ...tpl, size: s as DocTemplate['size'] })} aria-label={tr('ui.settings.page_size')} options={PAGE_SIZES.map((s) => ({ value: s, label: s }))} /></div>
        {preview && <button type="button" className="btn sm" disabled={busy} onClick={() => void show()}><Icon name="print" />{tr('ui.settings.preview')}</button>}
        {own && <button type="button" className="btn sm" disabled={disabled} onClick={() => setTpl(undefined)}>{tr('ui.settings.back_to_tangent_s_layout')}</button>}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="help">{tr('ui.settings.fill_in', { names: DOC_PLACEHOLDERS[kind].map((p) => `{${p}}`).join(' ') })}</div>
      {blocks.map((b, i) => (
        <div key={i} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ width: 320, maxWidth: '100%' }}><SelectField label={tr('ui.settings.block')} value={b.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as Block['kind'] })} options={BLOCK_KINDS.map((k) => ({ value: k, label: BLOCK_KIND_LABELS[k] }))} /></div>
            {['heading', 'text', 'fact', 'signatures'].includes(b.kind) && <>
              <div style={{ width: 110 }}><NumberField label={tr('ui.settings.text_size')} min={7} max={28} value={b.size === undefined ? '' : String(b.size)} disabled={disabled} onChange={(v) => put(i, { size: v === '' ? undefined : Number(v) })} /></div>
              <div style={{ width: 150 }}><SelectField label={tr('ui.settings.align')} value={b.align ?? 'start'} disabled={disabled} onChange={(a) => put(i, { align: a === 'start' ? undefined : (a as Block['align']) })}
                options={[{ value: 'start', label: tr('ui.settings.align_start') }, { value: 'center', label: tr('ui.settings.align_center') }, { value: 'end', label: tr('ui.settings.align_end') }]} /></div>
              <div style={{ paddingBottom: 10 }}><Checkbox checked={!!b.bold} disabled={disabled} label={tr('ui.settings.bold')} onChange={(on) => put(i, { bold: on || undefined })} /></div>
            </>}
            <div style={{ width: 170 }}><SelectField label={tr('ui.settings.only_when')} value={b.when ?? ''} disabled={disabled} onChange={(w) => put(i, { when: w || undefined })}
              options={[{ value: '', label: tr('ui.settings.always') }, ...DOC_PLACEHOLDERS[kind].map((p) => ({ value: p, label: `{${p}}` }))]} /></div>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_up')} disabled={disabled || i === 0} onClick={() => move(i, -1)}><Icon name="caretUp" /></button>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_down')} disabled={disabled || i === blocks.length - 1} onClick={() => move(i, 1)}><Icon name="caretDown" /></button>
            <button type="button" className="btn sm" disabled={disabled || blocks.length <= 1} onClick={() => setTpl({ ...tpl, blocks: blocks.filter((_, j) => j !== i) })}>{tr('ui.settings.remove')}</button>
          </div>
          {['heading', 'text', 'fact'].includes(b.kind) && <div style={{ marginTop: 6 }}><Field label={b.kind === 'fact' ? tr('ui.settings.label') : tr('ui.settings.words')} value={b.text ?? ''} maxLength={2000} disabled={disabled} onChange={(v) => put(i, { text: v })} /></div>}
          {['heading', 'text', 'fact'].includes(b.kind) && words(b, 'text')}
          {b.kind === 'fact' && <div style={{ marginTop: 6 }}><Field label={tr('ui.settings.value_at_the_end')} value={b.value ?? ''} maxLength={400} disabled={disabled} onChange={(v) => put(i, { value: v })} /></div>}
          {b.kind === 'signatures' && <div style={{ marginTop: 6 }}><div className="fld"><label>{tr('ui.settings.who_signs')}</label>
            <textarea style={ta} value={b.value ?? ''} disabled={disabled} maxLength={400} onChange={(e) => put(i, { value: e.target.value })} aria-label={tr('ui.settings.who_signs')} /></div></div>}
          {(b.kind === 'fact' || b.kind === 'signatures') && words(b, 'value')}
        </div>
      ))}
      {blocks.length < 60 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => setTpl({ ...tpl, blocks: [...blocks, { kind: 'text', text: '' }] })}>{tr('ui.settings.add_a_block')}</button>}
    </div>
  );
}

function PaymentMethodsEditor({ value, max, disabled, onChange }: { value: PaymentMethod[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<PaymentMethod>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const keyOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'method';
  return (
    <div>
      {value.map((m, i) => (
        <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.method')} value={m.name} maxLength={30} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 180 }}><SelectField label={tr('ui.settings.kind_of_money')} value={m.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as PaymentMethod['kind'] })} options={PAYMENT_KINDS.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        const name = tr('ui.settings.new_method');
        let key = keyOf(name);
        for (let n = 2; value.some((m) => m.key === key); n++) key = `${keyOf(name)}-${n}`;
        onChange([...value, { key, name, kind: 'other' }]);
      }}>{tr('ui.settings.add_a_method')}</button>}
      <div className="help">{tr('ui.settings.a_method_keeps_its_key')}</div>
    </div>
  );
}

/** The school's wording of each message, per language it offers; empty keeps the usual wording (translated for each reader). */
function TemplatesEditor({ value, school, languages, disabled, onChange }: { value: Record<string, string | Record<string, string>>; school: string; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [lang, setLang] = useState(school);
  const textOf = (k: string) => { const c = value[k]; return typeof c === 'string' ? (lang === school ? c : '') : c?.[lang] ?? ''; };
  const put = (k: string, text: string) => {
    const c = value[k];
    const own = { ...(typeof c === 'string' ? (c.trim() ? { [school]: c } : {}) : c ?? {}), [lang]: text };
    if (!text.trim()) delete own[lang];
    const next = { ...value, [k]: own };
    if (!Object.keys(own).length) delete next[k];
    onChange(next);
  };
  return (
    <div>
      {languages.length > 1 && <div style={{ maxWidth: 260 }}><SelectField label={tr('ui.settings.language')} value={lang} onChange={setLang} options={languages.map((l) => ({ value: l, label: languageLabel(l) }))} /></div>}
      {MESSAGE_EVENTS.map((e) => (
        <div key={e.key} style={{ marginTop: 10 }}>
          <div className="help" style={{ margin: '0 0 4px' }}><b>{e.label}</b> {tr('ui.settings.placeholders')}{' '}{e.vars.map((x) => `{${x}}`).join(' ')}</div>
          <div className="inp" style={{ height: 'auto' }}><textarea value={textOf(e.key)} placeholder={tx(rawOf(e).text)} maxLength={320} disabled={disabled} aria-label={tr('ui.settings.wording', { label: e.label })} style={{ ...ta, minHeight: 56 }}
            onChange={(x) => put(e.key, x.target.value)} /></div>
        </div>
      ))}
    </div>
  );
}

/** The school's words, per language it uses: one and many, the usual word showing until it is changed. */
function VocabularyEditor({ value, languages, disabled, onChange }: { value: Vocabulary; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [lang, setLang] = useState(languages[0] ?? 'en');
  const own = value[lang] ?? {};
  const usual = wordsFor(lang, undefined);
  const put = (concept: VocabConcept, part: 'one' | 'many', text: string) => {
    const word = { ...own[concept], [part]: text } as Word;
    const words = { ...own, [concept]: word };
    if (!word.one?.trim() && !word.many?.trim()) delete words[concept];
    const next = { ...value, [lang]: words };
    if (!Object.keys(words).length) delete next[lang];
    onChange(next);
  };
  return (
    <div>
      {languages.length > 1 && <div style={{ maxWidth: 260 }}><SelectField label={tr('ui.settings.language')} value={lang} onChange={setLang} options={languages.map((l) => ({ value: l, label: languageLabel(l) }))} /></div>}
      {VOCAB_CONCEPTS.map((c) => (
        <div key={c.key} style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.for', { p0: usual[c.key] })} value={own[c.key]?.one ?? ''} placeholder={usual[c.key]} maxLength={30} disabled={disabled} onChange={(x) => put(c.key, 'one', x)} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.more_than_one')} value={own[c.key]?.many ?? ''} placeholder={own[c.key]?.one ? '' : usual[c.many]} maxLength={30} disabled={disabled} onChange={(x) => put(c.key, 'many', x)} /></div>
        </div>
      ))}
    </div>
  );
}

/** The marks a register uses: what it is called, the letter written for it, and what it means for attendance figures. */
function AttendanceMarksEditor({ value, max, disabled, onChange }: { value: AttendanceMarkDef[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<AttendanceMarkDef>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div>
      {value.map((m, i) => (
        <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.mark')} value={m.name} maxLength={30} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 90 }}><Field label={tr('ui.settings.letter')} value={m.code} maxLength={3} disabled={disabled} onChange={(v) => put(i, { code: v })} /></div>
          <div style={{ width: 200 }}><SelectField label={tr('ui.settings.means')} value={m.meaning} disabled={disabled} onChange={(k) => put(i, { meaning: k as AttendanceMarkDef['meaning'] })} options={ATTENDANCE_MARKS.map((k) => ({ value: k, label: MARK_MEANING_LABELS[k] }))} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 2} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        let n = value.length + 1;
        while (value.some((m) => m.key === `mark-${n}`)) n++;
        onChange([...value, { key: `mark-${n}`, name: tr('ui.settings.new_mark'), meaning: 'leave', code: '' }]);
      }}>{tr('ui.settings.add_a_mark')}</button>}
      <div className="help">{tr('ui.settings.a_mark_keeps_its_key')}</div>
    </div>
  );
}
