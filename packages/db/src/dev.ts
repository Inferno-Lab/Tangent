import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import net from 'node:net';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

export interface DevPostgres {
  /** Connection string for the maintenance database ("postgres"). */
  url: string;
  port: number;
  stop: () => Promise<void>;
}

/** Asks the system for a port nobody is using. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Finds the PostgreSQL binaries that the `embedded-postgres` package ships for this platform. */
function binDir(): string {
  const base = createRequire(
    createRequire(import.meta.url).resolve('embedded-postgres'),
  );
  const plat = process.platform === 'win32' ? 'windows' : process.platform;
  let dir = path.dirname(base.resolve(`@embedded-postgres/${plat}-${process.arch}`) as string);
  while (!fs.existsSync(path.join(dir, 'native', 'bin'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('The embedded PostgreSQL binaries were not found. Run pnpm install.');
    dir = up;
  }
  return path.join(dir, 'native', 'bin');
}

/**
 * Starts a throwaway PostgreSQL from npm binaries, so tests and local development need no Docker.
 * It is started with `pg_ctl`, which drops administrator rights on Windows (PostgreSQL refuses to run with them).
 */
/** `throwaway`: a test's server, whose folder (the data directory's parent, made for it) goes when it stops. */
export async function startDevPostgres(opts: { dataDir: string; port?: number; fresh?: boolean; throwaway?: boolean }): Promise<DevPostgres> {
  const dataDir = path.resolve(opts.dataDir);
  const bin = binDir();
  const exe = (n: string) => path.join(bin, process.platform === 'win32' ? `${n}.exe` : n);
  if (opts.fresh && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  await mkdir(path.dirname(dataDir), { recursive: true });
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    const pwFile = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.pw`);
    fs.writeFileSync(pwFile, 'tangent');
    try {
      await run(exe('initdb'), ['-D', dataDir, '-U', 'tangent', '--pwfile', pwFile, '-A', 'scram-sha-256', '-E', 'UTF8']);
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
  }
  const log = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.log`);
  // spawn with ignored stdio: the postgres child would otherwise keep pg_ctl's pipes open and the call would never return
  const start = (port: number) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(exe('pg_ctl'), ['-D', dataDir, '-l', log, '-w', '-t', '60', '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c max_connections=500`, 'start'], { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', resolve);
  });
  // Test servers start in parallel: another one can take a free port before PostgreSQL binds it, so try a fresh port.
  let port = opts.port ?? (await freePort());
  let code = await start(port);
  for (let tries = 1; code !== 0 && opts.port === undefined && tries < 5; tries++) code = await start((port = await freePort()));
  if (code !== 0) {
    const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-600) : '';
    throw new Error(`PostgreSQL did not start (exit ${code}).
${tail}`);
  }
  return {
    url: `postgres://tangent:tangent@127.0.0.1:${port}/postgres`,
    port,
    stop: async () => {
      const stop = (mode: string) => new Promise<number | null>((resolve) => {
        const child = spawn(exe('pg_ctl'), ['-D', dataDir, '-m', mode, '-w', '-t', '10', 'stop'], { stdio: 'ignore', windowsHide: true });
        child.on('error', () => resolve(null));
        child.on('exit', resolve);
      });
      // Smart first: sessions still closing finish on their own. A fast stop cut them off, and the client's "terminating
      // connection" error (57P01) failed a test run that had passed (CI, 19 November). Fast only if smart does not end.
      if ((await stop('smart')) !== 0) await stop('fast');
      // A test's database is about 100 MB: left behind by every run, they filled the disk.
      if (opts.throwaway) fs.rmSync(path.dirname(dataDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Creates `name` if it does not exist and returns its connection string. */
export async function ensureDatabase(adminUrl: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    const { rowCount } = await pool.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) await pool.query(`create database ${name}`);
  } finally {
    await pool.end();
  }
  return urlOf(adminUrl, name);
}

const urlOf = (adminUrl: string, name: string) => {
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

const safe = (name: string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  return name;
};

/**
 * A database made once and copied for each test (`create database … template …` takes a fraction of a second, where
 * migrating and seeding a school takes many). Built under a lock, so test files running together build it once.
 */
export async function ensureTemplate(adminUrl: string, name: string, build: (url: string) => Promise<void>): Promise<void> {
  const lock = new pg.Client({ connectionString: adminUrl });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock(hashtext($1))', [safe(name)]);
    const { rowCount } = await lock.query('select 1 from pg_database where datname = $1', [name]);
    if (rowCount) return;
    const building = safe(`${name}_wip`);
    await lock.query(`drop database if exists ${building} with (force)`);
    await lock.query(`create database ${building}`);
    await build(urlOf(adminUrl, building));
    // Renamed only once complete: a half-built template is never copied.
    await lock.query(`alter database ${building} rename to ${name}`);
  } finally {
    await lock.query('select pg_advisory_unlock(hashtext($1))', [name]).catch(() => undefined);
    await lock.end();
  }
}

/** A new database `name` as a copy of `template`; returns its connection string. */
export async function cloneDatabase(adminUrl: string, template: string, name: string): Promise<string> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    // Postgres refuses a copy while anything else is connected to the template; that passes in a moment.
    for (let tries = 0; ; tries++) {
      try {
        await pool.query(`create database ${safe(name)} template ${safe(template)}`);
        break;
      } catch (e) {
        if (tries >= 20 || !/being accessed by other users/.test((e as Error).message)) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } finally {
    await pool.end();
  }
  return urlOf(adminUrl, name);
}

export async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await pool.query(`drop database if exists ${safe(name)} with (force)`);
  } finally {
    await pool.end();
  }
}
