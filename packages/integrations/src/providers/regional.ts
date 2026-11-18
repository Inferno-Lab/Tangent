import { createHmac, timingSafeEqual } from 'node:crypto';
import { basic, call, form } from '../http.js';
import { ProviderError, e164, segments, type Adapter, type Ctx, type InboundRequest, type OutMessage, type PaymentEvent } from '../types.js';
import { currencyDigits } from '@tangent/contracts';

// Payment, text and email providers for schools outside India (one-shot plan 3.4.5): each region's pack suggests its own.

const s = (c: Ctx, k: string) => String(c.route[k] ?? c.settings[k] ?? '');
const header = (r: InboundRequest, k: string) => { const v = r.headers[k]; return Array.isArray(v) ? v[0] : v; };
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (r: InboundRequest): any => { try { return JSON.parse(r.raw.toString('utf8')); } catch { return null; } };
const fail = (e: unknown) => ({ ok: false, detail: (e as Error).message });
/** An amount in the currency's smallest unit as the decimal string some providers want ("12.50"). */
const decimal = (minor: number, currency: string) => { const d = currencyDigits(currency); return (minor / 10 ** d).toFixed(d); };
const minorOf = (value: string | number, currency: string) => Math.round(Number(value) * 10 ** currencyDigits(currency));
/** "Name <a@b.c>" or "a@b.c" as the parts email APIs take. */
const sender = (from: string) => { const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from); return m ? { name: m[1] || undefined, email: m[2]! } : { name: undefined, email: from.trim() }; };
const testMail = (to: string): OutMessage => ({ to, subject: 'A test from Tangent', text: 'This connection can send email.', vars: {}, messageKey: 'test' });
const testText = (to: string): OutMessage => ({ to, text: 'A test from Tangent: this connection can send texts.', vars: {}, messageKey: 'test' });

// ── Stripe ────────────────────────────────────────────────────────────────────

