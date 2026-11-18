/**
 * Calendar files (RFC 5545) a phone opens in its own calendar app: an event a family adds from a notice, an event or a
 * homework, and a week of lessons that repeats until the term ends. Times are the school's own clock (TZID), which every
 * calendar app turns into the phone's.
 */
export interface CalEvent {
  title: string;
  /** An ISO day (all day) or an ISO day and time ('2026-11-20T09:30'), in the school's zone. */
  start: string;
  end?: string;
  details?: string;
  place?: string;
  /** Repeats every week until this ISO day. */
  weeklyUntil?: string;
  /** Reminds this many minutes before. */
  alarmMinutes?: number;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const stamp = (s: string) => s.replace(/[-:]/g, '').replace(/(T\d{4})$/, '$100');
const day = (s: string) => s.slice(0, 10).replace(/-/g, '');
const next = (d: string) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
// Lines are folded at 75 octets, as the format asks; this keeps them short instead (titles and details are trimmed).
const line = (k: string, v: string) => `${k}:${v}`.slice(0, 900);

export function calendarFile(events: CalEvent[], zone: string, uidBase: string): string {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tangent//School//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach((e, i) => {
    const allDay = e.start.length === 10;
    out.push('BEGIN:VEVENT', `UID:${uidBase}-${i}@tangent`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`);
    if (allDay) out.push(`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(next(e.end ?? e.start))}`);
    else out.push(`DTSTART;TZID=${zone}:${stamp(e.start)}`, `DTEND;TZID=${zone}:${stamp(e.end ?? e.start)}`);
    if (e.weeklyUntil) out.push(`RRULE:FREQ=WEEKLY;UNTIL=${day(e.weeklyUntil)}T235959Z`);
    out.push(line('SUMMARY', esc(e.title.slice(0, 200))));
    if (e.details) out.push(line('DESCRIPTION', esc(e.details.slice(0, 600))));
    if (e.place) out.push(line('LOCATION', esc(e.place.slice(0, 120))));
    if (e.alarmMinutes) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', line('DESCRIPTION', esc(e.title.slice(0, 200))), `TRIGGER:-PT${e.alarmMinutes}M`, 'END:VALARM');
    out.push('END:VEVENT');
  });
  out.push('END:VCALENDAR');
  return `${out.join('\r\n')}\r\n`;
}
