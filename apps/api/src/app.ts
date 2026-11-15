import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { registerHttp } from '@tangent/nest-kit';
import { schoolContext, type PoolManager, type Registry } from '@tangent/tenancy';
import { AppModule } from './app.module.js';
import { loadEnv, type Env } from './env.js';

/** Builds the school API. The console server passes its own registry and pools so both share one set of connections. */
export async function createApp(env: Env = loadEnv(), shared?: { registry: Registry; pools: PoolManager }): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env, shared),
    new FastifyAdapter({ trustProxy: true, bodyLimit: 256_000, routerOptions: { maxParamLength: 2048 } }),
    { logger: env.NODE_ENV === 'test' ? ['error'] : ['error', 'warn', 'log'], rawBody: true },
  );
  await registerHttp(app, env);
  // Each request runs in its own school context; the tenant guard fills in the school's zone, locale and currency.
  app.getHttpAdapter().getInstance().addHook('onRequest', (_req: unknown, _reply: unknown, done: () => void) => schoolContext.run({}, done));
  app.enableShutdownHooks();
  return app;
}
