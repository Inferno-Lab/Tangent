import { fmtDate, fmtMoney, fmtNumber, setLocaleSource, setZoneSource, type SchoolRow } from '@tangent/contracts';

// The console is read by Tangent's own people: dates and numbers their browser's way, prices in rupees (Tangent bills in
// rupees today; docs/one-shot-plan.md D13). A school's own amounts are written in its currency where they are shown.
const reader = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: typeof navigator === 'undefined' ? 'en' : navigator.language, currency: 'INR' };
setZoneSource(() => reader.zone);
setLocaleSource(() => reader);

export type Tone = 'g' | 'a' | 'v' | 'c' | 'n';

/** The one status pill a school wears in every table: setup state first, then how it is doing. */
export function statusOf(s: Pick<SchoolRow, 'status' | 'health'>): { text: string; tone: Tone } {
  if (s.status === 'onboarding') return { text: 'Setting up', tone: 'v' };
  if (s.status === 'suspended') return { text: 'Suspended', tone: 'c' };
  if (s.status === 'moving') return { text: 'Moving', tone: 'v' };
  if (s.status === 'offboarding') return { text: 'Leaving', tone: 'a' };
  if (s.status === 'archived') return { text: 'Archived', tone: 'n' };
  if (s.health === 'ok') return { text: 'Healthy', tone: 'g' };
  if (s.health === 'degraded') return { text: 'Degraded', tone: 'a' };
  if (s.health === 'down') return { text: 'Down', tone: 'c' };
  return { text: 'Not checked yet', tone: 'n' };
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
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
    if (!i) return `M${p[0]} ${p[1]}`;
    const q = pts[i - 1]!;
    const c = (q[0] + p[0]) / 2;
    return `C${c} ${q[1]},${c} ${p[1]},${p[0]} ${p[1]}`;
  }).join(' ');
  return close ? `${d} L600 240 L0 240 Z` : d;
}
