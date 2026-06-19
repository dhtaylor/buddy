import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './index.js';

/** Apply all pending Drizzle migrations from ./drizzle, then exit. */
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied.');
sqlite.close();
