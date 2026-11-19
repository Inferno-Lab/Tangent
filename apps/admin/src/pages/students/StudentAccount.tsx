import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StudentDetail } from '@tangent/contracts';
import { Field, PhoneField, t, listOf } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { problem, stamp, useCountry, useSchoolConfig } from '../../app/kit';

/**
 * A student's own app account, when Tangent has the school use the app for students: signed in with the student's own phone or
 * email by a code, seeing only themselves. Shown in the student's drawer.
 */
export function StudentAccount({ s, say }: { s: StudentDetail; say: (m: string) => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const cfg = useSchoolConfig();
  const country = useCountry();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ phone: '', email: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => app.api.students.appAccount(s.id, { ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.email.trim() ? { email: f.email.trim() } : {}) }),
    onSuccess: () => { setOpen(false); setF({ phone: '', email: '' }); void qc.invalidateQueries({ queryKey: ['student', s.id] }); say(t('admin.student_account.is_told_how_to_sign', { p0: s.name.split(' ')[0] })); },
    onError: (e) => setErr(problem(e)),
  });
  if (!cfg?.app.roles.includes('student')) return null;
  const a = s.appAccount;
  const canWrite = app.user.permissions.includes('students.write');
  return (
    <div style={{ marginTop: 16 }}>
      <h3>{t('admin.student_account.the_student_s_own_app')}</h3>
      {a ? (
        <div className="kv"><span>{t('admin.student_account.signs_in_with', { how: listOf([a.phone, a.email].filter((x): x is string => !!x), true) })}</span><b>{a.lastSignIn ? t('admin.student_account.last_in', { stamp: stamp(a.lastSignIn) }) : t('admin.student_account.not_signed_in_yet')}</b></div>
      ) : <p className="help" style={{ margin: 0 }}>{s.name.split(' ')[0]} {t('admin.student_account.has_no_account_of_their')}</p>}
      {canWrite && !open && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>{a ? t('admin.student_account.change_how_they_sign_in') : t('admin.student_account.give_them_the_app')}</button>}
      {open && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="two">
            <PhoneField country={country} label={t('admin.student_account.their_own_phone')} value={f.phone} onChange={(phone) => { setF({ ...f, phone }); setErr({}); }} error={err.phone} />
            <Field label={t('admin.student_account.or_their_email')} type="email" value={f.email} onChange={(email) => { setF({ ...f, email }); setErr({}); }} error={err.email} maxLength={120} />
          </div>
          {err._ && <div className="emsg" role="alert">{err._}</div>}
          <div className="tgrow">
            <button className="btn" onClick={() => { setOpen(false); setErr({}); }}>{t('admin.student_account.cancel')}</button>
            <button className="btn pri" disabled={send.isPending} onClick={() => { if (!f.phone.trim() && !f.email.trim()) setErr({ phone: t('admin.student_account.give_the_student_s_own') }); else send.mutate(); }}>{send.isPending ? t('admin.student_account.sending') : t('admin.student_account.send_the_sign_in_details')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
