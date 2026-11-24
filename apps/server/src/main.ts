import 'reflect-metadata';
import { AppModule, loadEnv as loadApiEnv } from '@tangent/api';
import { ConsoleModule, loadEnv as loadConsoleEnv, prepareRegistry } from '@tangent/console-api';
import { ApiExceptionFilter, fastifyOptions, registerHttp } from '@tangent/nest-kit';
import { poolManagerFromEnv, Registry } from '@tangent/tenancy';
import { ConsoleLogger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { serveFrontends } from './static.js';

/**
 * One process for the test track and small installs: the school API and the console API side by side,
 * sharing one registry connection and one set of school pools. Large installs run them apart.
 */
const apiEnv = loadApiEnv();
const consoleEnv = loadConsoleEnv();
await prepareRegistry(consoleEnv);
const shared = { registry: new Registry({ url: apiEnv.REGISTRY_DATABASE_URL, secret: apiEnv.SECRETS_KEY }), pools: poolManagerFromEnv() };

// The school API can use a registry login of its own that cannot open the console's tables (tools/registry-api-role.sql).
const apiShared = process.env.API_REGISTRY_DATABASE_URL ? { ...shared, registry: new Registry({ url: process.env.API_REGISTRY_DATABASE_URL, secret: apiEnv.SECRETS_KEY }) } : shared;

@Module({ imports: [AppModule.register(apiEnv, apiShared), ConsoleModule.register(consoleEnv, shared)] })
class ServerModule {}

const app = await NestFactory.create<NestFastifyApplication>(ServerModule, new FastifyAdapter(fastifyOptions()), {
  // JSON lines in production, so the host's log search can filter by school and request; readable text locally.
  logger: new ConsoleLogger({ json: apiEnv.NODE_ENV === 'production', logLevels: ['error', 'warn', 'log'] }),
  // Provider webhooks are checked against the exact bytes they signed.
  rawBody: true,
});
app.useGlobalFilters(new ApiExceptionFilter());
await registerHttp(app, apiEnv);
const served = await serveFrontends(app);
app.enableShutdownHooks();
await app.listen(apiEnv.PORT, apiEnv.HOST);
if (served.length) console.log(`Serving the admin and console from this process: ${served.join(' ')}`);
