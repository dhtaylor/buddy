// Reusable backup helpers, shared by the CLI script (db/backup.ts) and the
// System Settings backup endpoint. Uses better-sqlite3's online backup API
// (WAL-safe; no need to stop the server).
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';

const KEEP = Number(process.env.BACKUP_KEEP ?? 30);

export function backupDir(): string {
  return process.env.BACKUP_DIR ?? resolve(dirname(config.databasePath), '..', '..', 'backups');
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
    .filter((f) => /^buddy-.*\.sqlite$/.test(f))
    .map((name) => {
      const s = statSync(join(dir, name));
      return { name, sizeBytes: s.size, createdAt: new Date(s.mtimeMs).toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Write a consistent snapshot to ./backups and prune beyond KEEP. Returns the file name. */
export async function runBackup(): Promise<string> {
  const dbPath = config.databasePath;
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);

  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `buddy-${stamp}.sqlite`;
  const dest = join(dir, name);

  const db = new Database(dbPath, { readonly: true });
  await db.backup(dest);
  db.close();

  // Prune oldest beyond KEEP.
  for (const b of listBackups().slice(KEEP)) {
    unlinkSync(join(dir, b.name));
  }
  return name;
}