const stripeAuth = (c: Ctx) => ({ authorization: `Bearer ${c.secrets.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' });
/** Stripe takes three-decimal currencies (KWD, BHD, OMR) in thousandths that end in 0. */
const stripeAmount = (minor: number, currency: string) => (currencyDigits(currency) === 3 ? Math.round(minor / 10) * 10 : minor);

/**
 * Stripe Checkout: one hosted page per payment (cards, Apple Pay, Google Pay, and the bank debits the account turns on:
 * ACH, SEPA, BACS). A signed webhook says it is paid, including bank debits that clear days later.
 */
export const stripe: Adapter = {
  payments: {
    async createLink(c, i) {
      const cur = i.currency.toLowerCase();
      // Stripe keeps a page open 30 minutes to 24 hours.
      const expires = i.expiresAt ? Math.min(Math.max(i.expiresAt.getTime(), Date.now() + 31 * 60_000), Date.now() + 23.5 * 3600_000) : null;
      const r = await call('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', headers: stripeAuth(c),
        body: form({ mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': cur, 'line_items[0][price_data][unit_amount]': String(stripeAmount(i.amountMinor, i.currency)),
          'line_items[0][price_data][product_data][name]': i.description.slice(0, 250), client_reference_id: i.reference.slice(0, 200), 'metadata[reference]': i.reference,
          'payment_intent_data[metadata][reference]': i.reference, success_url: i.callbackUrl, cancel_url: i.callbackUrl, customer_email: i.customer.email || undefined,
          expires_at: expires ? String(Math.floor(expires / 1000)) : undefined }),
      });
      return { linkId: r.json.id, url: r.json.url };
    },
    async refund(c, paymentId, amountMinor, note, currency) {
      const r = await call('https://api.stripe.com/v1/refunds', { method: 'POST', headers: stripeAuth(c),
        body: form({ payment_intent: paymentId, amount: String(stripeAmount(amountMinor, currency)), 'metadata[note]': note.slice(0, 450) }) });
      return { refundId: r.json.id };
    },
  },
  async test(c) {
    try {
      const r = await call('https://api.stripe.com/v1/balance', { headers: stripeAuth(c) });
      return { ok: true, detail: `Stripe accepted the ${r.json?.livemode ? 'live' : 'test'} key.` };
    } catch (e) { return fail(e); }
  },
  async inbound(c, req) {
    // Stripe-Signature: t=<seconds>,v1=<HMAC of "t.body">; older than five minutes is refused (a replay).
    const parts = Object.fromEntries((header(req, 'stripe-signature') ?? '').split(',').map((p) => p.split('=') as [string, string]));
    const want = createHmac('sha256', c.secrets.webhookSecret ?? '').update(`${parts.t}.${req.raw.toString('utf8')}`).digest('hex');
    if (!c.secrets.webhookSecret || !parts.t || !parts.v1 || !same(parts.v1, want) || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) {
      return { ok: false, summary: 'Signature did not match', reply: { status: 400, body: 'bad signature' } };
    }
    const b = json(req);
    const o = b?.data?.object ?? {};
    const payments: PaymentEvent[] = [];
    const ref = o.client_reference_id ?? o.metadata?.reference ?? '';
    // A card is paid when the session completes; a bank debit when its async payment succeeds.
    if ((b?.type === 'checkout.session.completed' && o.payment_status === 'paid') || b?.type === 'checkout.session.async_payment_succeeded') {
      payments.push({ kind: 'paid', reference: ref, providerPaymentId: String(o.payment_intent ?? o.id), amountMinor: Number(o.amount_total ?? 0), method: (o.payment_method_types ?? [])[0] === 'card' ? 'card' : 'bank' });
    }
    if (b?.type === 'checkout.session.async_payment_failed') payments.push({ kind: 'failed', reference: ref, providerPaymentId: String(o.payment_intent ?? o.id), amountMinor: Number(o.amount_total ?? 0) });
    if ((b?.type === 'refund.created' || b?.type === 'refund.updated') && o.status === 'succeeded') {
      payments.push({ kind: 'refunded', reference: '', providerPaymentId: String(o.payment_intent ?? ''), amountMinor: Number(o.amount ?? 0), refundId: o.id });
    }
    return { ok: true, summary: `${b?.type ?? 'event'}${payments[0] ? ` ${payments[0].providerPaymentId}` : ''}`, payments };
  },
};

// ── PayPal ────────────────────────────────────────────────────────────────────

const ppBase = (c: Ctx) => (s(c, 'environment') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function ppToken(c: Ctx): Promise<string> {
  const r = await call(`${ppBase(c)}/v1/oauth2/token`, { method: 'POST', headers: { authorization: basic(s(c, 'clientId'), c.secrets.clientSecret!), 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  return r.json.access_token as string;
}
const ppHeaders = async (c: Ctx) => ({ authorization: `Bearer ${await ppToken(c)}`, 'content-type': 'application/json' });

/**
 * PayPal Checkout (Orders v2): the family approves on PayPal's page; the approval webhook captures the order, and the
 * capture's webhook says it is paid. Webhooks are checked by asking PayPal (its own verification call).
 */
export const paypal: Adapter = {
  payments: {
    async createLink(c, i) {
      const r = await call(`${ppBase(c)}/v2/checkout/orders`, { method: 'POST', headers: await ppHeaders(c),
        body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: i.reference.slice(0, 256), custom_id: i.reference.slice(0, 127), description: i.description.slice(0, 127),
          amount: { currency_code: i.currency, value: decimal(i.amountMinor, i.currency) } }],
          application_context: { return_url: i.callbackUrl, cancel_url: i.callbackUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } }) });
      const url = (r.json.links ?? []).find((l: any) => l.rel === 'approve' || l.rel === 'payer-action')?.href;
      if (!url) throw new ProviderError('PayPal gave no page to pay on.', false);
      return { linkId: r.json.id, url };
    },
    async refund(c, paymentId, amountMinor, note, currency) {
      const r = await call(`${ppBase(c)}/v2/payments/captures/${paymentId}/refund`, { method: 'POST', headers: await ppHeaders(c),
        body: JSON.stringify({ amount: { value: decimal(amountMinor, currency), currency_code: currency }, note_to_payer: note.slice(0, 255) }) });
      return { refundId: r.json.id };
    },
  },
  async test(c) {
    try {
      await ppToken(c);
      return { ok: true, detail: `PayPal (${s(c, 'environment') === 'live' ? 'live' : 'sandbox'}) accepted the client ID and secret.` };
    } catch (e) { return fail(e); }
  },
  async inbound(c, req) {
    const b = json(req);
    const verify = await call(`${ppBase(c)}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: await ppHeaders(c),
      body: JSON.stringify({ auth_algo: header(req, 'paypal-auth-algo'), cert_url: header(req, 'paypal-cert-url'), transmission_id: header(req, 'paypal-transmission-id'),
        transmission_sig: header(req, 'paypal-transmission-sig'), transmission_time: header(req, 'paypal-transmission-time'), webhook_id: s(c, 'webhookId'), webhook_event: b }) }).catch(() => null);
    if (!b || verify?.json?.verification_status !== 'SUCCESS') return { ok: false, summary: 'Signature did not match', reply: { status: 400, body: 'bad signature' } };
    const o = b.resource ?? {};
    const payments: PaymentEvent[] = [];
    // Approved is not paid: the order is captured now, and the capture's own event follows.
    if (b.event_type === 'CHECKOUT.ORDER.APPROVED') {
      await call(`${ppBase(c)}/v2/checkout/orders/${o.id}/capture`, { method: 'POST', headers: await ppHeaders(c), body: '{}' }).catch(() => null);
    }
    const currency = String(o.amount?.currency_code ?? '');
    if (b.event_type === 'PAYMENT.CAPTURE.COMPLETED') payments.push({ kind: 'paid', reference: o.custom_id ?? '', providerPaymentId: o.id, amountMinor: minorOf(o.amount?.value ?? 0, currency), method: 'online' });
    if (b.event_type === 'PAYMENT.CAPTURE.DENIED') payments.push({ kind: 'failed', reference: o.custom_id ?? '', providerPaymentId: o.id, amountMinor: minorOf(o.amount?.value ?? 0, currency) });
    if (b.event_type === 'PAYMENT.CAPTURE.REFUNDED' || b.event_type === 'PAYMENT.REFUND.COMPLETED') {
      const capture = String((o.links ?? []).find((l: any) => l.rel === 'up')?.href ?? '').split('/').pop() ?? '';
      payments.push({ kind: 'refunded', reference: '', providerPaymentId: capture, amountMinor: minorOf(o.amount?.value ?? 0, currency), refundId: o.id });
    }
    return { ok: true, summary: `${b.event_type ?? 'event'}${payments[0] ? ` ${payments[0].providerPaymentId}` : ''}`, payments };
  },
};

