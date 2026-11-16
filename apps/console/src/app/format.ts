import { fmtDate, fmtMoney, fmtNumber, setLocaleSource, setZoneSource, type SchoolRow } from '@tangent/contracts';
import { t } from '@tangent/web-ui';

// The console is read by Tangent's own people: dates and numbers their browser's way, prices in rupees (Tangent bills in
// rupees today; docs/one-shot-plan.md D13). A school's own amounts are written in its currency where they are shown.
const reader = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: typeof navigator === 'undefined' ? 'en' : navigator.language, currency: 'INR' };
setZoneSource(() => reader.zone);
setLocaleSource(() => reader);

export type Tone = 'g' | 'a' | 'v' | 'c' | 'n';

/** The one status pill a school wears in every table: setup state first, then how it is doing. */
export function statusOf(s: Pick<SchoolRow, 'status' | 'health'>): { text: string; tone: Tone } {
  if (s.status === 'onboarding') return { text: t('console.format.setting_up'), tone: 'v' };
  if (s.status === 'suspended') return { text: t('console.format.suspended'), tone: 'c' };
  if (s.status === 'moving') return { text: t('console.format.moving'), tone: 'v' };
  if (s.status === 'offboarding') return { text: t('console.format.leaving'), tone: 'a' };
  if (s.status === 'archived') return { text: t('console.format.archived'), tone: 'n' };
  if (s.health === 'ok') return { text: t('console.format.healthy'), tone: 'g' };
  if (s.health === 'degraded') return { text: t('console.format.degraded'), tone: 'a' };
  if (s.health === 'down') return { text: t('console.format.down'), tone: 'c' };
  return { text: t('console.format.not_checked_yet'), tone: 'n' };
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return t('console.format.just_now');
  if (s < 3600) return t('console.format.min_ago', { p0: Math.round(s / 60) });
  if (s < 86400) return t('console.format.h_ago', { p0: Math.round(s / 3600) });
  return t('console.format.d_ago', { p0: Math.round(s / 86400) });
}

export const when = (iso: string | null | undefined) => (iso ? fmtDate(iso, 'stamp') : '–');

export const rupees = (n: number) => fmtMoney(Math.round(n), 'INR');
export const count = (n: number) => fmtNumber(n);

/** A smooth line through hourly values, in the 600 by 240 box the chart draws in. */
export function curve(values: number[], max: number, close = false): string {
  if (!values.length) return '';
  const step = values.length > 1 ? 600 / (values.length - 1) : 0;
  const pts = values.map((v, i) => [i * step, 228 - (max ? (v / max) * 190 : 0)] as const);
  const d = pts.map((p, i) => {
    if (!i) return t('console.format.m', { p0: p[0], p1: p[1] });
    const q = pts[i - 1]!;
    const c = (q[0] + p[0]) / 2;
    return t('console.format.c', { c, p1: q[1], c2: c, p3: p[1], p4: p[0], p5: p[1] });
  }).join(' ');
  return close ? `${d} L600 240 L0 240 Z` : d;
}
