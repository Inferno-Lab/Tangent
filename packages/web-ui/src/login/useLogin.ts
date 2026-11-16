import { useEffect, useRef, useState } from 'react';
import { rollDigits } from '../digits';
import { markStyle } from '../shell/Sidebar';
import { CATALOGUE_LANGUAGES, chooseLanguage, currentLanguage, t as tr } from '../i18n';
import { languageOf } from '@tangent/contracts';

const EYE_ON = 'show';
const EYE_OFF = 'hide';

/** The parts of a failed call the form reads. The API client's error has all of them. */
export interface LoginFailure {
  message: string;
  code?: string;
  fields?: Record<string, string>;
  attemptsLeft?: number;
}

/** Where the code went: shown on the code step so the person knows which phone or inbox to check. */
export interface Challenge { challengeId: string; demoCode?: string; channel?: 'sms' | 'email' | 'app'; maskedTo?: string; expiresInSeconds?: number; enroll?: { secret: string; uri: string } }

export interface LoginController {
  product: 'admin' | 'console';
  /** The school's own name for the panel and the heading. */
  schoolName: string;
  shortName: string;
  /** The school's brand colour and logo letters, for its mark. */
  color?: string;
  logoText?: string;
  /** The school's logo image, when it has one: shown instead of the letters. */
  logoUrl?: string | null;
  /** The school's privacy notice and grievance officer, behind "Privacy". */
  privacy?: { notice: string; officerName: string; officerEmail: string; officerPhone: string };
  demoMode: boolean;
  /** Step one. Resolves to the code challenge, or to nothing when the school has two-step sign-in off. */
  submitCredentials: (email: string, password: string) => Promise<Challenge | null>;
  /** Step two. Resolves to the signed-in person's name. */
  submitCode: (challengeId: string, code: string) => Promise<string>;
  /** "Forgot it?": sends a code to the person's phone or email. Without it the link says who can help. */
  resetStart?: (identifier: string) => Promise<Challenge>;
  resetFinish?: (challengeId: string, code: string, password: string) => Promise<void>;
  /** Called when the person presses the button on the last step. */
  enter: () => void;
  goName: string;
  initialEmail?: string;
}

const failure = (e: unknown): LoginFailure => (e && typeof e === 'object' && 'message' in e ? (e as LoginFailure) : { message: tr('ui.use_login.something_went_wrong_try_again') });

