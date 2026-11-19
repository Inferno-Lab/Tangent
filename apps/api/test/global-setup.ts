import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startDevPostgres } from '@tangent/db/dev';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The one PostgreSQL every test file shares (each file works in its own copies of the template databases). */
    pgUrl: string;
  }
}

/** One PostgreSQL for the whole run, instead of one started and stopped by every test file. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startDevPostgres({ dataDir: path.join(mkdtempSync(path.join(tmpdir(), 'tangent-api-')), 'data'), fresh: true, throwaway: true });
  project.provide('pgUrl', server.url);
  return () => server.stop();
}
