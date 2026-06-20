// CLI: apply all pending Drizzle migrations, then exit.
import { runMigrations } from './migrator.js';
import { sqlite } from './index.js';

runMigrations();
console.log('Migrations applied.');
sqlite.close();
