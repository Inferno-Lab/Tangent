import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { HttpError } from '@tangent/api-client';
import { closeModules } from '@tangent/config-engine';
import { packSettings, curriculaFor, countryName, ZONES, LOCALES, COUNTRY_DEFAULTS, COUNTRIES, DEFAULT_BRAND, DEPLOY_TARGET_LABELS, LANGUAGES, readableOn, WizardAdmin, WizardBasics, WizardBranding, WizardData, WizardPayload, WizardPlacement, WizardPlan, type ProvisionRunRow, type WizardReview } from '@tangent/contracts';
import { ColourField, Field, FilePick, NumberField, SelectField, useShake, Icon, t as tr, listOf, dayOf } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { count, price } from '../../app/format';

const STEPS = [
  { key: 'basics', label: tr('console.wizard_page.the_school'), schema: WizardBasics },
  { key: 'plan', label: tr('console.wizard_page.plan_and_modules'), schema: WizardPlan },
  { key: 'branding', label: tr('console.wizard_page.name_and_colours'), schema: WizardBranding },
  { key: 'placement', label: tr('console.wizard_page.where_it_runs'), schema: WizardPlacement },
  { key: 'admin', label: tr('console.wizard_page.first_admin'), schema: WizardAdmin },
  { key: 'data', label: tr('console.wizard_page.starting_data'), schema: WizardData },
  { key: 'review', label: tr('console.wizard_page.review_and_launch'), schema: null },
] as const;
type Key = 'basics' | 'plan' | 'branding' | 'placement' | 'admin' | 'data';
type Data = Record<Key, Record<string, unknown>>;

