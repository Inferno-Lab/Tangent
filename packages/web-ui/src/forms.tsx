import type { IconName } from './Icon';
import { Icon } from './Icon';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Select } from './Select';
import { toE164 } from '@tangent/contracts';
import { t as tr } from './i18n';

/** A counter that flips between two classes, so the same error can vibrate again each time it is hit. */
export function useShake(): { cls: string; hit: () => void } {
  const [n, setN] = useState(0);
  return { cls: n ? `shk${n}` : '', hit: () => setN((x) => (x === 1 ? 2 : 1)) };
}

const WARN = 'warning';

export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div className="emsg" role="alert">
      <Icon name={WARN} />
      {children}
    </div>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> {
  /** Text-like only: dates, times, numbers, colours, ticks and files have their own fields (DateField, TimeField…). */
  type?: 'text' | 'email' | 'tel' | 'password' | 'search' | 'url';
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  icon?: IconName;
}

// What an email address looks like to every server it will be sent through: one @, a dot in the domain, no spaces.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * A labelled input. The error turns it red, makes it vibrate, and says what to do. An email field checks itself when the
 * person leaves it, the way the server will.
 */
export function Field({ label, value, onChange, error, hint, icon, onBlur, ...rest }: FieldProps) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const own = rest.type === 'email' && left && value.trim() && !EMAIL.test(value.trim()) ? tr('ui.forms.email_invalid') : '';
  error = error || own || undefined;
  return (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      <div className={`inp ${error ? 'err shake' : ''}`}>
        {icon && <Icon name={icon} />}
        <input id={id} value={value} onChange={(e) => { setLeft(false); onChange(e.target.value); }} onBlur={(e) => { setLeft(true); onBlur?.(e); }} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-m` : undefined} {...rest} />
      </div>
      {error ? <div id={`${id}-m`}><ErrorLine>{error}</ErrorLine></div> : hint ? <div id={`${id}-m`} className="help">{hint}</div> : null}
    </div>
  );
}

/**
 * A phone number, checked when the person leaves the field the way the server checks it: a local number in the school's
 * `country`, or any number written with its country code. The hint shows the form it is saved in.
 */
export function PhoneField({ country, value, onChange, error, hint, ...rest }: Omit<FieldProps, 'type'> & { country: string }) {
  const [left, setLeft] = useState(false);
  const typed = value.trim();
  const e164 = typed ? toE164(typed, country) : null;
  const own = left && typed && !e164 ? (country ? tr('ui.forms.phone_invalid') : tr('ui.forms.phone_needs_code')) : '';
  return (
    <Field type="tel" inputMode="tel" autoComplete="tel" maxLength={24} value={value} onBlur={() => setLeft(true)}
      onChange={(v) => { setLeft(false); onChange(v); }} error={error || own || undefined}
      hint={e164 && e164 !== typed.replace(/[\s()-]/g, '') ? tr('ui.forms.phone_saved_as', { n: e164 }) : hint} {...rest} />
  );
}

interface SelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  disabled?: boolean;
  /** As wide as its longest choice, so no choice is cut and rows of the same choices line up (in any language). */
  fit?: boolean;
}

export function SelectField({ label, value, onChange, options, error, disabled, fit }: SelectProps) {
  const id = useId();
  // ch is a little wider than an average letter, so the longest label fits beside the chevron; on a narrow screen the box
  // still shrinks to its row (the width is wanted, not forced).
  const longest = fit ? Math.max(0, ...options.map((o) => o.label.length)) : 0;
  return (
    <div className="fld" style={fit ? { width: `max(140px, calc(${longest}ch + 64px))`, maxWidth: '100%' } : undefined}>
      <label htmlFor={id}>{label}</label>
      <Select id={id} value={value} onChange={onChange} options={options} invalid={!!error} disabled={disabled} className={error ? 'shake' : ''} />
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}

/** A multi-line input in the same box as Field: notes, reasons, answers. */
export function AreaField({ label, value, onChange, error, hint, rows = 4, ...rest }: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; rows?: number; maxLength?: number; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      <div className={`inp ${error ? 'err shake' : ''}`} style={{ height: 'auto', alignItems: 'stretch' }}>
        <textarea id={id} className="ta" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} style={{ padding: '12px 0', resize: 'vertical', width: '100%', font: '400 15px/1.5 var(--fb)' }} {...rest} />
      </div>
      {error ? <div className="emsg" role="alert">{error}</div> : hint ? <div className="help">{hint}</div> : null}
    </div>
  );
}
