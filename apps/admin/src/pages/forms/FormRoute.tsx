import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouteContext } from '@tanstack/react-router';
import { visibleFields, type CustomValues } from '@tangent/contracts';
import { CustomFieldInputs, EmptyCard, LogoImage, ErrorLine, useHue, useShake, t } from '@tangent/web-ui';
import { fieldsOf, messageOf } from '../../app/kit';

/**
 * A school form anyone with its link fills (Forms → "anyone with the link"): nobody signs in. Questions that depend on an
 * earlier answer appear only when it is given; the hidden field catches forms filled by robots.
 */
export function FormRoute() {
  const { slug, client } = useRouteContext({ from: '__root__' });
  const { token } = useParams({ strict: false }) as { token: string };
  const brand = useQuery({ queryKey: ['brand', slug], queryFn: client.api.brand, staleTime: 5 * 60_000 });
  const form = useQuery({ queryKey: ['form-link', token], queryFn: () => client.api.forms.link(token), retry: false });
  useHue(brand.data?.hue);
  const [answers, setAnswers] = useState<CustomValues>({});
  const [robot, setRobot] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const shake = useShake();
  const shown = form.data ? visibleFields(form.data, answers) : [];
  const send = useMutation({
    // Only the questions that apply are sent.
    mutationFn: () => client.api.forms.answerLink(token, { answers: Object.fromEntries(shown.map((q) => [q.key, answers[q.key] ?? null])), website: robot }),
    onSuccess: () => setDone(true),
    onError: (e) => { const f = fieldsOf(e); setErr(Object.keys(f).length ? Object.fromEntries(Object.entries(f).map(([k, v]) => [`custom.${k}`, v])) : { _: messageOf(e) }); shake.hit(); },
  });
  const b = brand.data;
  const frame = (body: React.ReactNode) => (
    <div className="nest" style={{ minHeight: '100dvh', padding: 16, background: 'var(--bg)' }}>
      <main style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoImage src={b?.logoUrl} style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} />
          <h1 className="fd" style={{ margin: 0, overflowWrap: 'anywhere' }}>{b?.name ?? ''}</h1>
        </div>
        {body}
      </main>
    </div>
  );
  if (form.isLoading || brand.isLoading) return frame(<div className="skc" style={{ height: 360, borderRadius: 24 }} />);
  if (form.isError || !form.data) return frame(<EmptyCard title={t('admin.form_route.form')} chip={{ text: t('admin.form_route.not_found'), tone: 'c' }} icon="warning" heading={t('admin.form_route.this_form_is_not_here')} body={t('admin.form_route.check_the_link')} />);
  const f = form.data;
  if (!f.open) return frame(<EmptyCard title={f.title} chip={{ text: t('admin.form_route.closed'), tone: 'a' }} icon="calendar" heading={t('admin.form_route.this_form_is_closed')} body={t('admin.form_route.ask_the_school')} />);
  if (done) return frame(<EmptyCard title={f.title} chip={{ text: t('admin.form_route.sent'), tone: 'g' }} icon="check" heading={t('admin.form_route.thank_you')} body={t('admin.form_route.your_answers_reached', { school: b?.name ?? '' })} />);
  return frame(
    <section className={`card ${shake.cls}`} style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{f.title}</h2>
      {f.intro && <p className="help" style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{f.intro}</p>}
      <div className="stack">
        <CustomFieldInputs defs={shown} values={answers} onChange={(v) => { setAnswers(v); setErr({}); }} errors={err} />
        {/* Left empty by people, who never see it; a robot filling every field gives itself away. */}
        <input name="website" value={robot} onChange={(e) => setRobot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', insetInlineStart: -9999, width: 1, height: 1, opacity: 0 }} />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn pri" disabled={send.isPending} onClick={() => send.mutate()}>{send.isPending ? t('admin.form_route.sending') : t('admin.form_route.send')}</button>
        </div>
      </div>
    </section>,
  );
}
