import { useState, type ReactNode } from 'react';
import { t } from './i18n';

/**
 * A long list the page already holds shows a page of it at a time: the rows to draw, and the "Show more" button that goes
 * under them (null once everything is shown). Lists the server pages use Previous and Next instead.
 */
export function useMore<T>(items: readonly T[], step = 20): [T[], ReactNode] {
  const [n, setN] = useState(step);
  const left = items.length - n;
  const more = left > 0
    ? <button type="button" className="more" onClick={() => setN(n + step)}>{t('ui.more.show')}{' '}{Math.min(step, left)} {t('ui.more.more')}<small>{left} {t('ui.more.not_shown')}</small></button>
    : null;
  return [items.slice(0, n), more];
}
