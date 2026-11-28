import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CSRF_HEADER } from './cookies.js';
import { requestLanguage, schoolContext } from '@tangent/tenancy';

/** Routes that take a school's files (a whole student list, a year of attendance as CSV): everything else keeps the small limit. */
// Files sent inside JSON as base64: the wizard's logo (2 MB) in its drafts, review and launch, a signed agreement (5 MB), and
// a connection's key file (512 KB, the Integrations page).
const BIG_BODIES = /^\/v1\/(students\/import|moving-in\/uploads)$|^\/console\/v1\/schools\/:id\/(import\/(preview|commit)|logo)$|^\/console\/v1\/wizard\/(drafts(\/:id)?|review|launch)$|^\/console\/v1\/compliance\/:id$|^\/console\/v1\/integrations\/connections(\/:id)?$|^\/hooks\/sandbox-storage\/:token$/;

export interface HttpEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  CORS_ORIGINS: string;
}

const CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // The admin's and the console's two typefaces come from Google Fonts: their stylesheet and the font files.
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
};

/**
 * Which proxies in front of the server may say who the client is (TRUST_PROXY): how many sit in front (1 for one load balancer, the
 * default), their addresses or ranges ("10.0.0.0/8,127.0.0.1"), or "false" when clients connect straight to the server. Never every
 * proxy: a client writes the left-most X-Forwarded-For itself, and every per-device limit would take its word for its address.
 */
export function trustProxy(value = process.env.TRUST_PROXY): string | false | ((addr: string, hop: number) => boolean) {
  const v = (value ?? '1').trim();
  if (v === 'true') throw new Error('TRUST_PROXY=true lets any client choose its own address. Set the number of proxies in front of the server, or their addresses.');
  if (v === 'false' || v === '0' || v === '') return false;
  if (!/^\d+$/.test(v)) return v;
  // Fastify takes a bare hop count as "trust no one"; this trusts exactly that many hops back from the server, so the client is the
  // address the nearest of them saw, whatever the client wrote further left.
  const hops = Number(v);
  return (_addr: string, hop: number) => hop < hops;
}

/** The Fastify options every server here starts with. */
export const fastifyOptions = () => ({ trustProxy: trustProxy(), bodyLimit: 256_000, routerOptions: { maxParamLength: 2048 } });

/** Cookies, security headers, CORS, and a process-wide rate limit. Call once per Fastify instance. */
export async function registerHttp(app: NestFastifyApplication, env: HttpEnv): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(cookie as never);
  await fastify.register(helmet as never, {
    contentSecurityPolicy: { directives: CSP },
    hsts: { maxAge: 15_552_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    permittedCrossDomainPolicies: false,
    crossOriginEmbedderPolicy: false,
  });
  // Each request runs in its own school context, in the reader's language; the tenant guard adds the school's zone and money.
  fastify.addHook('onRequest', (req, _reply, done) => schoolContext.run({ lang: requestLanguage(req.headers['accept-language']) }, done));
  fastify.addHook('onRequest', async (_req, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  });
  const listed = env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await fastify.register(cors as never, {
    origin: listed,
    credentials: env.CORS_ORIGINS !== '*',
    allowedHeaders: ['content-type', 'authorization', 'x-school', CSRF_HEADER],
    exposedHeaders: ['content-disposition', 'retry-after'],
    maxAge: 86400,
  });
  await fastify.register(rateLimit as never, {
    global: true,
    // Local runs load every page at four widths from one machine; the limit guards real servers.
    max: env.NODE_ENV === 'production' ? 300 : 10_000,
    timeWindow: '1 minute',
    skip: (req: { url: string }) => req.url.startsWith('/health') || req.url.startsWith('/metrics'),
    errorResponseBuilder: () => ({ statusCode: 429, code: 'rate_limited', message: 'Too many tries from this device. Wait a moment and try again.' }),
  });
  // Files uploaded to the test track's storage arrive as whatever they are (images, PDFs): kept as bytes, never parsed.
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body));
  fastify.addHook('onRoute', (route: { url?: string; bodyLimit?: number }) => {
    // A school's files: a whole student list or a year of attendance as CSV.
    if (route.url && BIG_BODIES.test(route.url)) route.bodyLimit = 26_000_000;
  });
}
