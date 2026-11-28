import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@tangent/db';
import { toE164, initials, type AppRoleKey, type ClientKind, type LoginChallenge, type LoginRequest, type LoginResponse, type Permission, type SessionUser, type TokenPair, tx, type ContactFinish, type ContactStart, type SessionRow } from '@tangent/contracts';
import { hashPassword, maskEmail, maskPhone, newTotpSecret, passwordNeedsRehash, randomCode, randomToken, seal, sha256, signJwt, totpUri, unseal, verifyPassword, verifyTotp, constantTimeEqual } from '@tangent/security';
import qrcode from 'qrcode-generator';
import { ENV, type Env } from '../env.js';
import { ApiError, Limiter, alert } from '@tangent/nest-kit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditService, Messenger, SettingsService } from '../school/support.js';
import { BUS_CREW_SQL } from '../school/transport.service.js';
import { REGISTRY, type TenantCtx } from '../tenancy/tenant.js';
import type { Registry } from '@tangent/tenancy';
import { checkCookieCsrf, clearSchoolRefreshCookie, schoolCookieToken, setSchoolRefreshCookie } from './session-cookies.js';

const ACCESS_SECONDS = 15 * 60;
// Wrong passwords hold back one address after a few, the whole account only after many from everywhere: someone who knows a
// principal's email cannot keep them locked out, and guessing from many addresses still stops.
const DEVICE_TRIES = 5;
const ACCOUNT_LOCK_AFTER = 30;
const LOCK_MINUTES = 15;
const deviceFails = new Limiter(DEVICE_TRIES, LOCK_MINUTES * 60_000);
// The sign-in budgets below hold on real servers; local runs and tests sign the same people in again and again.
const STRICT = process.env.NODE_ENV === 'production';
// Wrong codes one account may type in an hour, across every code it asked for and every address asking.
const CODE_FAILS_PER_ACCOUNT = 10;
/** Staff who can change these confirm sign-in with an authenticator app (security.staffAuthenticator). */
const AUTHENTICATOR_PERMS = ['settings.manage', 'staff.write', 'fees.refund'];
const OTP_TRIES = 3;
const OTP_MINUTES = 10;
// Each code has OTP_TRIES guesses, so the number of codes is what bounds guessing (and the SMS bill).
const OTP_SENDS = 5;
const OTP_WINDOW_MINUTES = 15;


interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  status: string;
  failed_logins: number;
  locked_until: Date | null;
  token_version: number;
}

let dummyHash: Promise<string> | undefined;

function clientOf(value: ClientKind | undefined): ClientKind {
  return value === 'web' ? 'web' : 'mobile';
}

interface Life { maxDays: number; idleDays: number }

function sessionExpiry(created: Date, life: Life): Date {
  return new Date(Math.min(Date.now() + life.idleDays * 86_400_000, created.getTime() + life.maxDays * 86_400_000));
}

/** A device in plain words from its user agent: the app on a phone, or a browser on a computer. */
export function deviceOf(ua: string | null): string {
  const a = ua ?? '';
  const os = /Android/i.test(a) ? 'Android' : /iPhone|iPad|iOS/i.test(a) ? 'iPhone or iPad' : /Windows/i.test(a) ? 'Windows' : /Mac OS|Macintosh/i.test(a) ? 'Mac' : /Linux/i.test(a) ? 'Linux' : '';
  const app = /Dart|okhttp|Tangent/i.test(a) ? 'Tangent app' : /Edg\//.test(a) ? 'Edge' : /Chrome\//.test(a) ? 'Chrome' : /Firefox\//.test(a) ? 'Firefox' : /Safari\//.test(a) ? 'Safari' : '';
  return [app, os].filter(Boolean).join(', ') || 'Unknown device';
}

/** A QR code as rows of 0 and 1 (1 dark), for the app to draw. */
export function qrRows(text: string): string[] {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => (q.isDark(r, c) ? '1' : '0')).join(''));
}