// ── GoCardless (UK direct debit) ───────────────────────────────────────────────

const gcBase = (c: Ctx) => (s(c, 'environment') === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com');
const gcHeaders = (c: Ctx) => ({ authorization: `Bearer ${c.secrets.accessToken}`, 'gocardless-version': '2015-07-06', 'content-type': 'application/json' });

/**
 * GoCardless Billing Requests: the family sets up a direct debit and pays this amount on GoCardless's page; the payment is
 * "confirmed" days later, when the bank has collected it, and only then is it a receipt.
 */
export const gocardless: Adapter = {
  payments: {
    async createLink(c, i) {
      const br = await call(`${gcBase(c)}/billing_requests`, { method: 'POST', headers: gcHeaders(c),
        body: JSON.stringify({ billing_requests: { payment_request: { amount: i.amountMinor, currency: i.currency, description: i.description.slice(0, 100), metadata: { reference: i.reference.slice(0, 500) } },
          mandate_request: { scheme: s(c, 'scheme') || 'bacs' }, metadata: { reference: i.reference.slice(0, 500) } } }) });
      const id = br.json.billing_requests.id as string;
      const flow = await call(`${gcBase(c)}/billing_request_flows`, { method: 'POST', headers: gcHeaders(c),
        body: JSON.stringify({ billing_request_flows: { redirect_uri: i.callbackUrl, exit_uri: i.callbackUrl, links: { billing_request: id }, prefilled_customer: { email: i.customer.email } } }) });
      return { linkId: id, url: flow.json.billing_request_flows.authorisation_url };
    },
    async refund(c, paymentId, amountMinor) {
      // GoCardless asks for the total refunded so far, so a mistaken second refund is refused.
      const done = await call(`${gcBase(c)}/refunds?payment=${encodeURIComponent(paymentId)}`, { headers: gcHeaders(c) });
      const before = (done.json.refunds ?? []).reduce((a: number, r: any) => a + Number(r.amount ?? 0), 0);
      const r = await call(`${gcBase(c)}/refunds`, { method: 'POST', headers: gcHeaders(c),
        body: JSON.stringify({ refunds: { amount: amountMinor, total_amount_confirmation: before + amountMinor, links: { payment: paymentId } } }) });
      return { refundId: r.json.refunds.id };
    },
  },
  async test(c) {
    try {
      const r = await call(`${gcBase(c)}/creditors`, { headers: gcHeaders(c) });
      const cr = r.json.creditors?.[0];
      return { ok: true, detail: `GoCardless (${s(c, 'environment') === 'live' ? 'live' : 'sandbox'}) account “${cr?.name ?? 'reachable'}”.` };
    } catch (e) { return fail(e); }
  },
  async inbound(c, req) {
    const want = createHmac('sha256', c.secrets.webhookSecret ?? '').update(req.raw).digest('hex');
    if (!c.secrets.webhookSecret || !same(header(req, 'webhook-signature') ?? '', want)) return { ok: false, summary: 'Signature did not match', reply: { status: 498, body: 'bad signature' } };
    const payments: PaymentEvent[] = [];
    for (const ev of json(req)?.events ?? []) {
      if (ev.resource_type === 'payments' && (ev.action === 'confirmed' || ev.action === 'failed')) {
        const p = (await call(`${gcBase(c)}/payments/${ev.links.payment}`, { headers: gcHeaders(c) })).json.payments;
        payments.push({ kind: ev.action === 'confirmed' ? 'paid' : 'failed', reference: p.metadata?.reference ?? '', providerPaymentId: p.id, amountMinor: Number(p.amount), method: 'bank' });
      }
      if (ev.resource_type === 'refunds' && ev.action === 'refund_settled') {
        const r = (await call(`${gcBase(c)}/refunds/${ev.links.refund}`, { headers: gcHeaders(c) })).json.refunds;
        payments.push({ kind: 'refunded', reference: '', providerPaymentId: r.links.payment, amountMinor: Number(r.amount), refundId: r.id });
      }
    }
    return { ok: true, summary: `${payments.length} payment events`, payments };
  },
};

// ── Checkout.com (UAE and the Gulf) ─────────────────────────────────────────────

const ckoBase = (c: Ctx) => (s(c, 'environment') === 'live' ? 'https://api.checkout.com' : 'https://api.sandbox.checkout.com');
const ckoHeaders = (c: Ctx) => ({ authorization: `Bearer ${c.secrets.secretKey}`, 'content-type': 'application/json' });

/** Checkout.com Payment Links (cards, Apple Pay, Google Pay, local methods): a signed webhook says it is captured. */
export const checkoutCom: Adapter = {
  payments: {
    async createLink(c, i) {
      const r = await call(`${ckoBase(c)}/payment-links`, { method: 'POST', headers: ckoHeaders(c),
        body: JSON.stringify({ amount: i.amountMinor, currency: i.currency, reference: i.reference.slice(0, 80), description: i.description.slice(0, 100), return_url: i.callbackUrl,
          expires_in: i.expiresAt ? Math.max(60, Math.min(604800, Math.round((i.expiresAt.getTime() - Date.now()) / 1000))) : 86400, capture: true,
          billing: { address: { country: s(c, 'country') || 'AE' } }, customer: { name: i.customer.name, email: i.customer.email },
          ...(s(c, 'processingChannelId') ? { processing_channel_id: s(c, 'processingChannelId') } : {}) }) });
      return { linkId: r.json.id, url: r.json._links.redirect.href };
    },
    async refund(c, paymentId, amountMinor, note) {
      const r = await call(`${ckoBase(c)}/payments/${paymentId}/refunds`, { method: 'POST', headers: ckoHeaders(c), body: JSON.stringify({ amount: amountMinor, reference: note.slice(0, 80) }) });
      return { refundId: r.json.action_id };
    },
  },
  async test(c) {
    try {
      // Any reply but "unauthorised" means the key is good: an unknown payment answers 404.
      const r = await call(`${ckoBase(c)}/payments/pay_tangenttest00000000000000000`, { headers: ckoHeaders(c) }).catch((e: Error) => e);
      if (r instanceof Error && /401|403/.test(r.message)) return { ok: false, detail: 'Checkout.com refused the secret key.' };
      return { ok: true, detail: `Checkout.com (${s(c, 'environment') === 'live' ? 'live' : 'sandbox'}) accepted the secret key.` };
    } catch (e) { return fail(e); }
  },
  async inbound(c, req) {
    const want = createHmac('sha256', c.secrets.webhookSecret ?? '').update(req.raw).digest('hex');
    if (!c.secrets.webhookSecret || !same(header(req, 'cko-signature') ?? '', want)) return { ok: false, summary: 'Signature did not match', reply: { status: 401, body: 'bad signature' } };
    const b = json(req);
    const d = b?.data ?? {};
    const payments: PaymentEvent[] = [];
    if (b?.type === 'payment_captured') payments.push({ kind: 'paid', reference: d.reference ?? '', providerPaymentId: d.id, amountMinor: Number(d.amount ?? 0), method: 'card' });
    if (b?.type === 'payment_declined' || b?.type === 'payment_capture_declined') payments.push({ kind: 'failed', reference: d.reference ?? '', providerPaymentId: d.id, amountMinor: Number(d.amount ?? 0) });
    if (b?.type === 'payment_refunded') payments.push({ kind: 'refunded', reference: '', providerPaymentId: d.id, amountMinor: Number(d.amount ?? 0), refundId: d.action_id });
    return { ok: true, summary: `${b?.type ?? 'event'}${payments[0] ? ` ${payments[0].providerPaymentId}` : ''}`, payments };
  },
};

// ── Texts: Vonage, Unifonic ────────────────────────────────────────────────────

/** Vonage (Nexmo) SMS API: delivery receipts come to our webhook address. */
export const vonage: Adapter = {
  async sms(c, m) {
    const unicode = /[^\u0000-\u007f£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]/.test(m.text);
    const r = await call('https://rest.nexmo.com/sms/json', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ api_key: s(c, 'apiKey'), api_secret: c.secrets.apiSecret, from: s(c, 'from'), to: e164(m.to), text: m.text, type: unicode ? 'unicode' : 'text',
        callback: String(c.route.hookUrl ?? c.settings.hookUrl ?? '') || undefined }) });
    const first = r.json?.messages?.[0];
    if (!first || first.status !== '0') throw new ProviderError(`Vonage: ${first?.['error-text'] ?? 'not sent'}`, first?.status === '1');
    return { providerId: first['message-id'] ?? null, segments: Number(r.json['message-count']) || segments(m.text) };
  },
  async test(c, input) {
    try {
      const r = await call(`https://rest.nexmo.com/account/get-balance?${form({ api_key: s(c, 'apiKey'), api_secret: c.secrets.apiSecret })}`);
      if (input.to) await vonage.sms!(c, testText(input.to));
      return { ok: true, detail: `Vonage accepted the key. Balance: ${r.json?.value ?? 'unknown'}.${input.to ? ' A test text was sent.' : ''}` };
    } catch (e) { return fail(e); }
  },
  async inbound(_c, req) {
    const b = { ...req.query, ...(json(req) ?? Object.fromEntries(new URLSearchParams(req.raw.toString('utf8')))) } as Record<string, string>;
    const id = b.messageId ?? b['message-id'];
    if (!id) return { ok: false, summary: 'Not a Vonage delivery receipt' };
    const st = String(b.status ?? '').toLowerCase();
    return { ok: true, summary: `${st} ${id}`, deliveries: [{ providerId: id, status: st === 'delivered' ? 'delivered' : st === 'accepted' || st === 'buffered' ? 'sent' : 'failed', error: b['err-code'] && b['err-code'] !== '0' ? `Error ${b['err-code']}` : undefined }] };
  },
};

