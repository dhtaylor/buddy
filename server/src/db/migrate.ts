// CLI: apply all pending Drizzle migrations, then exit.
import { runMigrations } from './migrator.js';
import { closeDb } from './index.js';

await runMigrations();
console.log('Migrations applied.');
await closeDb();
