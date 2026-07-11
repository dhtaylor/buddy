import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import secureSession from '@fastify/secure-session';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db } from './db/index.js';
import { ApiException, sendError } from './lib/errors.js';

import authRoutes from './routes/auth.js';
import accountsRoutes from './routes/accounts.js';
import categoriesRoutes from './routes/categories.js';
import householdRoutes from './routes/household.js';
import ledgerRoutes from './routes/ledger.js';
import budgetRoutes from './routes/budget.js';
import billsRoutes from './routes/bills.js';
import importsRoutes from './routes/imports.js';
import historyRoutes from './routes/history.js';
import systemRoutes from './routes/system.js';

// Content-Security-Policy tuned to the built app: all scripts are external
// ('self'); charts set inline style attributes so styles allow 'unsafe-inline';
// the app only talks to its own origin. No third-party origins are permitted.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : true });

  // Security headers on every response.
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  await app.register(cookie);
  await app.register(secureSession, {
    key: Buffer.from(config.sessionKeyHex, 'hex'),
    cookieName: 'buddy_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure, // true in production / behind HTTPS
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  });
  await app.register(multipart);

  // Unauthenticated liveness endpoint for the Docker healthcheck. Registered
  // outside the /api group (and any auth hook) so it's reachable with no
  // session cookie. Checks the DB with a trivial query so a dead DB is
  // reported as unhealthy rather than the process just being "up".
  app.get('/health', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return reply.code(200).send({ status: 'ok' });
    } catch {
      return reply.code(503).send({ status: 'degraded' });
    }
  });

  // Uniform error envelope: { error: { code, message } }.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiException) return sendError(reply, err);
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: err.issues.map((i) => i.message).join('; ') },
      });
    }
    reply.log.error(err);
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal server error' } });
  });

  // API routes (auth/accounts/categories/household fully implemented; rest stubbed).
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(accountsRoutes, { prefix: '/accounts' });
      await api.register(categoriesRoutes, { prefix: '/categories' });
      await api.register(householdRoutes, { prefix: '/household' });
      await api.register(ledgerRoutes, { prefix: '/ledger' });
      await api.register(budgetRoutes, { prefix: '/budget' });
      await api.register(billsRoutes, { prefix: '/bills' });
      await api.register(importsRoutes, { prefix: '/imports' });
      await api.register(historyRoutes, { prefix: '/history' });
      await api.register(systemRoutes, { prefix: '/system' });
      api.get('/health', async () => ({ data: { ok: true } }));
    },
    { prefix: '/api' },
  );

  // Serve the built web app in production. SPA fallback to index.html.
  if (existsSync(config.webDistPath)) {
    await app.register(fastifyStatic, { root: config.webDistPath });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