/** Unifonic (Saudi Arabia, the UAE and the Gulf): a form post per text with the approved sender name. */
export const unifonic: Adapter = {
  async sms(c, m) {
    const r = await call('https://el.cloud.unifonic.com/rest/SMS/messages', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ AppSid: c.secrets.appSid, SenderID: s(c, 'senderId'), Recipient: e164(m.to), Body: m.text, responseType: 'JSON' }) });
    if (String(r.json?.success) !== 'true') throw new ProviderError(`Unifonic: ${r.json?.message ?? r.json?.errorCode ?? 'not sent'}`, true);
    return { providerId: String(r.json?.data?.MessageID ?? ''), segments: Number(r.json?.data?.NumberOfUnits) || segments(m.text) };
  },
  async test(c, input) {
    if (!input.to) return { ok: false, detail: 'Type a phone number to send the test to.' };
    try {
      await unifonic.sms!(c, testText(input.to));
      return { ok: true, detail: 'Unifonic accepted a test text.' };
    } catch (e) { return fail(e); }
  },
};

// ── Public holidays: Nager.Date, Calendarific ──────────────────────────────────

/** Nager.Date: free, no key; only holidays kept across the whole country (not one state's or county's). */
export const nagerDate: Adapter = {
  async holidays(_c, country, year) {
    const r = await call(`https://date.nager.at/api/v3/PublicHolidays/${year}/${encodeURIComponent(country)}`).catch((e: Error) => {
      if (/^404:/.test(e.message)) return { json: [] };
      throw e;
    });
    // An unknown country answers 404 or nothing: no holidays rather than an error.
    return (Array.isArray(r.json) ? r.json : []).filter((h: any) => h.global !== false).map((h: any) => ({ date: String(h.date).slice(0, 10), name: String(h.name ?? h.localName) }));
  },
  async test() {
    try {
      const r = await call('https://date.nager.at/api/v3/AvailableCountries');
      return { ok: true, detail: `Nager.Date has holidays for ${Array.isArray(r.json) ? r.json.length : 'many'} countries.` };
    } catch (e) { return fail(e); }
  },
};

