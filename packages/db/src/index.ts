export * from './ids.js';
export * from './migrate.js';
import pg from 'pg';
export { pg };

// Amounts are numeric (cents, pence, fils): read them as numbers, as every caller expects. Sums and averages come back as
// numbers too. ponytail: a float holds 15 significant digits, far beyond any school's amounts; keep them as strings if that ever changes.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v: string) => Number(v));
export { drizzle } from 'drizzle-orm/node-postgres';
export type { NodePgDatabase } from 'drizzle-orm/node-postgres';
export * as sql from 'drizzle-orm';
export * from './backup.js';
export * from './jobs.js';
export * from './settings.js';
export * from './queue.js';
export * from './import/engine.js';
export { ImportError, parseCsv, readTable, readXlsx, toCsv, xlsx } from './import/files.js';
export { sampleSchool, type SampleSchool } from './import/sample.js';
