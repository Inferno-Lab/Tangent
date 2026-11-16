import { useState } from 'react';
import type { ImportKind } from '@tangent/contracts';
import { Select, t } from '@tangent/web-ui';

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * For a school on paper: type a register straight in, and it goes to Tangent's team like a file they sent (the same checks run when
 * the team imports it). Columns that take fixed values are dropdowns.
 */
export function TypeRows({ kind, busy, onSend, onCancel }: { kind: ImportKind; busy: boolean; onSend: (csv: string, count: number) => void; onCancel: () => void }) {
  const blank = () => Object.fromEntries(kind.columns.map((c) => [c.key, ''])) as Record<string, string>;
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, blank));
  const filled = rows.filter((r) => Object.values(r).some((v) => v.trim()));
  const short = kind.columns.filter((c) => c.required && filled.some((r) => !r[c.key]!.trim()));
  const set = (i: number, key: string, value: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const send = () => onSend(`${[kind.columns.map((c) => c.key), ...filled.map((r) => kind.columns.map((c) => r[c.key]!.trim()))].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`, filled.length);
  const grid = { '--cols': `40px ${kind.columns.map(() => 'minmax(130px,1fr)').join(' ')}` } as React.CSSProperties;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="help" style={{ marginTop: 0 }}>{t('admin.type_rows.columns_marked_are_needed_leave')}</div>
      <div className="scroll-x lscroll" style={{ marginTop: 8 }}>
        <div style={{ minWidth: 40 + kind.columns.length * 136 }}>
          <div className="grd th" style={grid}><span>{t('admin.type_rows.row')}</span>{kind.columns.map((c) => <span key={c.key}>{c.label}{c.required ? ' *' : ''}</span>)}</div>
          {rows.map((r, i) => (
            <div key={i} className="grd rw" style={{ ...grid, height: 'auto', padding: '6px 0', gap: 6 }}>
              <span style={{ font: '700 12px var(--fb)', color: 'var(--ink3)' }}>{i + 1}</span>
              {kind.columns.map((c) => (c.options
                ? <Select key={c.key} compact aria-label={t('admin.type_rows.row_2', { p0: i + 1, label: c.label })} value={r[c.key]!} onChange={(v) => set(i, c.key, v)} options={[{ value: '', label: t('admin.type_rows.choose') }, ...c.options.map((o) => ({ value: o, label: o }))]} />
                : <input key={c.key} className={`hws ${c.required && filled.includes(r) && !r[c.key]!.trim() ? 'bad' : ''}`} style={{ width: '100%', textAlign: 'start' }}
                  aria-label={t('admin.type_rows.row_2', { p0: i + 1, label: c.label })} placeholder={c.example} value={r[c.key]!} onChange={(e) => set(i, c.key, e.target.value)} />))}
            </div>
          ))}
        </div>
      </div>
      {short.length > 0 && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{t('admin.type_rows.fill_in')}{' '}{short.map((c) => c.label).join(', ')} {t('admin.type_rows.on_every_row_you_typed')}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => setRows([...rows, ...Array.from({ length: 5 }, blank)])}>{t('admin.type_rows.add_5_rows')}</button>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={onCancel}>{t('admin.type_rows.cancel')}</button>
          <button className="btn pri" disabled={busy || !filled.length || short.length > 0} onClick={send}>{busy ? t('admin.type_rows.sending') : t('admin.type_rows.send_to_tangent', { length: filled.length, p1: filled.length === 1 ? 'row' : 'rows' })}</button>
        </span>
      </div>
    </div>
  );
}
