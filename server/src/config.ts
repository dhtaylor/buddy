import { resolve } from 'node:path';

/** Centralized runtime configuration, read from env with sane defaults. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  /** Postgres connection string. Local/home default targets the docker-compose DB. */
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://buddy:buddy@localhost:5432/buddy',
  /** Require TLS to the database (Azure Postgres needs this). */
  databaseSsl: process.env.DATABASE_SSL === 'true',
  /**
   * 32-byte key (hex) for @fastify/secure-session cookie encryption.
   * Generate once and set in the environment for production. A dev default is
   * provided so the app boots out of the box on the LAN.
   */
  sessionKeyHex:
    process.env.SESSION_KEY ??
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  /**
   * Send the session cookie only over HTTPS. MUST stay false for the home LAN
   * deployment (served over plain http://<pc-ip>:8080) — a Secure cookie is
   * silently dropped by browsers over HTTP on non-localhost hosts, which breaks
   * login. Set COOKIE_SECURE=true only when actually behind HTTPS (e.g. Azure).
   */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Path to the built web app (served statically in production).
  webDistPath: resolve(process.env.WEB_DIST_PATH ?? '../web/dist'),
  isProduction: process.env.NODE_ENV === 'production',
};
