import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { brevo } from './providers/email.js';
import { customHttp } from './providers/generic.js';
import { razorpay } from './providers/payments.js';
import { checkoutCom, gocardless, nagerDate, stripe, vonage } from './providers/regional.js';
import { keepsValues } from './providers/translation.js';
import { metaCloud } from './providers/whatsapp.js';
import { readLink, signLink } from './token.js';
import { e164, fill, segments, type Ctx } from './types.js';

const ctx = (settings: Record<string, unknown> = {}, secrets: Record<string, string> = {}): Ctx =>
  ({ connectionId: 'con_1', settings, secrets, route: {}, pool: { query: async () => ({ rows: [], rowCount: 0 }) }, schoolSlug: 'greenfield', baseUrl: 'http://x', signKey: 'k'.repeat(32) });
const req = (body: string, headers: Record<string, string> = {}, query: Record<string, string> = {}) => ({ raw: Buffer.from(body), headers, query });

describe('message helpers', () => {
  it('counts SMS parts the way carriers bill them', () => {
    expect(segments('a'.repeat(160))).toBe(1);
    expect(segments('a'.repeat(161))).toBe(2);
    expect(segments('क'.repeat(70))).toBe(1);
    expect(segments('क'.repeat(71))).toBe(2);
  });
  it('fills placeholders, escaping for JSON bodies', () => {
    expect(fill('Hi {name}, {vars.code}', { name: 'Asha', code: '42' })).toBe('Hi Asha, 42');
    expect(fill('{"t":"{text}"}', { text: 'say "hi"' }, true)).toBe('{"t":"say \\"hi\\""}');
    expect(fill('{missing}', {})).toBe('{missing}');
    expect(e164('+91 98220 11002')).toBe('919822011002');
  });
  it('signs links that expire and cannot be forged', () => {
    const t = signLink('key', { p: 'get', key: 'a' }, 60);
    expect(readLink('key', t)).toMatchObject({ p: 'get', key: 'a' });
    expect(readLink('other', t)).toBeNull();
    expect(readLink('key', `${t.split('.')[0]}x.${t.split('.')[1]}`)).toBeNull();
    expect(readLink('key', signLink('key', { p: 'get' }, -1))).toBeNull();
  });
});

