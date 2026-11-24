import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { ProviderError } from './types.js';

// Addresses a typed-in provider address may not reach: this machine, the private networks it sits on, and the cloud's metadata.
const inside = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) inside.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) inside.addSubnet(net, bits, 'ipv6');
const insideV4mapped = (a: string) => a.toLowerCase().startsWith('::ffff:') && inside.check(a.slice(7), 'ipv4');

/**
 * An address typed into an integration (a custom SMS gateway, a webhook, a tracker) is reached only on the open internet: one
 * pointed inside would let a console account read the servers' own network. ALLOW_PRIVATE_HOSTS names hosts allowed anyway
 * (an SMS gateway on the school's own network); local runs and tests reach anything.
 */
export async function assertPublic(url: string): Promise<void> {
  let u: URL;
  try { u = new URL(url); } catch { throw new ProviderError('That is not a web address.', true); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ProviderError('Use a web address starting with https://.', true);
  if (process.env.NODE_ENV !== 'production') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if ((process.env.ALLOW_PRIVATE_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).includes(host.toLowerCase())) return;
  // ponytail: checked when the call is made; a name that changes its address between this and the call is not caught.
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ProviderError(`Could not find ${host}.`);
  if (addrs.some((a) => inside.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4') || insideV4mapped(a.address))) {
    throw new ProviderError(`${host} is on a private network, which an integration cannot reach. Ask Tangent to allow it (ALLOW_PRIVATE_HOSTS).`, true);
  }
}

/** A call to an address someone typed: on the open internet only, and never following a redirect somewhere else. */
export async function callPublic(url: string, init: RequestInit & { retries?: number } = {}): Promise<{ status: number; text: string; json: any }> {
  await assertPublic(url);
  const r = await call(url, { ...init, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new ProviderError(`${r.status}: the address sends the request somewhere else. Use the final address.`, true);
  return r;
}

/**
 * Every call to a provider: a 10 second limit, two retries with backoff on network errors and 5xx answers, never on a 4xx
 * (a refusal will not change by asking again). The provider's own words come back in the error.
 */
export async function call(url: string, init: RequestInit & { retries?: number } = {}): Promise<{ status: number; text: string; json: any }> {
  const retries = init.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (res.status >= 500 && attempt < retries) { await wait(attempt); continue; }
      if (res.status >= 400) throw new ProviderError(`${res.status}: ${reason(json, text)}`, res.status < 500);
      return { status: res.status, text, json };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (attempt >= retries) throw new ProviderError(`Could not reach the provider: ${(err as Error).message}`);
      await wait(attempt);
    }
  }
}

const wait = (attempt: number) => new Promise((r) => setTimeout(r, 400 * 2 ** attempt));

/** The most useful words in a provider's error reply. */
function reason(json: any, text: string): string {
  const pick = json?.error?.description ?? json?.error?.message ?? json?.message ?? json?.error_description ?? json?.errors?.[0]?.message ?? json?.error;
  return (typeof pick === 'string' ? pick : text || 'no details').slice(0, 300);
}

export const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
export const form = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined) as [string, string][]).toString();
