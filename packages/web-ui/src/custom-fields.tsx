import { customText, listLabel, listOptions, type CustomValue, type CustomValues, type FieldDef } from '@tangent/contracts';
import { Checkbox, DateField, NumberField } from './fields';
import { Field, SelectField } from './forms';
import { currentLanguage, t as tr } from './i18n';

const labelOf = (f: FieldDef) => f.names?.[currentLanguage()] || f.label;

/**
 * The school's own fields on a form (§3.6.3), each drawn by its kind. Values go back as they are typed; the server checks and
 * keeps them. `errors` are the server's, keyed `custom.<key>`.
 */
export function CustomFieldInputs({ defs, values, onChange, errors = {}, disabled }: {
  defs: readonly FieldDef[]; values: CustomValues; onChange: (v: CustomValues) => void; errors?: Record<string, string>; disabled?: boolean;
}) {
  if (!defs.length) return null;
  const set = (k: string, v: CustomValue) => onChange({ ...values, [k]: v });
  return (
    <div className="two" style={{ flexWrap: 'wrap' }}>
      {defs.map((f) => {
        const label = f.required ? labelOf(f) : tr('ui.custom_fields.optional', { label: labelOf(f) });
        const v = values[f.key];
        const error = errors[`custom.${f.key}`];
        const common = { label, error, disabled, hint: f.hint };
        switch (f.kind) {
          case 'number':
            return <NumberField key={f.key} {...common} decimals value={v === null || v === undefined ? '' : String(v)} onChange={(x) => set(f.key, x === '' ? null : Number(x))} />;
          case 'date':
            return <DateField key={f.key} {...common} value={typeof v === 'string' ? v : ''} onChange={(x) => set(f.key, x || null)} />;
          case 'yesno':
            return <div key={f.key} className="fld" style={{ justifyContent: 'flex-end' }}><Checkbox checked={v === true} disabled={disabled} label={label} onChange={(x) => set(f.key, x)} />{error && <div className="emsg">{error}</div>}</div>;
          case 'choice':
            return <SelectField key={f.key} label={label} error={error} disabled={disabled} value={typeof v === 'string' ? v : ''} onChange={(x) => set(f.key, x || null)}
              options={[{ value: '', label: tr('ui.custom_fields.not_given') }, ...listOptions(f.options, typeof v === 'string' ? v : null).map((o) => ({ value: o.key, label: listLabel([o], o.key, currentLanguage()) }))]} />;
          case 'multi': {
            const on = Array.isArray(v) ? v : [];
            return (
              <div key={f.key} className="fld" role="group" aria-label={label}>
                <label>{label}</label>
                <div className="tgrow">{listOptions(f.options, null).map((o) => {
                  const picked = on.includes(o.key);
                  return <button key={o.key} type="button" className={`chip ${picked ? 'v' : ''}`} aria-pressed={picked} disabled={disabled} onClick={() => set(f.key, picked ? on.filter((x) => x !== o.key) : [...on, o.key])}>{listLabel([o], o.key, currentLanguage())}</button>;
                })}</div>
                {error && <div className="emsg">{error}</div>}
              </div>
            );
          }
          default:
            return <Field key={f.key} {...common} type={f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : 'text'} maxLength={f.kind === 'longText' ? 2000 : 200} value={typeof v === 'string' ? v : ''} onChange={(x) => set(f.key, x)} />;
        }
      })}
    </div>
  );
}

/** A record's custom values as lines to read (only the fields that have a value). */
export function customLines(defs: readonly FieldDef[], values: CustomValues | undefined): { label: string; text: string }[] {
  return defs.map((f) => ({ label: labelOf(f), text: customText(f, values?.[f.key], currentLanguage()) })).filter((l) => l.text);
}
