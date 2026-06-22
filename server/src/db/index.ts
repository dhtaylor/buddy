import { drizzle as pgDrizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import postgres, { type Sql } from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';
import * as schema from './schema.js';

// Tests run against an in-process PGlite database (no server needed) by setting
// DATABASE_DRIVER=pglite. Everything else uses a real Postgres via postgres.js.
export const isPglite = process.env.DATABASE_DRIVER === 'pglite';

let _pglite: PGlite | undefined;
let _sql: Sql | undefined;

function build(): PostgresJsDatabase<typeof schema> {
  if (isPglite) {
    _pglite = new PGlite();
    // Same Drizzle PG query API; cast so all call sites see one db type.
    return pgliteDrizzle(_pglite, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
  }
  _sql = postgres(config.databaseUrl, {
    ssl: config.databaseSsl ? 'require' : false,
    max: 10,
  });
  return pgDrizzle(_sql, { schema });
}

export const db = build();
export const pglite = _pglite;
export const sql = _sql;
export { schema };

/** Close the underlying connection (used by the migrate CLI and tests). */
export async function closeDb(): Promise<void> {
  if (_pglite) await _pglite.close();
  if (_sql) await _sql.end({ timeout: 5 });
}
