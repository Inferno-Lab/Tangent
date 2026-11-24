import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { trustProxy } from '@tangent/nest-kit';

const ip = async (setting: string, xff: string) => {
  const app = Fastify({ trustProxy: trustProxy(setting) });
  app.get('/', (req) => req.ip);
  return (await app.inject({ url: '/', headers: xff ? { 'x-forwarded-for': xff } : {}, remoteAddress: '10.1.1.1' })).body;
};

describe('which address a request comes from', () => {
  it('behind one proxy, a value the client wrote further left changes nothing', async () => {
    expect(await ip('1', '203.0.113.7')).toBe('203.0.113.7');
    expect(await ip('1', '1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
  });
  it('with no proxy, the header is not believed at all', async () => {
    expect(await ip('false', '1.2.3.4')).toBe('10.1.1.1');
  });
  it('a list of proxy addresses is trusted only for those', async () => {
    expect(await ip('10.0.0.0/8', '1.2.3.4, 203.0.113.7')).toBe('203.0.113.7');
  });
  it('trusting every proxy is refused', () => {
    expect(() => trustProxy('true')).toThrow();
  });
});