const DEFAULTS: Data = {
  basics: { name: '', shortName: '', slug: '', board: 'Other', address: '', city: '', contactName: '', contactPhone: '', contactEmail: '', gstin: '', language: 'en', country: '', timezone: '', locale: '', currency: '' },
  plan: { plan: '', modules: [], students: 500 },
  branding: { color: DEFAULT_BRAND, logoText: '', appName: '', tagline: '', logo: null },
  placement: { target: '', cell: '', addressing: 'path', customDomain: '' },
  admin: { name: '', email: '', phone: '', invite: 'both', roles: ['principal'] },
  data: { start: 'empty' },
};
const TARGET: Record<string, string> = DEPLOY_TARGET_LABELS;
const RUN_WORDS: Record<string, string> = { done: tr('console.wizard_page.would_run'), failed: tr('console.wizard_page.would_stop_here'), pending: tr('console.wizard_page.not_reached'), running: tr('console.wizard_page.checking'), skipped: tr('console.wizard_page.skipped'), succeeded: tr('console.wizard_page.everything_would_run'), queued: tr('console.wizard_page.waiting'), };
const slugify = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
/** The contracts carry their own friendly messages; the library's stock ones get a plain replacement. */
const friendly = (m: string) => (/^Too small/.test(m) ? tr('console.wizard_page.please_fill_this_in') : /^(Too big|Invalid)/.test(m) ? tr('console.wizard_page.please_check_this_value') : m);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function WizardPage() {
  const app = useApp();
  const { draft: draftParam } = useParams({ strict: false }) as { draft?: string };
  const { toast, say } = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Data>(DEFAULTS);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState(draftParam ?? '');
  const [loaded, setLoaded] = useState(!draftParam);
  const [rehearsal, setRehearsal] = useState<ProvisionRunRow | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [planNote, setPlanNote] = useState('');
  const shake = useShake();

  const plans = useQuery({ queryKey: ['plans'], queryFn: app.api.plans, staleTime: 5 * 60_000 });
  const cells = useQuery({ queryKey: ['cells'], queryFn: app.api.cells });
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: app.api.catalog, staleTime: 10 * 60_000 });
  const saved = useQuery({ queryKey: ['draft', draftParam], queryFn: () => app.api.wizard.draft(draftParam!), enabled: !!draftParam });

  useEffect(() => {
    if (!saved.data || loaded) return;
    const next: Data = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as Key[]) next[k] = { ...DEFAULTS[k], ...((saved.data.data[k] as Record<string, unknown>) ?? {}) };
    setData(next); setStep(Math.min(saved.data.step, STEPS.length - 1)); setLoaded(true);
    setTouched(new Set(['basics.shortName', 'basics.slug', 'branding.logoText', 'branding.appName']));
  }, [saved.data, loaded]);
  useEffect(() => {
    if (!plans.data?.length || data.plan.plan) return;
    const p = plans.data.find((x) => x.key === 'complete') ?? plans.data[plans.data.length - 1]!;
    setData((d) => ({ ...d, plan: { ...d.plan, plan: p.key, modules: p.modules } }));
  }, [plans.data, data.plan.plan]);
  useEffect(() => {
    if (!cells.data?.length || data.placement.cell) return;
    const c = cells.data.find((x) => x.target === 'free-test') ?? cells.data[0]!;
    setData((d) => ({ ...d, placement: { ...d.placement, cell: c.key, target: c.target } }));
  }, [cells.data, data.placement.cell]);

  // Save the draft a moment after the last change, so closing the tab never loses the form.
  const save = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idRef = useRef(draftId);
  idRef.current = draftId;
  useEffect(() => {
    if (!loaded || step >= STEPS.length - 1) return;
    if (data.basics.name === '' && !idRef.current) return;
    clearTimeout(save.current);
    save.current = setTimeout(() => {
      const body = { name: str(data.basics.name) || tr('console.wizard_page.new_school'), step, data };
      // A small "Saved" beside the steps says the draft is safe, so nobody wonders.
      if (idRef.current) void app.api.wizard.saveDraft(idRef.current, body).then(() => setSavedAt(Date.now())).catch(() => undefined);
      else void app.api.wizard.createDraft(body).then((d) => { idRef.current = d.id; setDraftId(d.id); setSavedAt(Date.now()); }).catch(() => undefined);
    }, 900);
    return () => clearTimeout(save.current);
  }, [data, step, loaded, app.api.wizard]);

  const set = (k: Key, field: string, value: unknown) => {
    setErrs((e) => ({ ...e, [`${k}.${field}`]: '' }));
    setData((d) => {
      const next = { ...d, [k]: { ...d[k], [field]: value } } as Data;
      if (k === 'basics' && field === 'name') {
        const name = str(value);
        const short = name.split(/\s+/)[0] ?? '';
        if (!touched.has('basics.shortName')) next.basics.shortName = short.slice(0, 20);
        if (!touched.has('basics.slug')) next.basics.slug = slugify(name);
        if (!touched.has('branding.logoText')) next.branding.logoText = name.trim().charAt(0).toUpperCase();
        if (!touched.has('branding.appName')) next.branding.appName = short.slice(0, 30);
      }
      return next;
    });
    if (field !== 'name') setTouched((t) => new Set(t).add(`${k}.${field}`));
  };
  const checkSlug = () => {
    const v = str(data.basics.slug);
    if (v) void app.api.wizard.slug(v).then((r) => setErrs((e) => ({ ...e, 'basics.slug': r.problem })));
  };
  const f = (k: Key, field: string, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label} value={str(data[k][field])} onChange={(v) => set(k, field, v)} error={errs[`${k}.${field}`]} {...extra} />
  );

  const check = (k: Key): boolean => {
    const s = STEPS.find((x) => x.key === k)!;
    const r = s.schema!.safeParse(data[k]);
    const out: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) out[`${k}.${String(i.path[0] ?? '')}`] ??= friendly(i.message);
    if (k === 'placement' && !data.placement.cell) out['placement.cell'] = tr('console.wizard_page.pick_where_this_school_should');
    setErrs((e) => ({ ...e, ...Object.fromEntries(Object.keys(e).filter((x) => x.startsWith(`${k}.`)).map((x) => [x, ''])), ...out }));
    if (Object.keys(out).length) shake.hit();
    return Object.keys(out).length === 0;
  };
  const next = () => { const k = STEPS[step]!.key; if (k === 'review' || check(k as Key)) setStep(step + 1); };
  const jump = (i: number) => { if (i <= step || (STEPS.slice(0, i).every((s) => s.key === 'review' || WIZARD_OK(s.key as Key)))) setStep(i); };
  const WIZARD_OK = (k: Key) => STEPS.find((x) => x.key === k)!.schema!.safeParse(data[k]).success;

  const payload = WizardPayload.safeParse(data);
  const review = useQuery({
    queryKey: ['review', JSON.stringify(data)], queryFn: () => app.api.wizard.review(payload.data!), enabled: step === STEPS.length - 1 && payload.success, staleTime: 0,
  });
  const launch = useMutation({
    mutationFn: (dryRun: boolean) => app.api.wizard.launch({ payload: payload.data!, dryRun, draftId: draftId || undefined }),
    onSuccess: (run, dry) => { if (dry) { setRehearsal(run); say(tr('console.wizard_page.rehearsal_finished_nothing_was_created')); } else app.go(`/schools/${run.schoolId}`); },
    onError: (e) => { say(e instanceof HttpError ? (e.fields.review ?? e.message) : (e as Error).message, 'bad'); shake.hit(); },
  });

  const plan = plans.data?.find((p) => p.key === data.plan.plan);
  const links = useQuery({ queryKey: ['integrations'], queryFn: app.api.integrations.view, enabled: app.can('integrations.read'), staleTime: 60_000 });
  // The first admin's invitation goes the ways the platform can send (sandbox stands in for all of them).
  const can = (cap: 'sms' | 'email') => !links.data || links.data.mode === 'sandbox' || links.data.routes.some((r) => r.capability === cap && !r.schoolId);
  const invite = [...(can('sms') && can('email') ? [{ value: 'both', label: tr('console.wizard_page.text_and_email') }] : []), ...(can('sms') ? [{ value: 'sms', label: tr('console.wizard_page.text_message') }] : []), ...(can('email') ? [{ value: 'email', label: tr('console.wizard_page.email') }] : [])];
  const mods = (data.plan.modules as string[]) ?? [];
  const body: ReactNode = (() => {
    switch (STEPS[step]!.key) {
      case 'basics': return (
        <>
          {f('basics', 'name', tr('console.wizard_page.school_name'), { placeholder: tr('console.wizard_page.banyan_ridge_school') })}
          <div className="two">{f('basics', 'shortName', tr('console.wizard_page.short_name'), { hint: tr('console.wizard_page.used_in_the_menu_and') })}{f('basics', 'slug', tr('console.wizard_page.address_name'), { hint: tr('console.wizard_page.lives_at_s', { p0: str(data.basics.slug) || 'name' }), onBlur: checkSlug })}</div>
          <div className="two">
            <SelectField label={tr('console.wizard_page.curriculum')} value={str(data.basics.board)} onChange={(v) => set('basics', 'board', v)} options={curriculaFor(str(data.basics.country)).map((c) => ({ value: c.key, label: c.name }))} />
            <SelectField label={tr('console.wizard_page.app_language')} value={str(data.basics.language)} onChange={(v) => set('basics', 'language', v)} options={LANGUAGES.map(([value, label]) => ({ value, label }))} />
          </div>
          <div className="two">
            <SelectField label={tr('console.wizard_page.country')} value={str(data.basics.country)} error={errs['basics.country']} onChange={(c) => {
              set('basics', 'country', c);
              // The country's usual zone, locale and currency, each still changeable.
              const d = COUNTRY_DEFAULTS[c];
              if (d) { set('basics', 'timezone', d.zone); set('basics', 'locale', d.locale); set('basics', 'currency', d.currency); }
            }} options={[{ value: '', label: tr('console.wizard_page.choose_a_country') }, ...COUNTRIES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label))]} />
            <SelectField label={tr('console.wizard_page.time_zone')} value={str(data.basics.timezone)} error={errs['basics.timezone']} onChange={(v) => set('basics', 'timezone', v)} options={[{ value: '', label: tr('console.wizard_page.choose_a_time_zone') }, ...ZONES.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))]} />
          </div>
          <div className="two">
            <SelectField label={tr('console.wizard_page.dates_and_numbers_written_as')} value={str(data.basics.locale)} error={errs['basics.locale']} onChange={(v) => set('basics', 'locale', v)} options={[{ value: '', label: tr('console.wizard_page.choose_a_way') }, ...LOCALES.map(([value, label]) => ({ value, label }))]} />
            {f('basics', 'currency', tr('console.wizard_page.currency'), { hint: tr('console.wizard_page.a_code_like_usd_gbp') })}
          </div>
          <PackLine country={str(data.basics.country)} curriculum={str(data.basics.board)} />
          <div className="two">{f('basics', 'city', tr('console.wizard_page.town_or_city'))}{f('basics', 'gstin', tr('console.wizard_page.gstin_optional'))}</div>
          {f('basics', 'address', tr('console.wizard_page.address_optional'))}
          <div className="lbl" style={{ margin: '8px 0' }}>{tr('console.wizard_page.who_we_talk_to')}</div>
          <div className="two">{f('basics', 'contactName', tr('console.wizard_page.contact_name'))}{f('basics', 'contactPhone', tr('console.wizard_page.phone'), { type: 'tel' })}</div>
          {f('basics', 'contactEmail', tr('console.wizard_page.email'), { type: 'email' })}
        </>
      );
      case 'plan': return (
        <>
          <div className="lbl" style={{ marginBottom: 8 }}>{tr('console.wizard_page.plan')}</div>
          <div style={{ display: 'grid', gap: 10 }} role="radiogroup" aria-label={tr('console.wizard_page.plan')}>
            {(plans.data ?? []).map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={p.key === data.plan.plan} className={`opt ${p.key === data.plan.plan ? 'on' : ''}`} onClick={() => { if (p.key === data.plan.plan) return; set('plan', 'plan', p.key); set('plan', 'modules', p.modules); setPlanNote(tr('console.wizard_page.modules_reset_to_the_plan', { name: p.name, length: p.modules.length })); }}>
                <span className="rd"><Icon name="check" /></span>
                <span style={{ flex: 1 }}><b>{p.name} · {price(p.perStudentYear)} {tr('console.wizard_page.per_student_a_year')}</b><small>{p.modules.length} {tr('console.wizard_page.modules_up_to')}{' '}{count(p.limits.students)} {tr('console.wizard_page.students')}{' '}{p.limits.storageGb} {tr('console.wizard_page.gb_files')}{' '}{count(p.limits.smsPerMonth)} {tr('console.wizard_page.texts_a_month')}</small></span>
              </button>
            ))}
          </div>
          {planNote && <div className="help" role="status" style={{ marginTop: 10 }}>{planNote}</div>}
          <div className="lbl" style={{ margin: '20px 0 8px' }}>{tr('console.wizard_page.modules')}</div>
          <div className="two">
            {(catalog.data?.modules ?? []).filter((m) => m.state !== 'planned').map((m) => {
              const inPlan = plan?.modules.includes(m.key) ?? false;
              const on = mods.includes(m.key);
              return (
                <button key={m.key} type="button" className={`opt ${on ? 'on' : ''}`} aria-pressed={on} disabled={!inPlan} style={{ padding: 12, opacity: inPlan ? 1 : 0.45 }}
                  onClick={() => set('plan', 'modules', on ? mods.filter((x) => x !== m.key) : closeModules([...mods, m.key]))}>
                  <span className="rd"><Icon name="check" /></span>
                  <span><b>{m.name}</b><small>{inPlan ? m.blurb : tr('console.wizard_page.not_in_this_plan')}</small></span>
                </button>
              );
            })}
          </div>
          {errs['plan.modules'] && <div className="emsg" role="alert" style={{ marginTop: 8 }}>{errs['plan.modules']}</div>}
          <div style={{ marginTop: 16, maxWidth: 320 }}>
            <NumberField label={tr('console.wizard_page.students_expected')} min={1} step={50} value={String(data.plan.students ?? '')} onChange={(v) => set('plan', 'students', Number(v) || 0)} error={errs['plan.students']}
              hint={plan ? (Number(data.plan.students) > plan.limits.students ? tr('console.wizard_page.more_than_the_allows_raise', { count: count(plan.limits.students), name: plan.name }) : tr('console.wizard_page.up_to_on', { count: count(plan.limits.students), name: plan.name })) : undefined} />
          </div>
        </>
      );
      case 'branding': return (
        <>
          <div className="two">{f('branding', 'appName', tr('console.wizard_page.name_in_the_app'), { hint: tr('console.wizard_page.shown_on_the_home_screen') })}{f('branding', 'logoText', tr('console.wizard_page.logo_letters'), { maxLength: 2, hint: tr('console.wizard_page.one_or_two_letters') })}</div>
          {f('branding', 'tagline', tr('console.wizard_page.tagline_optional'))}
          <div className="fld">
            <label>{tr('console.wizard_page.logo_optional')}</label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`chip ${data.branding.logo ? 'g' : ''}`}>{data.branding.logo ? (data.branding.logo as { name: string }).name : tr('console.wizard_page.the_letters_until_a_logo')}</span>
              <FilePick accept="image/png,image/jpeg" className="btn sm" onPick={(file) => {
                if (!['image/png', 'image/jpeg'].includes(file.type)) { setErrs((e) => ({ ...e, 'branding.logo': tr('console.wizard_page.choose_a_png_or_jpeg') })); return; }
                if (file.size > 2 * 1024 * 1024) { setErrs((e) => ({ ...e, 'branding.logo': tr('console.wizard_page.the_logo_must_be_2') })); return; }
                const r = new FileReader();
                r.onload = () => set('branding', 'logo', { name: file.name, mime: file.type, data: String(r.result).split(',')[1] ?? '' });
                r.readAsDataURL(file);
              }}>{data.branding.logo ? tr('console.wizard_page.choose_another') : tr('console.wizard_page.choose_a_logo')}</FilePick>
              {!!data.branding.logo && <button className="btn sm" onClick={() => set('branding', 'logo', null)}>{tr('console.wizard_page.remove')}</button>}
            </div>
            {errs['branding.logo'] ? <div className="emsg" role="alert">{errs['branding.logo']}</div> : <div className="help">{tr('console.wizard_page.stored_with_the_school_once')}</div>}
          </div>
          <div className="lbl" style={{ margin: '8px 0' }}>{tr('console.wizard_page.brand_colour')}</div>
          <ColourField label={tr('console.wizard_page.brand_colour')} value={String(data.branding.color)} onChange={(c) => set('branding', 'color', c)} />
          {errs['branding.color'] && <div className="emsg" role="alert" style={{ marginTop: 8 }}>{errs['branding.color']}</div>}
          <div style={{ marginTop: 16, borderRadius: 24, border: '1px solid var(--line)', overflow: 'hidden', maxWidth: 260, background: 'var(--s2)' }} aria-label={tr('console.wizard_page.app_preview')}>
            <div style={{ padding: '16px 16px 20px', color: readableOn(str(data.branding.color)), background: str(data.branding.color), font: '700 13px var(--fb)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 10, background: 'color-mix(in srgb,var(--on-deep) 28%,transparent)', display: 'grid', placeItems: 'center', font: '700 12px var(--fd)' }}>{str(data.branding.logoText) || '?'}</span>{str(data.branding.appName) || tr('console.wizard_page.your_school')}
            </div>
            <div style={{ padding: 12, display: 'grid', gap: 8 }}><i style={{ display: 'block', height: 12, width: '70%', borderRadius: 7, background: 'var(--line2)' }}></i><i style={{ display: 'block', height: 12, width: '46%', borderRadius: 7, background: 'var(--line2)' }}></i><b style={{ display: 'block', height: 34, borderRadius: 12, background: str(data.branding.color), color: readableOn(str(data.branding.color)), textAlign: 'center', lineHeight: '34px', font: '700 12px var(--fb)' }}>{mods.includes('fees') ? tr('console.wizard_page.pay_fees') : mods.includes('homework') ? tr('console.wizard_page.homework') : tr('console.wizard_page.notices')}</b></div>
          </div>
        </>
      );
      case 'placement': return (
        <>
          <SelectField label={tr('console.wizard_page.where_it_runs')} value={str(data.placement.cell)} error={errs['placement.cell']}
            onChange={(v) => { const c = cells.data?.find((x) => x.key === v); set('placement', 'cell', v); if (c) set('placement', 'target', c.target); }}
            options={(cells.data ?? []).map((c) => ({ value: c.key, label: tr('console.wizard_page.cell_of_used', { key: c.key, p1: TARGET[c.target] ?? c.target, schools: c.schools, maxSchools: c.maxSchools }) }))} />
          <div className="lbl" style={{ margin: '16px 0 8px' }}>{tr('console.wizard_page.address_style')}</div>
          <div className="two">
            {([['path', tr('console.wizard_page.a_path_on_the_shared'), tr('console.wizard_page.works_with_no_domain_s')], ['subdomain', tr('console.wizard_page.its_own_subdomain'), tr('console.wizard_page.name_platform_domain_set_and')]] as const).map(([v, t, h]) => (
              <button key={v} type="button" className={`opt ${data.placement.addressing === v ? 'on' : ''}`} onClick={() => set('placement', 'addressing', v)} aria-pressed={data.placement.addressing === v}>
                <span className="rd"><Icon name="check" /></span><span><b>{t}</b><small>{h}</small></span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>{f('placement', 'customDomain', tr('console.wizard_page.custom_domain_optional'), { placeholder: 'app.yourschool.org', hint: tr('console.wizard_page.leave_empty_to_use_the') })}</div>
        </>
      );
      case 'admin': return (
        <>
          <div className="help" style={{ marginBottom: 12 }}>{tr('console.wizard_page.this_person_gets_the_principal')}</div>
          {f('admin', 'name', tr('console.wizard_page.name'))}{f('admin', 'email', tr('console.wizard_page.email'), { type: 'email' })}{f('admin', 'phone', tr('console.wizard_page.phone'), { type: 'tel' })}
          <SelectField label={tr('console.wizard_page.send_the_invitation_by')} value={invite.some((o) => o.value === str(data.admin.invite)) ? str(data.admin.invite) : invite[0]?.value ?? ''} onChange={(v) => set('admin', 'invite', v)} options={invite} />
          {invite.length < 3 && <div className="help">{tr('console.wizard_page.connected_under_integrations', { n: invite.length })}{links.data?.mode === 'sandbox' ? tr('console.wizard_page.in_sandbox_it_lands_in') : ''}.</div>}
        </>
      );
      case 'data': return (
        <div style={{ display: 'grid', gap: 10 }} role="radiogroup" aria-label={tr('console.wizard_page.starting_data')}>
          {([['empty', tr('console.wizard_page.empty'), tr('console.wizard_page.a_brand_new_school_with')], ['import', tr('console.wizard_page.empty_then_import'), tr('console.wizard_page.starts_empty_tangent_s_team')]] as const).map(([v, t, h]) => (
            <button key={v} type="button" role="radio" aria-checked={data.data.start === v} className={`opt ${data.data.start === v ? 'on' : ''}`} onClick={() => set('data', 'start', v)}>
              <span className="rd"><Icon name="check" /></span><span><b>{t}</b><small>{h}</small></span>
            </button>
          ))}
        </div>
      );
      default: return <ReviewStep review={review.data} loading={review.isLoading} error={review.isError ? (review.error as Error).message : ''} payloadOk={payload.success} missing={STEPS.slice(0, 6).filter((s) => !WIZARD_OK(s.key as Key)).map((s) => s.label)} rehearsal={rehearsal} />;
    }
  })();

  const last = step === STEPS.length - 1;
  const problems = review.data?.problems ?? [];
  return (
    <Page title={tr('console.wizard_page.onboard_a_school')} sub={tr('console.wizard_page.short_steps_nothing_is_created', { length: STEPS.length, p1: savedAt ? tr('console.wizard_page.draft_saved') : '' })} toast={toast} back={{ label: tr('console.wizard_page.onboarding'), to: '/onboarding', go: app.go }} loading={!loaded}>
      <div className="wiz">
        <nav className="wst" aria-label={tr('console.wizard_page.steps')}>
          {STEPS.map((s, i) => (
            <button key={s.key} className={i === step ? 'on' : i < step ? 'ok' : ''} aria-current={i === step ? 'step' : undefined} onClick={() => jump(i)}>
              <i>{i < step ? <Icon name="check" size={14} /> : i + 1}</i>{s.label}
            </button>
          ))}
        </nav>
        <div className={shake.cls} style={{ minWidth: 0 }}>
          <Card title={STEPS[step]!.label} chip={<span className="chip">{step + 1} {tr('console.wizard_page.of')}{' '}{STEPS.length}</span>}>
            <div className="stack">{body}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>{tr('console.wizard_page.back')}</button>
              {last ? (
                <span className="tgrow">
                  <button className="btn" disabled={!payload.success || launch.isPending || problems.length > 0} onClick={() => launch.mutate(true)}>{launch.isPending && launch.variables ? tr('console.wizard_page.rehearsing') : tr('console.wizard_page.rehearse')}</button>
                  <button className="btn pri" disabled={!payload.success || launch.isPending || problems.length > 0 || review.isLoading || !app.can('schools.write')} onClick={() => launch.mutate(false)}>{launch.isPending && !launch.variables ? tr('console.wizard_page.launching') : tr('console.wizard_page.launch')}</button>
                </span>
              ) : <button className="btn pri" onClick={next}>{tr('console.wizard_page.continue')}<Icon name="next" /></button>}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function ReviewStep({ review, loading, error, payloadOk, missing, rehearsal }: { review?: WizardReview; loading: boolean; error: string; payloadOk: boolean; missing: string[]; rehearsal: ProvisionRunRow | null }) {
  if (!payloadOk) return <div className="emsg" role="alert">{tr('console.wizard_page.finish_these_steps_first')}{' '}{missing.join(', ')}.</div>;
  if (loading) return <div className="skc" style={{ height: 240, borderRadius: 16 }} />;
  if (error) return <div className="emsg" role="alert">{error}</div>;
  if (!review) return null;
  return (
    <>
      {review.problems.map((p) => <div key={p} className="emsg" role="alert" style={{ marginBottom: 8 }}>{p}</div>)}
      {review.summary.map((s) => <div key={s.label} className="kv">{s.label}<b>{s.detail}</b></div>)}
      <div className="lbl" style={{ margin: '16px 0 4px' }}>{tr('console.wizard_page.launch_will')}</div>
      <div className="steps">
        {review.willDo.map((w, i) => (
          <div key={w.key} className="stp"><span className="dot">{i + 1}</span><div><b>{w.optional ? tr('console.wizard_page.optional', { label: w.label }) : w.label}</b><small>{w.detail}</small></div><span></span></div>
        ))}
      </div>
      <div className="help" style={{ marginTop: 10 }}>{tr('console.wizard_page.cell')}{' '}{review.capacity.cell} {tr('console.wizard_page.holds')}{' '}{review.capacity.schools} {tr('console.wizard_page.of')}{' '}{review.capacity.max} {tr('console.wizard_page.schools')}{review.capacity.ok ? '.' : tr('console.wizard_page.and_is_full')}</div>
      {rehearsal && (
        <div style={{ marginTop: 16 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>{tr('console.wizard_page.rehearsal')}{' '}{RUN_WORDS[rehearsal.status] ?? rehearsal.status}</div>
          {rehearsal.steps.map((s) => <div key={s.key} className="kv">{s.label}<b><span className={`st ${s.status === 'done' ? 'g' : s.status === 'failed' ? 'c' : 'n'}`}><i></i>{RUN_WORDS[s.status] ?? s.status}</span></b></div>)}
        </div>
      )}
    </>
  );
}

/** What the school starts with from its country and curriculum (packs.ts): changeable later, by the school or by Tangent. */
function PackLine({ country, curriculum }: { country: string; curriculum: string }) {
  const p = packSettings(country, curriculum);
  const scale = p['grading.scale'] as { grade: string }[] | undefined;
  const methods = p['fees.paymentMethods'] as { name: string }[] | undefined;
  const off = p['calendar.weeklyOff'] as string[] | undefined;
  const parts = [
    scale && tr('console.wizard_page.grades', { p0: listOf(scale.map((g) => g.grade)) }), p['grading.passPct'] !== undefined && tr('console.wizard_page.pass_at', { String: String(p['grading.passPct']) }),
    methods && tr('console.wizard_page.paid_by', { p0: listOf(methods.map((m) => m.name), true) }), off && tr('console.wizard_page.closed', { p0: listOf(off.map(dayOf)) }),
  ].filter(Boolean);
  return <div className="help" style={{ margin: '0 0 12px' }}>{parts.length ? tr('console.wizard_page.starts_with_everything_can_be', { p0: parts.join('; ') }) : tr('console.wizard_page.starts_with_tangent_s_defaults')}</div>;
}