export const calendarific: Adapter = {
  async holidays(c, country, year) {
    const r = await call(`https://calendarific.com/api/v2/holidays?${form({ api_key: c.secrets.apiKey, country, year: String(year), type: 'national' })}`);
    return (r.json?.response?.holidays ?? []).map((h: any) => ({ date: String(h.date?.iso ?? '').slice(0, 10), name: String(h.name) })).filter((h: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
  },
  async test(c) {
    try {
      const list = await calendarific.holidays!(c, 'US', new Date().getUTCFullYear());
      return { ok: true, detail: `Calendarific answered with ${list.length} national holidays.` };
    } catch (e) { return fail(e); }
  },
};

// ── Email: SendGrid, Mailgun, Postmark ─────────────────────────────────────────

export const sendgrid: Adapter = {
  async email(c, m) {
    const from = sender(s(c, 'from'));
    const r = await call('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { authorization: `Bearer ${c.secrets.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email: m.to }] }], from, subject: m.subject ?? '',
        content: [{ type: 'text/plain', value: m.text }, ...(m.html ? [{ type: 'text/html', value: m.html }] : [])] }) });
    return { providerId: r.json?.id ?? null };
  },
  async test(c, input) {
    const r = await call('https://api.sendgrid.com/v3/scopes', { headers: { authorization: `Bearer ${c.secrets.apiKey}` } }).catch((e: Error) => e);
    if (r instanceof Error) return fail(r);
    if (!(r.json?.scopes ?? []).includes('mail.send')) return { ok: false, detail: 'The key cannot send mail: give it “Mail Send” access.' };
    if (input.to) await sendgrid.email!(c, testMail(input.to));
    return { ok: true, detail: `SendGrid accepted the key.${input.to ? ' A test email was sent.' : ''}` };
  },
};

