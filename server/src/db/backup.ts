// CLI backup: pg_dump snapshot → ./backups/buddy-YYYYMMDD-HHMMSS.sql
// Schedule via Windows Task Scheduler (see README). Logic lives in lib/backup.ts
// so the System Settings endpoint can reuse it.
import { backupDir, runBackup } from '../lib/backup.js';
import { join } from 'node:path';

const name = await runBackup();
console.log(`Backup written: ${join(backupDir(), name)}`);