@Injectable()
export class AuthService {
  private readonly live = new Map<string, { at: number; ok: boolean }>();
  private readonly warned = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REGISTRY) private readonly registry: Registry,
    private readonly settings: SettingsService,
    private readonly messenger: Messenger,
    private readonly audit: AuditService,
  ) {}

  private get production(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** How long a sign-in lasts: set per school from the console (Security). A phone stays signed in while used. */
  private async life(t: TenantCtx, client: ClientKind): Promise<Life> {
    const v = (await this.settings.doc(t)).values;
    if (client === 'web') { const d = Number(v['security.webSessionDays'] ?? 7); return { maxDays: d, idleDays: d }; }
    const d = Number(v['security.appSessionDays'] ?? 30);
    return { maxDays: d, idleDays: Math.min(14, d) };
  }

  /** Step one: check the password. Returns a code challenge, or tokens when the school has two-step sign-in off. */
  async login(t: TenantCtx, body: LoginRequest, userAgent?: string, reply?: FastifyReply, ip = ''): Promise<LoginResponse> {
    const user = await this.findUser(t, body.identifier);
    const device = `${t.info.slug}|${user?.id ?? body.identifier.trim().toLowerCase()}|${ip}`;
    const lockedFor = user?.locked_until && user.locked_until > new Date() ? Math.ceil((user.locked_until.getTime() - Date.now()) / 1000) : 0;
    const wait = Math.max(deviceFails.wait(device), lockedFor);
    if (wait) throw new ApiError('locked', tx('Too many wrong attempts. Try again in {p0} minutes, or reset your password.', { p0: Math.ceil(wait / 60) }), { retryAfter: wait });
    dummyHash ??= hashPassword('not-a-real-password');
    const ok = await verifyPassword(body.password, user?.password_hash ?? (await dummyHash));
    if (!user || !ok || user.status !== 'active') {
      deviceFails.hit(device);
      if (user?.password_hash) {
        const failed = user.failed_logins + 1;
        const lock = failed >= ACCOUNT_LOCK_AFTER;
        await t.pool.query('update users set failed_logins = $2, locked_until = $3 where id = $1', [user.id, lock ? 0 : failed, lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null]);
        if (lock) this.warn(t, `lock:${user.id}`, `Sign-in: ${ACCOUNT_LOCK_AFTER} wrong passwords for one account at ${t.info.slug} from several addresses; it is locked for ${LOCK_MINUTES} minutes.`);
      }
      // One answer whether or not the account exists, so the sign-in page does not tell anyone who has one.
      throw new ApiError('unauthenticated', 'That email, phone or password isn’t right.', { fields: { password: 'Check your email or phone and your password.' } });
    }
    await t.pool.query('update users set failed_logins = 0, locked_until = null where id = $1', [user.id]);
    if (clientOf(body.client) === 'mobile') await this.mayUseApp(t, user);
    if (passwordNeedsRehash(user.password_hash)) {
      await t.pool.query('update users set password_hash = $2 where id = $1', [user.id, await hashPassword(body.password)]);
    }
    const app = await this.authenticatorStep(t, user);
    if (app) return { step: 'otp', challenge: app };
    const doc = await this.settings.doc(t);
    if (doc.values['security.twoFactor'] === false) {
      return { step: 'done', tokens: await this.issue(t, user.id, userAgent, clientOf(body.client), reply) };
    }
    return { step: 'otp', challenge: await this.sendCode(t, user, 'sign_in') };
  }

  /**
   * Staff with an authenticator always use it; staff who run the school (settings, staff, refunds) add one at their next sign-in,
   * unless the school turned that off. A text to a phone is not asked of them: whoever holds the number could pass it.
   */
  private async authenticatorStep(t: TenantCtx, user: UserRow & { kind: string }): Promise<LoginChallenge | null> {
    if (user.kind !== 'staff') return null;
    if (user.totp_secret) return this.authenticatorChallenge(t, user.id, null);
    if ((await this.settings.doc(t)).values['security.staffAuthenticator'] === false) return null;
    const { permissions } = await this.sessionUser(t, user.id);
    if (!permissions.some((p) => AUTHENTICATOR_PERMS.includes(p))) return null;
    return this.authenticatorChallenge(t, user.id, { secret: newTotpSecret(), account: user.email ?? user.phone ?? user.name });
  }

  private async authenticatorChallenge(t: TenantCtx, userId: string, enroll: { secret: string; account: string } | null): Promise<LoginChallenge> {
    const id = newId('otp');
    await t.pool.query("insert into otp_challenges (id, user_id, code_hash, channel, purpose, method, pending_secret, expires_at) values ($1,$2,'','app','sign_in',$3,$4,$5)",
      [id, userId, enroll ? 'enroll' : 'app', enroll ? seal(enroll.secret, this.env.SECRETS_KEY) : null, new Date(Date.now() + OTP_MINUTES * 60_000)]);
    return {
      challengeId: id, channel: 'app', maskedTo: tx('your authenticator app'), expiresInSeconds: OTP_MINUTES * 60,
      ...(enroll ? { enroll: (() => { const uri = totpUri(enroll.secret, `${enroll.account} (${t.info.shortName})`); return { secret: enroll.secret, uri, qr: qrRows(uri) }; })() } : {}),
    };
  }

  /** What an unknown phone or email gets: the same answer as a real one, with no code sent, so no one learns who has an account. */
  private decoy(identifier: string): LoginChallenge {
    const v = identifier.trim();
    const email = v.includes('@');
    return { challengeId: newId('otp'), channel: email ? 'email' : 'sms', maskedTo: email ? maskEmail(v) : maskPhone(v), expiresInSeconds: OTP_MINUTES * 60, resendInSeconds: 30 };
  }

  /** Tells Tangent once an hour per school and reason, so a flood of guesses is seen without a flood of alerts. */
  private warn(t: TenantCtx, reason: string, text: string): void {
    const key = `${t.info.slug}|${reason}`;
    if ((this.warned.get(key) ?? 0) > Date.now() - 3600_000) return;
    this.warned.set(key, Date.now());
    alert(text);
  }

  /** How many codes a school may send, and how many wrong codes it takes, in an hour: enough for every family to sign in. */
  private async budget(t: TenantCtx): Promise<{ sends: number; fails: number }> {
    const n = Number((await t.pool.query<{ n: string }>("select count(*) n from users where status = 'active'")).rows[0]!.n);
    return { sends: 50 + Math.ceil(n / 2), fails: 30 + Math.ceil(n / 10) };
  }

  /** Families sign in with a code to their phone (or email). Staff are sent back to their password. */
  async requestCode(t: TenantCtx, identifier: string): Promise<LoginChallenge> {
    const user = await this.findUser(t, identifier);
    if (!user || user.status !== 'active') return this.decoy(identifier);
    if (user.kind === 'staff') throw new ApiError('validation', 'Staff sign in with their password, then a code.', { fields: { identifier: 'Staff sign in with their password.' } });
    // Whether the school lets this person use the app is said once the code proves the phone is theirs (verify).
    return this.sendCode(t, user, 'sign_in');
  }

  /** The app role a person signs in as: guardians are parents, students students, staff who drive a route drivers, other staff teachers. */
  async appRole(t: TenantCtx, user: { id: string; kind: string }): Promise<AppRoleKey> {
    if (user.kind === 'guardian') return 'parent';
    if (user.kind === 'student') return 'student';
    const { rowCount } = await t.pool.query(BUS_CREW_SQL, [user.id]);
    return rowCount ? 'driver' : 'teacher';
  }

  /** The console chooses which roles use the app (`app.roles`); anyone else is told plainly where to go instead. */
  private async mayUseApp(t: TenantCtx, user: { id: string; kind: string }): Promise<void> {
    const role = await this.appRole(t, user);
    const roles = (await this.settings.doc(t)).values['app.roles'];
    if (Array.isArray(roles) && roles.includes(role)) return;
    throw new ApiError('forbidden', role === 'teacher' || role === 'driver'
      ? 'Your school does not use the app for staff yet. Sign in to the school’s admin on the web instead.'
      : role === 'student' ? 'Your school does not use the app for students. A parent can sign in instead.' : 'Your school does not use the app for families yet. The school office can tell you when it does.');
  }

  /** "Forgot it?": a code to the person's phone or email lets them choose a new password. */
  async resetStart(t: TenantCtx, identifier: string): Promise<LoginChallenge> {
    const user = await this.findUser(t, identifier);
    if (!user || user.status !== 'active') return this.decoy(identifier);
    return this.sendCode(t, user, 'reset');
  }

  /** A signed-in person changes their password: the current one first; every other device is signed out, this one stays. */
  async changePassword(t: TenantCtx, user: { id: string; sid: string }, current: string, next: string): Promise<void> {
    const u = (await t.pool.query<{ password_hash: string | null }>('select password_hash from users where id = $1', [user.id])).rows[0];
    if (!u?.password_hash || !(await verifyPassword(current, u.password_hash))) throw new ApiError('validation', 'That is not your current password.', { fields: { current: 'Not your current password.' } });
    const min = Number((await this.settings.doc(t)).values['security.passwordMinLength'] ?? 8);
    if (next.length < min) throw new ApiError('validation', tx('Use at least {min} characters.', { min }), { fields: { next: tx('At least {min} characters.', { min }) } });
    if (next === current) throw new ApiError('validation', 'Choose a password you have not used here.', { fields: { next: 'The same as now.' } });
    await t.pool.query('update users set password_hash = $2 where id = $1', [user.id, await hashPassword(next)]);
    await t.pool.query('update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [user.id, user.sid]);
    await this.bumpVersion(t, user.id);
  }

  async resetFinish(t: TenantCtx, challengeId: string, code: string, password: string): Promise<void> {
    const min = Number((await this.settings.doc(t)).values['security.passwordMinLength'] ?? 8);
    if (password.length < min) throw new ApiError('validation', tx('Use at least {min} characters.', { min }), { fields: { password: tx('At least {min} characters.', { min }) } });
    const userId = await this.useCode(t, challengeId, code, 'reset');
    await t.pool.query('update users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1', [userId, await hashPassword(password)]);
    // A new password ends every session, on every device.
    await t.pool.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
    await this.bumpVersion(t, userId);
    await this.audit.record(t, { actorId: userId, actorName: 'self', action: 'auth.password_reset', entity: 'user', entityId: userId });
  }

  async verify(t: TenantCtx, challengeId: string, code: string, userAgent?: string, client?: ClientKind, reply?: FastifyReply): Promise<TokenPair> {
    const userId = await this.useCode(t, challengeId, code, 'sign_in');
    if (clientOf(client) === 'mobile') {
      const u = (await t.pool.query<{ id: string; kind: string }>('select id, kind from users where id = $1', [userId])).rows[0]!;
      await this.mayUseApp(t, u);
    }
    return this.issue(t, userId, userAgent, clientOf(client), reply);
  }

  private async findUser(t: TenantCtx, identifier: string): Promise<(UserRow & { kind: string }) | undefined> {
    const ident = identifier.trim();
    const byEmail = ident.includes('@');
    const digits = ident.replace(/\D/g, '');
    if (!byEmail && digits.length < 8) return undefined;
    const { rows } = await t.pool.query<UserRow & { kind: string }>(
      byEmail
        ? 'select id, name, email, phone, password_hash, totp_secret, status, failed_logins, locked_until, token_version, kind from users where lower(email) = $1 limit 1'
        : 'select id, name, email, phone, password_hash, totp_secret, status, failed_logins, locked_until, token_version, kind from users where phone = $1 limit 1',
      // A number typed locally takes the school's country; one with + or 00 is taken as it is.
      [byEmail ? ident.toLowerCase() : toE164(ident, t.info.country) ?? `+${digits}`],
    );
    return rows[0];
  }

  private async sendCode(t: TenantCtx, user: { id: string; phone: string | null; email: string | null }, purpose: 'sign_in' | 'reset' | 'contact', target?: { channel: 'sms' | 'email'; to: string }): Promise<LoginChallenge> {
    const { rows: [r] } = await t.pool.query<{ n: string; first: Date | null; last: Date | null }>(
      `select count(*) n, min(created_at) first, max(created_at) last from otp_challenges where user_id = $1 and method = 'code' and created_at > now() - interval '${OTP_WINDOW_MINUTES} minutes'`, [user.id]);
    if (Number(r!.n) >= OTP_SENDS) {
      const retryAfter = Math.max(60, Math.ceil((r!.first!.getTime() + OTP_WINDOW_MINUTES * 60_000 - Date.now()) / 1000));
      throw new ApiError('rate_limited', tx('Too many codes sent. Try again in {p0} minutes.', { p0: Math.ceil(retryAfter / 60) }), { retryAfter });
    }
    // The wait before another code (30 seconds, longer after each) is the server's, not only the screen's.
    const gap = r!.last ? Math.ceil((r!.last.getTime() + 30_000 * Number(r!.n) - Date.now()) / 1000) : 0;
    if (STRICT && gap > 0) throw new ApiError('rate_limited', tx('Wait {p0} seconds before asking for another code.', { p0: gap }), { retryAfter: gap });
    if (STRICT) {
      // The school's own budget for the hour, whoever asks and from wherever: it bounds the text-message bill.
      const sent = Number((await t.pool.query<{ n: string }>("select count(*) n from otp_challenges where method = 'code' and created_at > now() - interval '1 hour'")).rows[0]!.n);
      if (sent >= (await this.budget(t)).sends) {
        this.warn(t, 'sends', `Sign-in: ${t.info.slug} sent ${sent} codes in the last hour, its limit. New codes wait until the hour has passed.`);
        throw new ApiError('rate_limited', 'Your school has sent a lot of sign-in codes in the last hour. Try again in a little while.', { retryAfter: 900 });
      }
    }
    const sends = Number(r!.n) + 1;
    const code = randomCode(6);
    const id = newId('otp');
    const channel: 'sms' | 'email' = target?.channel ?? (user.phone ? 'sms' : 'email');
    const to = target?.to ?? (channel === 'sms' ? user.phone : user.email) ?? '';
    await t.pool.query('insert into otp_challenges (id, user_id, code_hash, channel, purpose, expires_at, target) values ($1,$2,$3,$4,$5,$6,$7)', [id, user.id, sha256(`${id}:${code}`), channel, purpose, new Date(Date.now() + OTP_MINUTES * 60_000), target?.to ?? null]);
    const what = purpose === 'reset' ? 'code to set a new password' : purpose === 'contact' ? 'code to confirm this address' : 'sign-in code';
    try {
      // Sent now (never queued or held): the person is waiting on the sign-in screen.
      await this.messenger.send(t, {
        channel, to, subject: channel === 'email' ? `Your Tangent ${what}` : undefined,
        body: `Your Tangent ${what} for ${t.info.shortName} is ${code}. It expires in ${OTP_MINUTES} minutes.`,
        key: purpose === 'reset' ? 'auth.reset' : 'auth.code', vars: { code, school: t.info.shortName, minutes: String(OTP_MINUTES) }, now: true,
      });
    } catch {
      throw new ApiError('school_unavailable', 'We could not send the code just now. Try again in a minute.');
    }
    // Another code after a short wait; the last one allowed in the window waits for the window to end.
    const resendInSeconds = sends >= OTP_SENDS ? OTP_WINDOW_MINUTES * 60 : 30 * Math.max(1, sends);
    return {
      challengeId: id, channel, maskedTo: channel === 'sms' ? maskPhone(to) : maskEmail(to),
      expiresInSeconds: OTP_MINUTES * 60, resendInSeconds,
    };
  }

  /** A new phone number or email for one's own account: free (no one else has it), then confirmed by a code sent to it. */
  async startContact(t: TenantCtx, userId: string, b: ContactStart): Promise<LoginChallenge> {
    const u = (await t.pool.query<{ id: string; phone: string | null; email: string | null }>("select id, phone, email from users where id = $1 and status = 'active'", [userId])).rows[0];
    if (!u) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    const to = b.phone ? this.settings.phone(t, b.phone, 'phone') : b.email!.toLowerCase();
    if (to === (b.phone ? u.phone : u.email?.toLowerCase())) throw new ApiError('validation', tx('That is already yours.'), { fields: { [b.phone ? 'phone' : 'email']: tx('That is already yours.') } });
    const taken = await t.pool.query(b.phone ? 'select 1 from users where phone = $1 and id <> $2' : 'select 1 from users where lower(email) = $1 and id <> $2', [to, userId]);
    if (taken.rowCount) throw new ApiError('conflict', tx('Another account at the school has it. Ask the school office.'), { fields: { [b.phone ? 'phone' : 'email']: tx('Already in use.') } });
    return this.sendCode(t, u, 'contact', { channel: b.phone ? 'sms' : 'email', to });
  }

  /** The code from the new address: the account (and, for a parent, the family's record the school messages) takes it. */
  async finishContact(t: TenantCtx, userId: string, b: ContactFinish): Promise<void> {
    const who = await this.useCode(t, b.challengeId, b.code, 'contact');
    if (who !== userId) throw new ApiError('unauthenticated', 'That code has expired. Go back and ask for a new one.', { fields: { code: 'That code has expired.' } });
    const c = (await t.pool.query<{ channel: 'sms' | 'email'; target: string }>('select channel, target from otp_challenges where id = $1', [b.challengeId])).rows[0]!;
    const col = c.channel === 'sms' ? 'phone' : 'email';
    // Checked again: someone may have taken it while the code was on its way.
    if ((await t.pool.query(`select 1 from users where ${col === 'phone' ? 'phone = $1' : 'lower(email) = $1'} and id <> $2`, [c.target, userId])).rowCount) {
      throw new ApiError('conflict', tx('Another account at the school has it. Ask the school office.'));
    }
    await t.pool.query(`update users set ${col} = $2 where id = $1`, [userId, c.target]);
    await t.pool.query(`update guardians set ${col} = $2 where user_id = $1`, [userId, c.target]);
    await this.audit.record(t, { actorId: userId, actorName: 'self', action: `account.${col}`, entity: 'user', entityId: userId });
  }

  /** Where this person is signed in, newest first; the one asking is marked. */
  async sessions(t: TenantCtx, userId: string, current: string | undefined): Promise<SessionRow[]> {
    const { rows } = await t.pool.query<{ id: string; client: string | null; user_agent: string | null; created_at: Date }>(
      'select id, client, user_agent, created_at from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by created_at desc limit 50', [userId]);
    return rows.map((r) => ({ id: r.id, client: r.client ?? 'web', device: deviceOf(r.user_agent), since: r.created_at.toISOString(), current: r.id === current }));
  }

  /** Signs one of them out (not the one asking: that is sign out). */
  async endSession(t: TenantCtx, userId: string, id: string, current: string | undefined): Promise<void> {
    if (id === current) throw new ApiError('validation', tx('This is the device you are on: sign out instead.'));
    const r = await t.pool.query('update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null', [id, userId]);
    if (!r.rowCount) throw new ApiError('not_found', tx('That device is already signed out.'));
  }

  /** Checks a code for one purpose and spends it: a texted code, or one from the person's authenticator app. Returns the user it belongs to. */
  private async useCode(t: TenantCtx, challengeId: string, code: string, purpose: 'sign_in' | 'reset' | 'contact'): Promise<string> {
    const { rows } = await t.pool.query<{ id: string; user_id: string; code_hash: string; attempts: number; expires_at: Date; used_at: Date | null; purpose: string; method: string; pending_secret: string | null; totp_secret: string | null; totp_last: string | null }>(
      `select o.id, o.user_id, o.code_hash, o.attempts, o.expires_at, o.used_at, o.purpose, o.method, o.pending_secret, u.totp_secret, u.totp_last
       from otp_challenges o join users u on u.id = o.user_id where o.id = $1`, [challengeId]);
    const row = rows[0];
    if (!row || row.purpose !== purpose || row.used_at || row.expires_at < new Date()) throw new ApiError('unauthenticated', 'That code has expired. Go back and ask for a new one.', { fields: { code: 'That code has expired.' } });
    if (row.attempts >= OTP_TRIES) throw new ApiError('locked', 'Too many wrong codes. Go back and ask for a new one.');
    // Guessing is bounded per account and per school, across every code asked for and from every address.
    if (STRICT) {
      const r = (await t.pool.query<{ mine: string; all: string }>(
        "select coalesce(sum(attempts) filter (where user_id = $1), 0) mine, coalesce(sum(attempts), 0) \"all\" from otp_challenges where created_at > now() - interval '1 hour'", [row.user_id])).rows[0]!;
      if (Number(r.mine) >= CODE_FAILS_PER_ACCOUNT) throw new ApiError('locked', 'Too many wrong codes for this account. Try again in an hour.', { retryAfter: 3600 });
      if (Number(r.all) >= (await this.budget(t)).fails) {
        this.warn(t, 'fails', `Sign-in: ${r.all} wrong codes at ${t.info.slug} in the last hour. Code sign-in waits until the hour has passed.`);
        throw new ApiError('locked', 'Too many wrong codes at your school just now. Try again in a little while.', { retryAfter: 900 });
      }
    }
    // A try is taken before the code is checked, in one step: many guesses sent at once cannot all slip under the limit.
    const took = await t.pool.query('update otp_challenges set attempts = attempts + 1 where id = $1 and used_at is null and attempts < $2', [challengeId, OTP_TRIES]);
    if (!took.rowCount) throw new ApiError('locked', 'Too many wrong codes. Go back and ask for a new one.');
    let good: boolean;
    if (row.method === 'code') good = constantTimeEqual(sha256(`${challengeId}:${code}`), row.code_hash);
    else {
      // An authenticator code is good for about 90 seconds; one already used in that time is refused, so it cannot be replayed.
      const [lastCode, lastAt] = (row.totp_last ?? '').split('@');
      const replay = lastCode === code && Date.now() / 1000 - Number(lastAt) < 120;
      const secret = row.method === 'enroll' ? row.pending_secret : row.totp_secret;
      good = !replay && !!secret && verifyTotp(unseal(secret, this.env.SECRETS_KEY), code);
    }
    if (!good) throw new ApiError('unauthenticated', 'That code isn’t right.', { attemptsLeft: Math.max(0, OTP_TRIES - row.attempts - 1), fields: { code: 'That code isn’t right.' } });
    // Spent once: two sign-ins with the same right code cannot both get in. A right code is not counted as a wrong try.
    const spent = await t.pool.query('update otp_challenges set used_at = now(), attempts = attempts - 1 where id = $1 and used_at is null', [challengeId]);
    if (!spent.rowCount) throw new ApiError('unauthenticated', 'That code has expired. Go back and ask for a new one.', { fields: { code: 'That code has expired.' } });
    if (row.method !== 'code') {
      await t.pool.query('update users set totp_last = $2, totp_secret = coalesce($3, totp_secret) where id = $1', [row.user_id, `${code}@${Math.floor(Date.now() / 1000)}`, row.method === 'enroll' ? row.pending_secret : null]);
      if (row.method === 'enroll') await this.audit.record(t, { actorId: row.user_id, actorName: 'self', action: 'auth.authenticator_added', entity: 'user', entityId: row.user_id });
    }
    return row.user_id;
  }

  async refresh(t: TenantCtx, refreshToken: string | undefined, req: FastifyRequest, reply?: FastifyReply): Promise<TokenPair> {
    const cookie = schoolCookieToken(req, t.info.slug, this.production);
    const raw = refreshToken || cookie;
    if (cookie && !refreshToken) checkCookieCsrf(req, this.env.CORS_ORIGINS);
    if (!raw) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    const [sid, secret] = raw.split('.');
    const { rows } = await t.pool.query<{ id: string; user_id: string; refresh_hash: string; expires_at: Date; revoked_at: Date | null; created_at: Date; client: string }>(
      'select id, user_id, refresh_hash, expires_at, revoked_at, created_at, client from sessions where id = $1', [sid ?? '']);
    const s = rows[0];
    if (!s || !secret || s.revoked_at || s.expires_at < new Date()) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    const kind = (s.client === 'mobile' ? 'mobile' : 'web') as ClientKind;
    const life = await this.life(t, kind);
    const maxEnd = s.created_at.getTime() + life.maxDays * 86_400_000;
    if (Date.now() > maxEnd) {
      await t.pool.query('update sessions set revoked_at = now() where id = $1', [s.id]);
      throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    }
    if (!constantTimeEqual(sha256(secret), s.refresh_hash)) {
      await t.pool.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [s.user_id]);
      await this.bumpVersion(t, s.user_id);
      await this.audit.record(t, { actorId: s.user_id, actorName: 'session', action: 'auth.refresh_replayed', entity: 'user', entityId: s.user_id });
      throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    }
    const next = randomToken(32);
    const expires = sessionExpiry(s.created_at, life);
    await t.pool.query('update sessions set refresh_hash = $2, expires_at = $3 where id = $1', [s.id, sha256(next), expires]);
    this.dropLive(t.info.slug, s.id);
    return this.tokens(t, s.user_id, s.id, `${s.id}.${next}`, kind, reply);
  }

  async logout(t: TenantCtx, sid: string, req?: FastifyRequest, reply?: FastifyReply): Promise<void> {
    if (req && schoolCookieToken(req, t.info.slug, this.production)) checkCookieCsrf(req, this.env.CORS_ORIGINS);
    await t.pool.query('update sessions set revoked_at = now() where id = $1', [sid]);
    this.dropLive(t.info.slug, sid);
    if (reply) clearSchoolRefreshCookie(reply, this.production, t.info.slug);
  }

  async logoutAll(t: TenantCtx, userId: string, req?: FastifyRequest, reply?: FastifyReply): Promise<void> {
    if (req && schoolCookieToken(req, t.info.slug, this.production)) checkCookieCsrf(req, this.env.CORS_ORIGINS);
    await t.pool.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
    await this.bumpVersion(t, userId);
    if (reply) clearSchoolRefreshCookie(reply, this.production, t.info.slug);
  }

  async me(t: TenantCtx, userId: string): Promise<SessionUser> {
    return this.sessionUser(t, userId);
  }

  async assertSession(t: TenantCtx, sid: string, ver: number | undefined, userId: string): Promise<void> {
    const key = `${t.info.slug}:${sid}:${ver ?? 0}`;
    const hit = this.live.get(key);
    if (hit && Date.now() - hit.at < 30_000) {
      if (!hit.ok) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
      return;
    }
    const { rows } = await t.pool.query<{ revoked_at: Date | null; token_version: number; status: string; user_id: string }>(
      'select s.revoked_at, u.token_version, u.status, u.id as user_id from sessions s join users u on u.id = s.user_id where s.id = $1',
      [sid],
    );
    const row = rows[0];
    const ok = !!row && !row.revoked_at && row.status === 'active' && row.user_id === userId && row.token_version === (ver ?? 0);
    this.live.set(key, { at: Date.now(), ok });
    if (this.live.size > 20_000) for (const [k, v] of this.live) if (Date.now() - v.at > 30_000) this.live.delete(k);
    if (!ok) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
  }

  /** A support session (from the console) is still open: not ended early, not past its time. */
  async assertSupport(sid: string): Promise<void> {
    const key = `support:${sid}`;
    const hit = this.live.get(key);
    let ok = hit && Date.now() - hit.at < 30_000 ? hit.ok : undefined;
    if (ok === undefined) {
      ok = !!(await this.registry.pool.query("select 1 from support_sessions where id = $1 and status = 'active' and expires_at > now()", [sid])).rowCount;
      this.live.set(key, { at: Date.now(), ok });
    }
    if (!ok) throw new ApiError('unauthenticated', 'This support session has ended.');
  }

  async bumpVersion(t: TenantCtx, userId: string): Promise<void> {
    await t.pool.query('update users set token_version = token_version + 1 where id = $1', [userId]);
    this.dropLiveUser(t.info.slug, userId);
  }

  async bumpVersionForRole(t: TenantCtx, roleId: string): Promise<void> {
    await t.pool.query(
      'update users set token_version = token_version + 1 where id in (select user_id from user_roles where role_id = $1)',
      [roleId],
    );
    for (const k of [...this.live.keys()]) if (k.startsWith(`${t.info.slug}:`)) this.live.delete(k);
  }

  private dropLive(slug: string, sid: string): void {
    for (const k of [...this.live.keys()]) if (k.startsWith(`${slug}:${sid}:`)) this.live.delete(k);
  }

  private dropLiveUser(slug: string, _userId: string): void {
    for (const k of [...this.live.keys()]) if (k.startsWith(`${slug}:`)) this.live.delete(k);
  }

  private async issue(t: TenantCtx, userId: string, userAgent: string | undefined, client: ClientKind, reply?: FastifyReply): Promise<TokenPair> {
    const sid = newId('ses');
    const secret = randomToken(32);
    const created = new Date();
    await t.pool.query(
      'insert into sessions (id, user_id, refresh_hash, user_agent, client, expires_at) values ($1,$2,$3,$4,$5,$6)',
      [sid, userId, sha256(secret), userAgent?.slice(0, 200) ?? null, client, sessionExpiry(created, await this.life(t, client))],
    );
    await t.pool.query('update users set last_login_at = now() where id = $1', [userId]);
    const pair = await this.tokens(t, userId, sid, `${sid}.${secret}`, client, reply);
    await this.audit.record(t, { actorId: userId, actorName: pair.user.name, action: 'auth.signed_in', entity: 'user', entityId: userId });
    return pair;
  }

  private async tokens(t: TenantCtx, userId: string, sid: string, refreshToken: string, client: ClientKind, reply?: FastifyReply): Promise<TokenPair> {
    const user = await this.sessionUser(t, userId);
    const { rows } = await t.pool.query<{ token_version: number; kind: string }>('select token_version, kind from users where id = $1', [userId]);
    const ver = rows[0]?.token_version ?? 0;
    const accessToken = signJwt(
      { sub: userId, aud: t.info.slug, sid, name: user.name, perms: user.permissions, ver, kind: rows[0]?.kind },
      this.env.JWT_SECRET,
      ACCESS_SECONDS,
    );
    const maxAge = Math.max(60, Math.floor((sessionExpiry(new Date(), await this.life(t, client)).getTime() - Date.now()) / 1000));
    if (client === 'web' && reply) {
      setSchoolRefreshCookie(reply, { production: this.production, slug: t.info.slug, token: refreshToken, maxAge });
      return { accessToken, expiresInSeconds: ACCESS_SECONDS, user };
    }
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_SECONDS, user };
  }

  private async sessionUser(t: TenantCtx, userId: string): Promise<SessionUser> {
    const { rows } = await t.pool.query<{ id: string; name: string; email: string | null; phone: string | null; key: string | null; role_name: string | null; permissions: string[] | null }>(
      `select u.id, u.name, u.email, u.phone, r.key, r.name as role_name, r.permissions
       from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id where u.id = $1`, [userId]);
    const first = rows[0];
    if (!first) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    const perms = new Set<string>();
    rows.forEach((r) => r.permissions?.forEach((p) => perms.add(p)));
    return {
      id: first.id, name: first.name, email: first.email, phone: first.phone, initials: initials(first.name),
      roles: rows.map((r) => r.key).filter((x): x is string => !!x), roleNames: rows.map((r) => r.role_name).filter((x): x is string => !!x),
      permissions: [...perms] as Permission[],
    };
  }
}
