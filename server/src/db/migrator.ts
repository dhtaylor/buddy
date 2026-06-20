import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';

// Absolute path to the generated migrations, resolved relative to this file so it
// works regardless of the current working directory (CLI script or test runner).
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Apply all pending Drizzle migrations to the active database connection. */
export function runMigrations(): void {
  migrate(db, { migrationsFolder });
}
