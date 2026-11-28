import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast, EmptyState, EmptyNote, Icon, Select, useMore, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page } from '../../app/Page';
import { auditLabel, fmtDate, fmtNumber, initials, schoolToday, addDays, type AuditRow } from '@tangent/contracts';

/** Who changed what at the school, newest first: by day, each change with its person, what it was and when. */
export function AuditPage() {
  const app = useApp();
  const { api } = app;
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['settings-audit'], queryFn: api.settings.audit });
  const all = q.data ?? [];
  const [who, setWho] = useState('');
  const [find, setFind] = useState('');
  const people = useMemo(() => [...new Set(all.map((r) => r.actor))].sort(), [all]);
  const needle = find.trim().toLowerCase();
  const rows = all.filter((r) => (!who || r.actor === who) && (!needle || `${r.actor} ${auditLabel(r.action)} ${r.detail}`.toLowerCase().includes(needle)));
  const [shown, more] = useMore(rows, 40);
  // The day each change was made, on the school's clock: Today, Yesterday, then the date.
  const today = schoolToday();
  const dayOf = (r: AuditRow) => fmtDate(r.at, 'dayYear');
  const heading = (r: AuditRow) => {
    const d = schoolToday(new Date(r.at));
    return d === today ? t('admin.audit_page.today') : d === addDays(today, -1) ? t('admin.audit_page.yesterday') : fmtDate(r.at, 'weekdayLong');
  };
  return (
    <Page title={t('admin.audit_page.audit_log')} sub={t('admin.audit_page.the_latest_changes_made_by')} toast={toast} loading={q.isLoading}
      error={q.isError && !q.data ? { message: (q.error as Error).message, retry: () => void q.refetch() } : null}>
      {!all.length ? (
        <EmptyState scene="audit" onAction={() => app.go('/')} />
      ) : (
        <Card title={t('admin.audit_page.changes')} chip={<span className="chip">{fmtNumber(rows.length)}</span>}>
          <div className="tgrow" style={{ marginBottom: 8 }}>
            <div className="srch" style={{ flex: '1 1 240px', minWidth: 0, height: 42 }}>
              <Icon name="search" />
              <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('admin.audit_page.find_a_change')} aria-label={t('admin.audit_page.find_a_change')}
                style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} />
            </div>
            <Select compact aria-label={t('admin.audit_page.who')} value={who} onChange={setWho} options={[{ value: '', label: t('admin.audit_page.everyone') }, ...people.map((p) => ({ value: p, label: p }))]} />
          </div>
          {!rows.length && <EmptyNote icon="search" title={t('admin.audit_page.no_change_matches')} body={t('admin.audit_page.try_another_word')} />}
          {shown.map((r, i) => (
            <div key={r.id}>
              {(i === 0 || dayOf(shown[i - 1]!) !== dayOf(r)) && <div className="lbl" style={{ padding: '16px 0 6px' }}>{heading(r)}</div>}
              <div className="audr">
                <span className="av" aria-hidden="true">{initials(r.actor)}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{auditLabel(r.action)}</b>
                  <small>{r.actor}{r.detail ? ` · ${r.detail}` : ''}</small>
                </span>
                <time dateTime={r.at}>{fmtDate(r.at, 'time')}</time>
              </div>
            </div>
          ))}
          {more}
        </Card>
      )}
    </Page>
  );
}
