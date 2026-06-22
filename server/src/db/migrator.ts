import { migrate as pgMigrate } from 'drizzle-orm/postgres-js/migrator';
import { migrate as pgliteMigrate } from 'drizzle-orm/pglite/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, isPglite } from './index.js';

// Absolute path to the generated migrations, resolved relative to this file so it
// works regardless of the current working directory (CLI script or test runner).
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Apply all pending Drizzle migrations to the active database connection. */
export async function runMigrations(): Promise<void> {
  if (isPglite) {
    await pgliteMigrate(db as never, { migrationsFolder });
  } else {
    await pgMigrate(db as never, { migrationsFolder });
  }
}