describe('webhooks', () => {
  it('accepts a Razorpay payment only with the right signature', async () => {
    const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment: { entity: { id: 'pay_1', amount: 120000, method: 'upi' } }, payment_link: { entity: { reference_id: 'greenfield:ord_1' } } } });
    const c = ctx({}, { webhookSecret: 'whsec' });
    const bad = await razorpay.inbound!(c, req(body, { 'x-razorpay-signature': 'nope' }));
    expect(bad.ok).toBe(false);
    expect(bad.reply?.status).toBe(401);
    const good = await razorpay.inbound!(c, req(body, { 'x-razorpay-signature': createHmac('sha256', 'whsec').update(body).digest('hex') }));
    expect(good.payments).toEqual([{ kind: 'paid', reference: 'greenfield:ord_1', providerPaymentId: 'pay_1', amountMinor: 120000, method: 'upi' }]);
  });
  it('answers Meta’s verify challenge and checks its signature', async () => {
    const c = ctx({ verifyToken: 'vt' }, { appSecret: 'app' });
    expect((await metaCloud.inbound!(c, req('', {}, { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '123' }))).reply).toEqual({ status: 200, body: '123' });
    expect((await metaCloud.inbound!(c, req('', {}, { 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': '123' }))).reply?.status).toBe(403);
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }] });
    expect((await metaCloud.inbound!(c, req(body, { 'x-hub-signature-256': 'sha256=bad' }))).ok).toBe(false);
    const ok = await metaCloud.inbound!(c, req(body, { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'app').update(body).digest('hex')}` }));
    expect(ok.deliveries).toEqual([{ providerId: 'wamid.1', status: 'read', error: undefined }]);
  });
  it('reads a custom provider’s delivery reports through its mapping', async () => {
    const c = ctx({ statusWebhook: true, statusIdPath: 'msg.id', statusPath: 'state', statusMap: '{"DELIVRD":"delivered","UNDELIV":"failed"}' });
    const r = await customHttp.inbound!(c, req(JSON.stringify([{ msg: { id: 'a' }, state: 'DELIVRD' }, { msg: { id: 'b' }, state: 'UNDELIV' }, { msg: { id: 'c' }, state: 'WEIRD' }])));
    expect(r.deliveries).toEqual([{ providerId: 'a', status: 'delivered' }, { providerId: 'b', status: 'failed' }]);
  });
});

describe('translation drafts', () => {
  it('keeps a draft only when its values and words are all still there', () => {
    expect(keepsValues('Add {name} to {@class}', 'Ajouter {name} à {@class}')).toBe(true);
    expect(keepsValues('Add {name} to {@class}', 'Ajouter {nom} à {@class}')).toBe(false);
    expect(keepsValues('{n, plural, one {# book} other {# books}}', '{n, plural, one {# livre} many {# livres} other {# livres}}')).toBe(true);
    expect(keepsValues('Save', '')).toBe(false);
    // The app's own placeholders.
    expect(keepsValues('@n files from @name', '@name के @n फ़ाइल')).toBe(true);
    expect(keepsValues('@n files from @name', '@n फ़ाइल')).toBe(false);
  });
});

describe('regional providers', () => {
  it('accepts a Stripe payment only when signed in the last five minutes', async () => {
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'greenfield:ord_1', payment_intent: 'pi_1', amount_total: 4500, payment_status: 'paid', payment_method_types: ['card'] } } });
    const c = ctx({}, { webhookSecret: 'whsec_x' });
    const sign = (t: number) => `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    expect((await stripe.inbound!(c, req(body, { 'stripe-signature': sign(now - 600) }))).ok).toBe(false);
    expect((await stripe.inbound!(c, req(body, { 'stripe-signature': 't=1,v1=nope' }))).ok).toBe(false);
    const good = await stripe.inbound!(c, req(body, { 'stripe-signature': sign(now) }));
    expect(good.payments).toEqual([{ kind: 'paid', reference: 'greenfield:ord_1', providerPaymentId: 'pi_1', amountMinor: 4500, method: 'card' }]);
    // An unpaid session (a bank debit still clearing) is not a payment yet.
    const pending = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'unpaid', amount_total: 100 } } });
    const t = now;
    expect((await stripe.inbound!(c, req(pending, { 'stripe-signature': `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${pending}`).digest('hex')}` }))).payments).toEqual([]);
  });
  it('checks Checkout.com and GoCardless signatures', async () => {
    const body = JSON.stringify({ type: 'payment_captured', data: { id: 'pay_1', reference: 'greenfield:ord_2', amount: 12500 } });
    const c = ctx({}, { webhookSecret: 'sec' });
    expect((await checkoutCom.inbound!(c, req(body, { 'cko-signature': 'nope' }))).ok).toBe(false);
    expect((await checkoutCom.inbound!(c, req(body, { 'cko-signature': createHmac('sha256', 'sec').update(body).digest('hex') }))).payments)
      .toEqual([{ kind: 'paid', reference: 'greenfield:ord_2', providerPaymentId: 'pay_1', amountMinor: 12500, method: 'card' }]);
    const gc = JSON.stringify({ events: [] });
    expect((await gocardless.inbound!(c, req(gc, { 'webhook-signature': 'nope' }))).ok).toBe(false);
    expect((await gocardless.inbound!(c, req(gc, { 'webhook-signature': createHmac('sha256', 'sec').update(gc).digest('hex') }))).ok).toBe(true);
  });
  it('reads a Vonage delivery receipt', async () => {
    const r = await vonage.inbound!(ctx(), req('', {}, { messageId: 'm1', status: 'delivered', 'err-code': '0' }));
    expect(r.deliveries).toEqual([{ providerId: 'm1', status: 'delivered', error: undefined }]);
  });
});

describe('public holidays', () => {
  it('keeps the nationwide ones and treats an unknown country as none', async () => {
    const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(body === null ? '' : JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', reply([{ date: '2026-12-25', name: 'Christmas Day', global: true }, { date: '2026-03-17', name: 'Saint Patrick’s Day', global: false, counties: ['GB-NIR'] }]));
    expect(await nagerDate.holidays!(ctx(), 'GB', 2026)).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }]);
    vi.stubGlobal('fetch', reply({ title: 'Not Found' }, 404));
    expect(await nagerDate.holidays!(ctx(), 'ZZ', 2026)).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('Brevo', () => {
  it('sends with the key in its header and the sender named as the From says', async () => {
    const sent = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ messageId: '<m1@brevo>' }), { status: 201 }));
    vi.stubGlobal('fetch', sent);
    const c = ctx({ from: 'Sunrise Valley <office@sunrisevalley.example>' }, { apiKey: 'xkeysib-abc' });
    const r = await brevo.email!(c, { to: 'parent@example.org', subject: 'Fees', text: 'A fee is due.', vars: {}, messageKey: 'fees.reminder' });
    expect(r.providerId).toBe('<m1@brevo>');
    const [url, init] = sent.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init!.headers as Record<string, string>)['api-key']).toBe('xkeysib-abc');
    expect(JSON.parse(String(init!.body))).toMatchObject({ sender: { name: 'Sunrise Valley', email: 'office@sunrisevalley.example' }, to: [{ email: 'parent@example.org' }], subject: 'Fees', textContent: 'A fee is due.' });
    vi.unstubAllGlobals();
  });
});
