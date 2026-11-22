import type { CSSProperties } from 'react';
import { t } from './i18n';

/**
 * What is loading, drawn in its own shape so nothing jumps when it arrives: a list's rows, a table, a form's fields, a grid
 * of tiles or a row of cards, in the shimmer of `.skc`.
 */
export function Skeleton({ kind = 'rows', rows = 5, className, style }: { kind?: 'rows' | 'table' | 'form' | 'grid' | 'cards'; rows?: number; className?: string; style?: CSSProperties }) {
  const line = (w: string, h = 12) => <div className="skc" style={{ width: w, height: h, borderRadius: 8 }} />;
  const n = Array.from({ length: rows }, (_, i) => i);
  const body = {
    rows: n.map((i) => (
      <div key={i} className="sk-row">
        <div className="skc" style={{ width: 36, height: 36, borderRadius: 12, flex: 'none' }} />
        <div className="sk-lines">{line(i % 2 ? '52%' : '68%', 14)}{line(i % 2 ? '30%' : '38%')}</div>
        {line('72px', 28)}
      </div>
    )),
    table: [<div key="h" className="sk-row">{line('22%')}{line('18%')}{line('18%')}{line('14%')}</div>, ...n.map((i) => (
      <div key={i} className="sk-row">{line(i % 2 ? '26%' : '30%', 14)}{line('16%', 14)}{line('20%', 14)}{line('10%', 14)}</div>
    ))],
    form: n.map((i) => (
      <div key={i} className="sk-field">{line(i % 2 ? '96px' : '128px')}<div className="skc" style={{ height: 42, borderRadius: 999 }} /></div>
    )),
    grid: <div className="sk-grid">{n.map((i) => <div key={i} className="skc" style={{ aspectRatio: '4 / 3', borderRadius: 16 }} />)}</div>,
    cards: <div className="sk-grid">{n.map((i) => <div key={i} className="skc" style={{ height: 140, borderRadius: 24 }} />)}</div>,
  }[kind];
  return (
    // No card of its own: most sit inside the card their content fills.
    <div className={`sk ${className ?? ''}`} style={style} aria-busy="true" aria-label={t('ui.skeleton.loading')}>
      {body}
    </div>
  );
}