const mgBase = (c: Ctx) => (s(c, 'region') === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net');
export const mailgun: Adapter = {
  async email(c, m) {
    const r = await call(`${mgBase(c)}/v3/${s(c, 'domain')}/messages`, { method: 'POST', headers: { authorization: basic('api', c.secrets.apiKey!), 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ from: s(c, 'from'), to: m.to, subject: m.subject ?? '', text: m.text, html: m.html }) });
    return { providerId: r.json?.id ?? null };
  },
  async test(c, input) {
    const r = await call(`${mgBase(c)}/v3/domains/${s(c, 'domain')}`, { headers: { authorization: basic('api', c.secrets.apiKey!) } }).catch((e: Error) => e);
    if (r instanceof Error) return fail(r);
    if (input.to) await mailgun.email!(c, testMail(input.to));
    return { ok: true, detail: `Mailgun domain ${s(c, 'domain')} is ${r.json?.domain?.state ?? 'reachable'}.${input.to ? ' A test email was sent.' : ''}` };
  },
};

export const postmark: Adapter = {
  async email(c, m) {
    const r = await call('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'x-postmark-server-token': c.secrets.serverToken!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ From: s(c, 'from'), To: m.to, Subject: m.subject ?? '', TextBody: m.text, ...(m.html ? { HtmlBody: m.html } : {}), MessageStream: s(c, 'stream') || 'outbound' }) });
    if (r.json?.ErrorCode) throw new ProviderError(`Postmark: ${r.json.Message}`, true);
    return { providerId: r.json?.MessageID ?? null };
  },
  async test(c, input) {
    const r = await call('https://api.postmarkapp.com/server', { headers: { 'x-postmark-server-token': c.secrets.serverToken!, accept: 'application/json' } }).catch((e: Error) => e);
    if (r instanceof Error) return fail(r);
    if (input.to) await postmark.email!(c, testMail(input.to));
    return { ok: true, detail: `Postmark server “${r.json?.Name ?? 'reachable'}”.${input.to ? ' A test email was sent.' : ''}` };
  },
};
