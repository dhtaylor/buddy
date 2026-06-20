import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

// Spin up the real app against a throwaway temp SQLite DB. Env must be set BEFORE
// importing config/db/app, so everything here is dynamically imported.
export interface TestApp {
  app: FastifyInstance;
  dir: string;
  close: () => Promise<void>;
}

export async function makeApp(): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = join(dir, 'test.sqlite');
  process.env.BACKUP_DIR = join(dir, 'backups');
  process.env.WEB_DIST_PATH = join(dir, 'no-web'); // skip static serving

  const { runMigrations } = await import('../src/db/migrator.js');
  runMigrations();
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();

  return {
    app,
    dir,
    close: async () => {
      await app.close();
      try {
        const { sqlite } = await import('../src/db/index.js');
        sqlite.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: any;
  data: T;
}

/** A cookie-retaining HTTP client over app.inject (one "session" per agent). */
export function agent(app: FastifyInstance) {
  let cookie = '';

  async function call(method: string, url: string, payload?: unknown): Promise<Res> {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    const res = await app.inject({ method: method as any, url, payload: payload as any, headers });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      cookie = raw.split(';')[0];
    }
    let body: any = null;
    try {
      body = res.json();
    } catch {
      body = null;
    }
    return { status: res.statusCode, body, data: body?.data };
  }

  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p?: unknown) => call('POST', u, p),
    put: (u: string, p?: unknown) => call('PUT', u, p),
    del: (u: string, p?: unknown) => call('DELETE', u, p),
    /** Upload a CSV via multipart (accountId field first, then file). */
    async uploadCsv(url: string, accountId: number, csv: string): Promise<Res> {
      const b = '----buddytest';
      const payload =
        `--${b}\r\nContent-Disposition: form-data; name="accountId"\r\n\r\n${accountId}\r\n` +
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="s.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n${csv}\r\n--${b}--\r\n`;
      const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${b}` };
      if (cookie) headers.cookie = cookie;
      const res = await app.inject({ method: 'POST', url, payload, headers });
      let body: any = null;
      try {
        body = res.json();
      } catch {
        body = null;
      }
      return { status: res.statusCode, body, data: body?.data };
    },
  };
}

/** Register the first user (bootstrap admin) + their household; returns a logged-in agent. */
export async function registerAdmin(app: FastifyInstance, over: Partial<{ email: string; password: string; displayName: string; householdName: string }> = {}) {
  const a = agent(app);
  const res = await a.post('/api/auth/register', {
    email: over.email ?? 'admin@test.local',
    password: over.password ?? 'password123',
    displayName: over.displayName ?? 'Admin',
    householdName: over.householdName ?? 'Test Household',
  });
  return { a, res };
}