/** Everything the sign-in page does: the two steps, the errors that shake, and the helpers for demo schools. */
export function useLogin(c: LoginController, themeCls: string) {
  const cons = c.product === 'console';
  const [step, setStep] = useState<'cred' | 'otp' | 'ok'>('cred');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [email, setEmail] = useState(c.initialEmail ?? '');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emErr, setEmErr] = useState('');
  const [pwErr, setPwErr] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [shake, setShake] = useState(0);
  const [tries, setTries] = useState(3);
  const [code, setCode] = useState('');
  const [otpErr, setOtpErr] = useState(false);
  const [otpMsg, setOtpMsg] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [name, setName] = useState('');
  const [forgotNote, setForgotNote] = useState('');
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState('');
  const fill = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(fill.current), []);
  const enterRef = useRef(c.enter);
  enterRef.current = c.enter;
  // The last step says "Opening…", so it does; the button stays for anyone who wants to skip the wait.
  useEffect(() => { if (step !== 'ok') return; const t = setTimeout(() => enterRef.current(), 1400); return () => clearTimeout(t); }, [step]);

  const bad = (fn: () => void) => { fn(); setShake((s) => (s === 1 ? 2 : 1)); setBusy(false); };

  const next = async () => {
    if (busy) return;
    if (!email.trim()) return bad(() => setEmErr(cons ? tr('ui.use_login.enter_your_tangent_email_to') : tr('ui.use_login.enter_your_email_or_phone')));
    if (!pw) return bad(() => { setPwErr(true); setPwMsg(tr('ui.use_login.enter_your_password_to_continue')); });
    setBusy(true);
    try {
      const res = await c.submitCredentials(email.trim(), pw);
      setBusy(false);
      if (res) { setChallenge(res); setCode(''); setOtpErr(false); setTries(3); setStep('otp'); }
      else { setName(email); setStep('ok'); }
    } catch (e) {
      const f = failure(e);
      bad(() => {
        if (f.fields?.identifier) setEmErr(f.fields.identifier);
        else { setPwErr(true); setPwMsg(f.attemptsLeft !== undefined && f.attemptsLeft <= 2 ? tr('ui.use_login.left', { message: f.message, attemptsLeft: f.attemptsLeft, p2: f.attemptsLeft === 1 ? 'try' : 'tries' }) : f.message); }
      });
    }
  };

  const forgot = async () => {
    if (!c.resetStart) { setForgotNote(tr('ui.use_login.ask_a_super_admin_to')); return; }
    if (!email.trim()) return bad(() => setEmErr(tr('ui.use_login.type_your_email_or_phone')));
    if (busy) return;
    setBusy(true);
    try {
      const ch = await c.resetStart(email.trim());
      setBusy(false); setChallenge(ch); setCode(''); setNewPw(''); setOtpErr(false); setTries(3); setResetting(true); setStep('otp');
    } catch (e) {
      bad(() => setEmErr(failure(e).message));
    }
  };

  const verifyNow = async (v: string) => {
    if (busy || !challenge) return;
    if (resetting) {
      if (v.length < 6 || newPw.length < 8) return bad(() => { setOtpErr(true); setOtpMsg(v.length < 6 ? tr('ui.use_login.type_the_6_digit_code') : tr('ui.use_login.choose_a_password_of_at')); });
      setBusy(true);
      try {
        await c.resetFinish!(challenge.challengeId, v, newPw);
        setBusy(false); setResetting(false); setPw(''); setStep('cred');
        setForgotNote(tr('ui.use_login.your_password_is_changed_sign'));
      } catch (e) {
        const f = failure(e);
        bad(() => { setOtpErr(true); setOtpMsg(f.message); if (f.attemptsLeft !== undefined) setTries(f.attemptsLeft); });
      }
      return;
    }
    setBusy(true);
    try {
      setName(await c.submitCode(challenge.challengeId, v));
      setBusy(false);
      setStep('ok');
    } catch (e) {
      const f = failure(e);
      bad(() => { setOtpErr(true); setOtpMsg(f.message); setCode(''); if (f.attemptsLeft !== undefined) setTries(f.attemptsLeft); else if (f.code === 'locked') setTries(0); });
    }
  };

  const boxes = [0, 1, 2, 3, 4, 5].map((i) => ({ v: code[i] || '', c: `${i === code.length && code.length < 6 ? 'cur ' : ''}${i < code.length ? 'f' : ''}` }));

  return {
    themeCls, rmCls: '', isAdmin: !cons, showPw: true, panelCls: cons ? 'cons' : '', shk: shake ? `shk${shake}` : '', nope: '',
    brand: c.schoolName, mark: (c.logoText || c.schoolName.slice(0, 1)).toUpperCase(), markStyle: markStyle(c.color), logoUrl: c.logoUrl ?? null,
    privacyOpen, privacy: c.privacy, togglePrivacy: () => setPrivacyOpen((o) => !o),
    // Tangent's own sign-in (the console, or the admin before a school is known) shows the Tangent icon; a school's shows its initial.
    tangent: c.product === 'console' || c.schoolName === 'Tangent',
    cardA: cons ? tr('ui.use_login.schools_live') : tr('ui.use_login.attendance_today'), aD: rollDigits(cons ? '312' : '94.2'), aU: cons ? '' : '%',
    cardB: cons ? tr('ui.use_login.release_2026_10_3') : tr('ui.use_login.fees_this_month'), bN: cons ? tr('ui.use_login.wave_3') : '18.4k', bU: cons ? tr('ui.use_login.of_6') : '', bChip: cons ? tr('ui.use_login.healthy') : '+8.7%', bChip2: cons ? tr('ui.use_login.141_updated') : tr('ui.use_login.62_of_due'),
    toastT: cons ? tr('ui.use_login.wave_3_passed_every_check') : tr('ui.use_login.attendance_sent_for_8_a'),
    headline: cons ? tr('ui.use_login.run_every_school_from_one') : tr('ui.use_login.everything_the_school_office_needs'),
    subline: cons ? tr('ui.use_login.releases_cells_support_and_billing') : tr('ui.use_login.attendance_fees_exams_and_every'),
    langs: CATALOGUE_LANGUAGES.map((code) => ({ n: languageOf(code).own, code, on: code === currentLanguage() ? 'on' : '', pick: () => chooseLanguage(code) })),
    isCred: step === 'cred', isOtp: step === 'otp', isOk: step === 'ok',
    title: cons ? tr('ui.use_login.console_sign_in') : tr('ui.use_login.welcome_back'), sub: cons ? tr('ui.use_login.tangent_team_members_only_every') : tr('ui.use_login.sign_in_to_the_staff', { shortName: c.shortName }), cta: cons ? tr('ui.use_login.continue') : tr('ui.use_login.sign_in'),
    email, onEmail: (e: { target: { value: string } }) => { setEmail(e.target.value); setEmErr(''); },
    emailPh: cons ? 'you@tangent.app' : tr('ui.use_login.your_email_or_phone_number'),
    pw, onPw: (e: { target: { value: string } }) => { setPw(e.target.value); setPwErr(false); },
    pwType: show ? 'text' : 'password', eyeD: show ? EYE_OFF : EYE_ON, eyeLabel: show ? tr('ui.use_login.hide_password') : tr('ui.use_login.show_password'), toggleEye: () => setShow((s) => !s),
    emCls: emErr ? tr('ui.use_login.err_shake') : '', emInv: emErr ? 'true' : 'false', emErr: !!emErr, emMsg: emErr, pwCls: pwErr ? tr('ui.use_login.err_shake') : '', pwInv: pwErr ? 'true' : 'false', pwErr, pwMsg,
    showDemo: c.demoMode, fillDemo: () => { setPw('nest2026'); setPwErr(false); },
    forgot: () => void forgot(), forgotNote, isReset: resetting, newPw, onNewPw: (e: { target: { value: string } }) => { setNewPw(e.target.value); setOtpErr(false); }, npCls: '',
    idLabel: cons ? tr('ui.use_login.tangent_email') : tr('ui.use_login.email_or_phone_number'), idType: cons ? 'email' : 'text',
    busy, notBusy: !busy,
    next: () => void next(),
    otpTitle: challenge?.enroll ? tr('ui.use_login.set_up_your_authenticator') : challenge?.channel === 'app' ? tr('ui.use_login.open_your_authenticator') : tr('ui.use_login.check_your', { p0: challenge?.channel === 'sms' ? 'messages' : 'inbox' }),
    otpSub: challenge?.enroll
      ? tr('ui.use_login.add_tangent_to_an_authenticator')
      : challenge?.channel === 'app'
        ? tr('ui.use_login.type_the_6_digit_code_2')
        : tr('ui.use_login.we_sent_a_6_digit', { p0: challenge?.channel === 'sms' ? 'text message' : 'email', p1: (challenge?.maskedTo ?? email).replace(/ /g, '\u00a0'), p2: Math.max(1, Math.round((challenge?.expiresInSeconds ?? 600) / 60)), p3: resetting ? ' Type it with your new password.' : '' }),
    enroll: challenge?.enroll ?? null, back: () => { setStep('cred'); setCode(''); setOtpErr(false); setResetting(false); },
    boxes, code, otpBad: otpErr ? tr('ui.use_login.bad_shake') : '', otpErr, otpMsg, tries,
    onCode: (e: { target: { value: string } }) => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 6);
      setCode(v); setOtpErr(false);
      if (v.length === 6 && !resetting) setTimeout(() => void verifyNow(v), 250);
    },
    fillCode: () => {
      const full = challenge?.demoCode ?? '424242';
      let k = 0;
      clearInterval(fill.current); setCode(''); setOtpErr(false);
      fill.current = setInterval(() => { k++; setCode(full.slice(0, k)); if (k >= 6) { clearInterval(fill.current); setTimeout(() => void verifyNow(full), 350); } }, 140);
    },
    verify: () => void verifyNow(code),
    firstName: name.split(/[ @.]/)[0] || 'there', goName: c.goName, enter: c.enter,
  };
}
