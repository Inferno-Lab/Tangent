import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouteContext } from '@tanstack/react-router';
import { schoolToday } from '@tangent/contracts';
import { Checkbox, DateField, EmptyCard, LogoImage, ErrorLine, Field, PhoneField, SelectField, useHue, useShake, t, Skeleton } from '@tangent/web-ui';
import { AreaField, fieldsOf, messageOf } from '../../app/kit';

/**
 * A family applies for a seat from the school's own address (People → Settings → "Families can apply online"). Nobody signs
 * in; the application lands in the school's first admission stage. The hidden field catches forms filled by robots.
 */
export function ApplyRoute() {
  const { slug, client } = useRouteContext({ from: '__root__' });
  const brand = useQuery({ queryKey: ['brand', slug], queryFn: client.api.brand, staleTime: 5 * 60_000 });
  const info = useQuery({ queryKey: ['apply', slug], queryFn: client.api.apply.info });
  useHue(brand.data?.hue);
  const [f, setF] = useState({ childName: '', gradeSought: '', dob: '', guardianName: '', phone: '', email: '', note: '', website: '' });
  const [consent, setConsent] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const grades = (info.data?.grades ?? []).map((g) => ({ value: String(g.value), label: /^\d+$/.test(g.label) ? t('admin.kit.grade', { name: g.label }) : g.label }));
  const send = useMutation({
    mutationFn: () => client.api.apply.send({
      childName: f.childName.trim(), gradeSought: Number(f.gradeSought || grades[0]?.value), dob: f.dob || undefined, guardianName: f.guardianName.trim(), phone: f.phone.trim(),
      email: f.email.trim(), note: f.note.trim(), consent: true, website: f.website,
    }),
    onSuccess: () => setDone(true),
    onError: (e) => { const fields = fieldsOf(e); setErr(Object.keys(fields).length ? fields : { _: messageOf(e) }); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.childName.trim().length < 2) p.childName = t('admin.apply.enter_the_child_s_name');
    if (f.guardianName.trim().length < 2) p.guardianName = t('admin.apply.enter_your_name');
    if (!f.phone.trim()) p.phone = t('admin.apply.enter_a_phone_number');
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) p.email = t('admin.apply.check_the_email');
    if (!consent) p.consent = t('admin.apply.agree_to_apply');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else send.mutate();
  };
  const b = brand.data;
  const school = b?.name ?? info.data?.school ?? '';
  const frame = (body: React.ReactNode) => (
    <div className="nest" style={{ minHeight: '100dvh', padding: 16, background: 'var(--bg)' }}>
      <main style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoImage src={b?.logoUrl} style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} />
          <div style={{ minWidth: 0 }}><h1 className="fd" style={{ margin: 0, overflowWrap: 'anywhere' }}>{school}</h1>{b?.tagline && <div className="help" style={{ margin: 0 }}>{b.tagline}</div>}</div>
        </div>
        {body}
      </main>
    </div>
  );
  if (info.isLoading || brand.isLoading) return frame(<Skeleton kind="form" rows={6} />);
  if (info.isError || !info.data) return frame(<EmptyCard error title={t('admin.apply.apply_for_a_seat')} chip={{ text: t('admin.apply.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('admin.apply.this_page_did_not_load')} body={messageOf(info.error)} actions={<button className="btn pri" onClick={() => void info.refetch()}>{t('admin.apply.try_again')}</button>} />);
  if (!info.data.open) {
    const reach = [b?.phone, b?.email].filter(Boolean).join(' · ');
    return frame(<EmptyCard title={t('admin.apply.apply_for_a_seat')} chip={{ text: t('admin.apply.closed'), tone: 'a' }} icon="calendar" heading={t('admin.apply.not_taking_applications_online')} body={reach ? t('admin.apply.contact_the_office', { reach }) : t('admin.apply.contact_the_school')} />);
  }
  if (done) return frame(<EmptyCard title={t('admin.apply.apply_for_a_seat')} chip={{ text: t('admin.apply.sent'), tone: 'g' }} icon="check" heading={t('admin.apply.thank_you')} body={t('admin.apply.the_school_will_be_in_touch', { school })} />);
  return frame(
    <section className={`card ${shake.cls}`} style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{t('admin.apply.apply_for_a_seat')}</h2>
      <p className="help" style={{ marginTop: 0 }}>{t('admin.apply.tell_us_about_your_child')}</p>
      <div className="stack">
        <div className="two">
          <Field label={t('admin.apply.child_s_name')} value={f.childName} onChange={set('childName')} error={err.childName} maxLength={80} autoComplete="off" />
          <SelectField label={t('admin.apply.grade')} value={f.gradeSought || grades[0]?.value || ''} onChange={set('gradeSought')} error={err.gradeSought} options={grades} />
        </div>
        <DateField label={t('admin.apply.date_of_birth_optional')} value={f.dob} onChange={set('dob')} error={err.dob} max={schoolToday()} />
        <Field label={t('admin.apply.your_name')} value={f.guardianName} onChange={set('guardianName')} error={err.guardianName} maxLength={80} autoComplete="name" />
        <div className="two">
          <PhoneField country={info.data?.country ?? ''} label={t('admin.apply.phone')} value={f.phone} onChange={set('phone')} error={err.phone} />
          <Field label={t('admin.apply.email_optional')} type="email" value={f.email} onChange={set('email')} error={err.email} autoComplete="email" />
        </div>
        <AreaField label={t('admin.apply.anything_the_school_should_know')} value={f.note} onChange={set('note')} rows={3} maxLength={400} />
        {/* Left empty by people, who never see it; a robot filling every field gives itself away. */}
        <input name="website" value={f.website} onChange={(e) => set('website')(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', insetInlineStart: -9999, width: 1, height: 1, opacity: 0 }} />
        <div>
          <Checkbox checked={consent} onChange={(c) => { setConsent(c); setErr((e) => ({ ...e, consent: '' })); }} label={t('admin.apply.i_agree_to_the_privacy_notice', { school })} />
          {b?.privacy.notice && <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setShowNotice(!showNotice)}>{showNotice ? t('admin.apply.hide_the_notice') : t('admin.apply.read_the_notice')}</button>}
          {showNotice && b?.privacy.notice && <div className="help" role="region" aria-label={t('admin.apply.privacy_notice')} style={{ whiteSpace: 'pre-line', maxHeight: 240, overflow: 'auto' }}>{b.privacy.notice}</div>}
          {err.consent && <ErrorLine>{err.consent}</ErrorLine>}
        </div>
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn pri" disabled={send.isPending} onClick={go}>{send.isPending ? t('admin.apply.sending') : t('admin.apply.send_the_application')}</button>
        </div>
      </div>
    </section>,
  );
}
