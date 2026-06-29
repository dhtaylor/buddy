import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import Papa from 'papaparse';
// node-ofx-parser ships no type declarations; it's a CommonJS module exposing { parse, serialize }.
// @ts-expect-error -- no @types package exists for this dependency.
import ofx from 'node-ofx-parser';
import { toCents, diffDays } from '@buddy/shared';
import type {
  EntryDirection,
  ImportFormat,
  ImportedTransaction,
  ImportRecord,
  LedgerEntry,
} from '@buddy/shared';
import { db } from '../db/index.js';
import {
  accounts,
  importedTransactions,
  imports,
  ledgerEntries,
} from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

/* ------------------------------------------------------------------ *
 * Pure, exported helpers (the high-risk logic — unit-tested).
 * ------------------------------------------------------------------ */

/** A bank row after parsing+normalizing, before persistence. */
export interface NormalizedRow {
  /** ISO "YYYY-MM-DD". */
  txnDate: string;
  description: string;
  /** Signed integer cents. Negative = money out (debit), positive = money in (credit). */
  amountCents: number;
}

/** Detect import format from a filename extension. */
export function detectFormat(filename: string): ImportFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) return 'ofx';
  return null;
}

/** Direction implied by a signed amount. Negative = money out = debit. */
export function directionForAmount(amountCents: number): EntryDirection {
  return amountCents < 0 ? 'debit' : 'credit';
}

/**
 * Stable fingerprint for dedupe. Built from the fields a re-download of the
 * same statement would reproduce identically. accountId is included so the same
 * row imported into two accounts stays distinct.
 */
export function fingerprint(
  accountId: number,
  txnDate: string,
  amountCents: number,
  description: string,
): string {
  const normDesc = description.trim().replace(/\s+/g, ' ').toLowerCase();
  const key = `${accountId}|${txnDate}|${amountCents}|${normDesc}`;
  return createHash('sha256').update(key).digest('hex');
}

