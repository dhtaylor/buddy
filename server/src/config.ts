import { resolve } from 'node:path';

/** Centralized runtime configuration, read from env with sane defaults. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databasePath: resolve(process.env.DATABASE_PATH ?? './data/buddy.sqlite'),
  /**
   * 32-byte key (hex) for @fastify/secure-session cookie encryption.
   * Generate once and set in the environment for production. A dev default is
   * provided so the app boots out of the box on the LAN.
   */
  sessionKeyHex:
    process.env.SESSION_KEY ??
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  // Path to the built web app (served statically in production).
  webDistPath: resolve(process.env.WEB_DIST_PATH ?? '../web/dist'),
  isProduction: process.env.NODE_ENV === 'production',
};
