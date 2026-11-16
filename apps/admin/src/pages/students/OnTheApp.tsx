import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page } from '../../app/Page';
import { useSchoolConfig } from '../../app/kit';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * Families (and students, where the school uses the app for them) on the school's app: who has been invited, who signed in and
 * agreed to the privacy notice, the invite and the reminder, and the letters to send home, printed from the school's wording.
 */
export function OnTheApp({ tabs }: { tabs: React.ReactNode }) {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const cfg = useSchoolConfig();
  const act = useQuery({ queryKey: ['activation'], queryFn: app.api.movingIn.activation });
  const may = app.user.permissions.includes('students.write');
  const invite = useMutation({
    mutationFn: (b: { classId?: string; remind: boolean }) => app.api.movingIn.inviteFamilies(b.classId, b.remind),
    onSuccess: (r, b) => { void qc.invalidateQueries({ queryKey: ['activation'] }); say(r.sent ? `${b.remind ? t('admin.on_the_app.reminded') : t('admin.on_the_app.invited')} ${r.sent} ${r.sent === 1 ? 'family' : 'families'}.` : b.remind ? t('admin.on_the_app.everyone_invited_has_signed_in') : t('admin.on_the_app.no_family_is_left_to')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  // The letters are a PDF from the server, one page each, with the code that opens the school's app.
  const letters = (classId: string | undefined, role: 'family' | 'student') => {
    const w = window.open('', '_blank');
    void app.api.movingIn.letterPdf(classId, role).then((b) => { if (w) w.location.href = URL.createObjectURL(b); }).catch((e: Error) => { w?.close(); say(e.message, 'bad'); });
  };
  const students = !!cfg?.app.roles.includes('student');
  const a = act.data;
  return (
    <Page title={t('admin.on_the_app.students')} sub={t('admin.on_the_app.families_on_the_school_s')} toast={toast} tabs={tabs} loading={act.isLoading && !a}
      error={act.isError && !a ? { message: (act.error as Error).message, retry: () => void act.refetch() } : null}>
      {a && (a.classes.length === 0 ? (
        <EmptyState scene="onapp" onAction={() => app.go('/students?import=1')} onLink={() => app.go('/students?add=1')} />
      ) : (
        <Card title={t('admin.on_the_app.families_on_the_app')} chip={<span className="chip g">{a.families.signedIn} {t('admin.on_the_app.of')}{' '}{a.families.total} {t('admin.on_the_app.signed_in')}</span>}>
          <p className="help" style={{ marginTop: 0 }}>{t('admin.on_the_app.invite_a_class_at_a')}</p>
          <div className="scroll-x lscroll">
            <div style={{ minWidth: 760 }}>
              <div className="grd th" style={{ '--cols': 'minmax(0,1fr) 80px 80px minmax(0,1.3fr) 90px 260px' } as React.CSSProperties}><span>{t('admin.on_the_app.class')}</span><span>{t('admin.on_the_app.families')}</span><span>{t('admin.on_the_app.invited')}</span><span>{t('admin.on_the_app.signed_in_2')}</span><span data-tip={t('admin.on_the_app.agreed_to_the_school_s')}>{t('admin.on_the_app.consented')}</span><span></span></div>
              {a.classes.map((c) => (
                <div key={c.classId} className="grd rw" style={{ '--cols': 'minmax(0,1fr) 80px 80px minmax(0,1.3fr) 90px 260px' } as React.CSSProperties}>
                  <b style={{ font: '700 14px var(--fb)' }}>{c.className}</b>
                  <span>{c.families}</span>
                  <span>{c.invited}</span>
                  <span className="us" style={{ gap: 4 }}><div className="bar" style={{ height: 10 }}><i style={{ width: `${pct(c.signedIn, c.families)}%` }}></i></div><small style={{ font: '700 11px var(--fb)', color: 'var(--ink3)' }}>{c.signedIn} {t('admin.on_the_app.of')}{' '}{c.families}</small></span>
                  <span>{c.consented}</span>
                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {may && c.invited < c.families && <button className="btn sm" disabled={invite.isPending} onClick={() => invite.mutate({ classId: c.classId, remind: false })}>{t('admin.on_the_app.invite')}</button>}
                    {may && c.invited > c.signedIn && <button className="btn sm" disabled={invite.isPending} onClick={() => invite.mutate({ classId: c.classId, remind: true })}>{t('admin.on_the_app.remind')}</button>}
                    <button className="btn sm" disabled={!c.students} onClick={() => letters(c.classId, 'family')}>{t('admin.on_the_app.letters')}</button>
                    {students && <button className="btn sm" disabled={!c.students} onClick={() => letters(c.classId, 'student')}>{t('admin.on_the_app.student_letters')}</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {may && (
            <div className="tgrow" style={{ marginTop: 16 }}>
              {a.families.invited < a.families.total && <button className="btn pri" disabled={invite.isPending} onClick={() => invite.mutate({ remind: false })}>{t('admin.on_the_app.invite_every_family_not_yet')}</button>}
              {a.families.invited > a.families.signedIn && <button className="btn" disabled={invite.isPending} onClick={() => invite.mutate({ remind: true })}>{t('admin.on_the_app.remind_everyone_not_signed_in')}</button>}
            </div>
          )}
        </Card>
      ))}
    </Page>
  );
}