/** Normalize an OFX OFX-style date (YYYYMMDD[HHMMSS...]) to ISO "YYYY-MM-DD". */
function ofxDateToIso(raw: string): string {
  const digits = String(raw).trim();
  const m = digits.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) throw badRequest(`Unrecognized OFX date: ${raw}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Normalize a CSV-style date into ISO "YYYY-MM-DD". Accepts ISO and MM/DD/YYYY. */
function csvDateToIso(raw: string): string {
  const s = raw.trim();
  // Already ISO.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US-style M/D/Y or M-D-Y (also accepts 2-digit year).
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    let [, mm, dd, yy] = us;
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  throw badRequest(`Unrecognized date: ${raw}`);
}

/** Case-insensitive header lookup against a parsed CSV row object. */
function pick(row: Record<string, string>, ...names: string[]): string | undefined {
  const lowerMap = new Map<string, string>();
  for (const key of Object.keys(row)) lowerMap.set(key.trim().toLowerCase(), row[key]);
  for (const n of names) {
    const v = lowerMap.get(n.toLowerCase());
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

/**
 * Parse a bank CSV into normalized rows.
 *
 * Supports the two common bank layouts:
 *  - Single signed "Amount" column:   Date, Description, Amount   (-12.34 = out)
 *  - Two-column Debit/Credit:          Date, Description, Debit, Credit
 *    (a value in Debit => money out/negative; a value in Credit => money in/positive)
 *
 * Header matching is case-insensitive and tolerant of common aliases.
 */
export function parseCsv(content: string): NormalizedRow[] {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows: NormalizedRow[] = [];

  for (const raw of parsed.data) {
    if (!raw || typeof raw !== 'object') continue;

    const dateStr = pick(raw, 'date', 'transaction date', 'posted date', 'posting date');
    const desc =
      pick(raw, 'description', 'payee', 'name', 'memo', 'details') ?? '';
    if (!dateStr) continue; // skip blank / footer rows

    let amountCents: number | null = null;

    const amountStr = pick(raw, 'amount', 'amt');
    if (amountStr !== undefined) {
      amountCents = toCents(parseFloat(amountStr.replace(/[$,]/g, '')));
    } else {
      const debitStr = pick(raw, 'debit', 'withdrawal', 'withdrawals', 'money out');
      const creditStr = pick(raw, 'credit', 'deposit', 'deposits', 'money in');
      if (debitStr !== undefined) {
        amountCents = -Math.abs(toCents(parseFloat(debitStr.replace(/[$,]/g, ''))));
      } else if (creditStr !== undefined) {
        amountCents = Math.abs(toCents(parseFloat(creditStr.replace(/[$,]/g, ''))));
      }
    }

    if (amountCents === null || !Number.isFinite(amountCents)) continue;

    rows.push({
      txnDate: csvDateToIso(dateStr),
      description: desc.trim(),
      amountCents,
    });
  }

  return rows;
}

/** Coerce the OFX parser's STMTTRN container into an array of records. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse an OFX (or QFX) file into normalized rows.
 * Reads STMTTRN entries from the bank statement transaction list. TRNAMT is
 * already signed (negative = money out), so we keep its sign.
 */
export function parseOfx(content: string): NormalizedRow[] {
  const data = ofx.parse(content) as any;
  const stmt =
    data?.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS ??
    data?.OFX?.CREDITCARDMSGSRSV1?.CCSTMTTRNRS?.CCSTMTRS;
  const txns = asArray<any>(stmt?.BANKTRANLIST?.STMTTRN);

  const rows: NormalizedRow[] = [];
  for (const t of txns) {
    if (!t || t.TRNAMT === undefined || t.DTPOSTED === undefined) continue;
    const amount = parseFloat(String(t.TRNAMT));
    if (!Number.isFinite(amount)) continue;
    const description = String(t.NAME ?? t.MEMO ?? '').trim();
    rows.push({
      txnDate: ofxDateToIso(String(t.DTPOSTED)),
      description,
      amountCents: toCents(amount),
    });
  }
  return rows;
}

/** A not-yet-cleared manual ledger entry that a bank row could clear. */
export interface MatchCandidate {
  id: number;
  entryDate: string;
  amountCents: number; // stored positive
  direction: EntryDirection;
}

/** True if a candidate manual entry plausibly corresponds to a bank row. */
export function isMatch(row: NormalizedRow, candidate: MatchCandidate): boolean {
  const sameAmount = Math.abs(row.amountCents) === candidate.amountCents;
  const sameDirection = directionForAmount(row.amountCents) === candidate.direction;
  const withinWindow = Math.abs(diffDays(candidate.entryDate, row.txnDate)) <= 4;
  return sameAmount && sameDirection && withinWindow;
}

/**
 * Pick the single best auto-match for a bank row from candidate manual entries.
 * Returns the candidate id only when EXACTLY ONE candidate matches; ambiguity
 * (0 or >1) yields null so the row is staged as "new" for the user to decide.
 */
export function pickMatch(
  row: NormalizedRow,
  candidates: MatchCandidate[],
): number | null {
  const hits = candidates.filter((c) => isMatch(row, c));
  return hits.length === 1 ? hits[0].id : null;
}

/* ------------------------------------------------------------------ *
 * DTO mappers.
 * ------------------------------------------------------------------ */

function importToDto(row: typeof imports.$inferSelect): ImportRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    filename: row.filename,
    sourceFormat: row.sourceFormat as ImportFormat,
    importedAt: row.importedAt,
  };
}

function txnToDto(row: typeof importedTransactions.$inferSelect): ImportedTransaction {
  return {
    id: row.id,
    importId: row.importId,
    txnDate: row.txnDate,
    description: row.description,
    amountCents: row.amountCents,
    fingerprint: row.fingerprint,
    status: row.status as ImportedTransaction['status'],
    matchedEntryId: row.matchedEntryId,
  };
}

function ledgerToDto(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    entryDate: row.entryDate,
    payee: row.payee,
    categoryId: row.categoryId,
    amountCents: row.amountCents,
    direction: row.direction as EntryDirection,
    cleared: row.cleared,
    clearedDate: row.clearedDate,
    source: row.source as LedgerEntry['source'],
    note: row.note,
    transferId: row.transferId,
  };
}

/** A staged transaction enriched with its suggested matching ledger entry. */
interface StagedTxn extends ImportedTransaction {
  matchedEntry: LedgerEntry | null;
}

/* ------------------------------------------------------------------ *
 * Route plugin.
 * ------------------------------------------------------------------ */

const confirmBody = z.object({
  decisions: z
    .array(
      z.object({
        importedTxnId: z.number().int(),
        action: z.enum(['clear', 'add', 'ignore']),
        categoryId: z.number().int().nullable().optional(),
      }),
    )
    .min(1),
});

const importsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  /** Build the staged-transactions view (txn + suggested matched entry) for an import. */
  async function stageView(householdId: number, importId: number): Promise<StagedTxn[]> {
    const txns = await db
      .select()
      .from(importedTransactions)
      .where(eq(importedTransactions.importId, importId));

    const matchedIds = txns
      .map((t) => t.matchedEntryId)
      .filter((id): id is number => id !== null);

    const entries =
      matchedIds.length > 0
        ? await db
            .select()
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.householdId, householdId),
                inArray(ledgerEntries.id, matchedIds),
              ),
            )
        : [];
    const byId = new Map(entries.map((e) => [e.id, e]));

    return txns.map((t) => ({
      ...txnToDto(t),
      matchedEntry:
        t.matchedEntryId !== null && byId.has(t.matchedEntryId)
          ? ledgerToDto(byId.get(t.matchedEntryId)!)
          : null,
    }));
  }

  /** Verify an import belongs to the caller's household; throw 404 otherwise. */
  async function requireImport(householdId: number, importId: number) {
    const imp = (
      await db
        .select()
        .from(imports)
        .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)))
        .limit(1)
    )[0];
    if (!imp) throw notFound('Import not found');
    return imp;
  }

  // GET / — recent imports list.
  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = (
      await db
        .select()
        .from(imports)
        .where(eq(imports.householdId, householdId))
    ).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    return reply.send({ data: rows.map(importToDto) });
  });

  // POST / (multipart) — upload + parse + dedupe + auto-match + stage.
  app.post('/', async (req, reply) => {
    const { householdId } = requireSession(req);

    const file = await req.file();
    if (!file) throw badRequest('No file uploaded');

    // accountId arrives as a multipart field alongside the file.
    const accountField = file.fields?.accountId as { value?: string } | undefined;
    const accountId = Number(accountField?.value);
    if (!Number.isInteger(accountId)) throw badRequest('accountId is required');

    const account = (
      await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
        .limit(1)
    )[0];
    if (!account) throw notFound('Account not found');

    // Discard any abandoned (unconfirmed) draft imports for this account so they
    // don't accumulate or block re-importing the same file. Nothing was written
    // to the ledger for these, so this is safe.
    const staleImports = (
      await db
        .select({ id: imports.id })
        .from(imports)
        .where(
          and(
            eq(imports.householdId, householdId),
            eq(imports.accountId, accountId),
            isNull(imports.confirmedAt),
          ),
        )
    ).map((r) => r.id);
    if (staleImports.length > 0) {
      await db.transaction(async (tx) => {
        await tx
          .delete(importedTransactions)
          .where(inArray(importedTransactions.importId, staleImports));
        await tx.delete(imports).where(inArray(imports.id, staleImports));
      });
    }

    const format = detectFormat(file.filename);
    if (!format) throw badRequest('Unsupported file type (expected .csv or .ofx)');

    const buf = await file.toBuffer();
    const content = buf.toString('utf8');

    let normalized: NormalizedRow[];
    try {
      normalized = format === 'csv' ? parseCsv(content) : parseOfx(content);
    } catch {
      throw badRequest('Could not parse the uploaded file');
    }
    if (normalized.length === 0) throw badRequest('No transactions found in file');

    // Dedupe only against fingerprints from CONFIRMED imports — a draft that was
    // uploaded but never confirmed must not block re-importing the same file.
    const existingFps = new Set(
      (
        await db
          .select({ fp: importedTransactions.fingerprint })
          .from(importedTransactions)
          .innerJoin(imports, eq(importedTransactions.importId, imports.id))
          .where(and(eq(imports.householdId, householdId), isNotNull(imports.confirmedAt)))
      ).map((r) => r.fp),
    );

    // Candidate manual, not-cleared entries in this account for auto-match.
    const candidates: MatchCandidate[] = (
      await db
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.householdId, householdId),
            eq(ledgerEntries.accountId, accountId),
            eq(ledgerEntries.source, 'manual'),
            eq(ledgerEntries.cleared, false),
          ),
        )
    ).map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      amountCents: e.amountCents,
      direction: e.direction as EntryDirection,
    }));

    const importRow = (
      await db
        .insert(imports)
        .values({
          householdId,
          accountId,
          filename: file.filename,
          sourceFormat: format,
          importedAt: new Date().toISOString(),
        })
        .returning()
    )[0];

    let skipped = 0;
    const seenInFile = new Set<string>();
    const claimed = new Set<number>(); // a manual entry only auto-matches one bank row

    for (const row of normalized) {
      const fp = fingerprint(accountId, row.txnDate, row.amountCents, row.description);
      if (existingFps.has(fp) || seenInFile.has(fp)) {
        skipped++;
        continue;
      }
      seenInFile.add(fp);

      const available = candidates.filter((c) => !claimed.has(c.id));
      const matchedEntryId = pickMatch(row, available);
      if (matchedEntryId !== null) claimed.add(matchedEntryId);

      await db.insert(importedTransactions).values({
        importId: importRow.id,
        txnDate: row.txnDate,
        description: row.description,
        amountCents: row.amountCents,
        fingerprint: fp,
        status: matchedEntryId !== null ? 'matched' : 'new',
        matchedEntryId,
      });
    }

    return reply.code(201).send({
      data: {
        import: importToDto(importRow),
        transactions: await stageView(householdId, importRow.id),
        skipped,
      },
    });
  });

  // GET /:id — staged transactions + match suggestions for one import.
  app.get('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const imp = await requireImport(householdId, id);
    return reply.send({
      data: { import: importToDto(imp), transactions: await stageView(householdId, id) },
    });
  });

  // POST /:id/confirm — apply decisions to the ledger.
  app.post('/:id/confirm', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const imp = await requireImport(householdId, id);
    if (imp.confirmedAt) throw conflict('This import was already confirmed');
    const { decisions } = confirmBody.parse(req.body);

    // Load this import's staged transactions, keyed by id.
    const txns = await db
      .select()
      .from(importedTransactions)
      .where(eq(importedTransactions.importId, id));
    const txnById = new Map(txns.map((t) => [t.id, t]));

    await db.transaction(async (tx) => {
      for (const d of decisions) {
        const txn = txnById.get(d.importedTxnId);
        if (!txn) throw badRequest(`Unknown transaction ${d.importedTxnId}`);

        if (d.action === 'ignore') {
          await tx
            .update(importedTransactions)
            .set({ status: 'ignored' })
            .where(eq(importedTransactions.id, txn.id));
          continue;
        }

        if (d.action === 'clear') {
          if (txn.matchedEntryId === null) {
            throw badRequest(`Transaction ${txn.id} has no matched entry to clear`);
          }
          // Scope the update through the household to prevent cross-tenant writes.
          const updated = (
            await tx
              .update(ledgerEntries)
              .set({ cleared: true, clearedDate: txn.txnDate })
              .where(
                and(
                  eq(ledgerEntries.id, txn.matchedEntryId),
                  eq(ledgerEntries.householdId, householdId),
                ),
              )
              .returning()
          )[0];
          if (!updated) throw notFound('Matched ledger entry not found');
          await tx
            .update(importedTransactions)
            .set({ status: 'matched' })
            .where(eq(importedTransactions.id, txn.id));
          continue;
        }

        // d.action === 'add' — create a new cleared, imported ledger entry.
        await tx.insert(ledgerEntries).values({
          householdId,
          accountId: imp.accountId,
          entryDate: txn.txnDate,
          payee: txn.description,
          categoryId: d.categoryId ?? null,
          amountCents: Math.abs(txn.amountCents),
          direction: directionForAmount(txn.amountCents),
          cleared: true,
          clearedDate: txn.txnDate,
          source: 'imported',
          note: null,
        });
        await tx
          .update(importedTransactions)
          .set({ status: 'new' })
          .where(eq(importedTransactions.id, txn.id));
      }

      // Mark the import confirmed so its rows count toward future dedupe.
      await tx
        .update(imports)
        .set({ confirmedAt: new Date().toISOString() })
        .where(eq(imports.id, id));
    });

    return reply.send({
      data: { import: importToDto(imp), transactions: await stageView(householdId, id) },
    });
  });

  // DELETE /:id — discard an unconfirmed draft import (e.g. user hit Cancel).
  // Confirmed imports are kept so dedupe history stays intact.
  app.delete('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const imp = await requireImport(householdId, id);
    if (imp.confirmedAt) throw conflict('Cannot delete a confirmed import');
    await db.transaction(async (tx) => {
      await tx.delete(importedTransactions).where(eq(importedTransactions.importId, id));
      await tx.delete(imports).where(eq(imports.id, id));
    });
    return reply.send({ data: { ok: true } });
  });
};

export default importsRoutes;
