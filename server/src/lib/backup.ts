// Reusable backup helpers, shared by the CLI script (db/backup.ts) and the
// System Settings backup endpoint. Uses pg_dump to write a plain-SQL dump of
// the Postgres database (no need to stop the server).
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';

const KEEP = Number(process.env.BACKUP_KEEP ?? 30);

export function backupDir(): string {
  return process.env.BACKUP_DIR ?? resolve(process.cwd(), 'backups');
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string; // ISO
}

/** List existing backups, newest first. */
export function listBackups(): BackupFile[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^buddy-.*\.sql$/.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, sizeBytes: s.size, createdAt: new Date(s.mtimeMs).toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Dump the database to ./backups and prune beyond KEEP. Returns the file name. */
export async function runBackup(): Promise<string> {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `buddy-${stamp}.sql`;
  const dest = join(dir, name);

  await new Promise<void>((resolveDump, reject) => {
    const child = spawn('pg_dump', [config.databaseUrl, '--no-owner', '--no-privileges']);
    const out = createWriteStream(dest);
    child.stdout.pipe(out);

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      const msg =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'pg_dump not found — install the postgresql-client'
          : `pg_dump failed to start: ${err.message}`;
      reject(new Error(msg));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolveDump();
      } else {
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });

  // Prune oldest beyond KEEP.
  for (const b of listBackups().slice(KEEP)) {
    unlinkSync(join(dir, b.name));
  }
  return name;
}
