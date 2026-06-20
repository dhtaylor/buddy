import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { LedgerEntry } from '@buddy/shared';
import { db } from '../db/index.js';
import { accounts, categories, ledgerEntries } from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';

/** A ledger entry augmented with its per-account cumulative running balance. */
export interface LedgerEntryWithBalance extends LedgerEntry {
  runningBalanceCents: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const entryBody = z.object({
  accountId: z.number().int(),
  entryDate: z.string().regex(ISO_DATE, 'entryDate must be YYYY-MM-DD'),
  payee: z.string().min(1),
  categoryId: z.number().int().nullable().optional(),
  amountCents: z.number().int(),
  direction: z.enum(['debit', 'credit']),
  cleared: z.boolean().optional(),
  clearedDate: z.string().regex(ISO_DATE).nullable().optional(),
  note: z.string().nullable().optional(),
});

const clearedBody = z.object({
  cleared: z.boolean(),
  clearedDate: z.string().regex(ISO_DATE).nullable().optional(),
});

const bulkCategorizeBody = z.object({
  ids: z.array(z.number().int()).min(1),
  categoryId: z.number().int().nullable(),
});

function toDto(row: typeof ledgerEntries.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    entryDate: row.entryDate,
    payee: row.payee,
    categoryId: row.categoryId,
    amountCents: row.amountCents,
    direction: row.direction as LedgerEntry['direction'],
    cleared: row.cleared,
    clearedDate: row.clearedDate,
    source: row.source as LedgerEntry['source'],
    note: row.note,
  };
}

/** Signed delta a ledger entry applies to a balance: credit adds, debit subtracts. */
export function signedAmountCents(entry: Pick<LedgerEntry, 'amountCents' | 'direction'>): number {
  return entry.direction === 'credit' ? entry.amountCents : -entry.amountCents;
}

/**
 * Pure: compute the per-account cumulative running balance for a list of entries.
 *
 * Entries are summed in the given order (caller must pass them ordered by
 * entryDate asc, then id asc). The running balance for each entry starts from
 * its account's `openingBalanceCents` and accumulates the signed amount of every
 * prior entry in that same account (credit adds, debit subtracts). The balance is
 * tracked independently per account.
 *
 * @param entries  ledger entries, already ordered (entryDate asc, id asc)
 * @param openingByAccount  map of accountId -> opening balance cents
 */
export function computeRunningBalances(
  entries: LedgerEntry[],
  openingByAccount: Map<number, number>,
): LedgerEntryWithBalance[] {
  const balances = new Map<number, number>();
  return entries.map((entry) => {
    const start = balances.has(entry.accountId)
      ? (balances.get(entry.accountId) as number)
      : openingByAccount.get(entry.accountId) ?? 0;
    const running = start + signedAmountCents(entry);
    balances.set(entry.accountId, running);
    return { ...entry, runningBalanceCents: running };
  });
}

const ledgerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  // GET / ?accountId=&from=&to=  -> LedgerEntryWithBalance[]
  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const q = req.query as { accountId?: string; from?: string; to?: string };

    // Opening balances for every household account (running balance is per account).
    const accountRows = db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .all();
    const openingByAccount = new Map<number, number>(
      accountRows.map((a) => [a.id, a.openingBalanceCents]),
    );

    // Filters: compute running balance over the full per-account history, so to
    // keep the per-account balance correct we filter only by account here and by
    // date in-memory after accumulation.
    const where = [eq(ledgerEntries.householdId, householdId)];
    if (q.accountId !== undefined && q.accountId !== '') {
      where.push(eq(ledgerEntries.accountId, Number(q.accountId)));
    }

    const rows = db
      .select()
      .from(ledgerEntries)
      .where(and(...where))
      .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.id))
      .all();

    const withBalance = computeRunningBalances(rows.map(toDto), openingByAccount);

    const from = q.from;
    const to = q.to;
    const filtered = withBalance.filter((e) => {
      if (from && e.entryDate < from) return false;
      if (to && e.entryDate > to) return false;
      return true;
    });

    return reply.send({ data: filtered });
  });

  // GET /balance -> { recordedCents, clearedCents } across all household accounts.
  app.get('/balance', async (req, reply) => {
    const { householdId } = requireSession(req);

    const accountRows = db
      .select()
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .all();
    const openingSum = accountRows.reduce((s, a) => s + a.openingBalanceCents, 0);

    const rows = db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.householdId, householdId))
      .all();

    let recordedCents = openingSum;
    let clearedCents = openingSum;
    for (const row of rows) {
      const delta = signedAmountCents(toDto(row));
      recordedCents += delta;
      if (row.cleared) clearedCents += delta;
    }

    return reply.send({ data: { recordedCents, clearedCents } });
  });

  // POST / -> create entry
  app.post('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const body = entryBody.parse(req.body);

    const account = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, body.accountId), eq(accounts.householdId, householdId)))
      .get();
    if (!account) throw badRequest('Account does not belong to this household');

    const row = db
      .insert(ledgerEntries)
      .values({
        householdId,
        accountId: body.accountId,
        entryDate: body.entryDate,
        payee: body.payee,
        categoryId: body.categoryId ?? null,
        amountCents: body.amountCents,
        direction: body.direction,
        cleared: body.cleared ?? false,
        clearedDate: body.clearedDate ?? null,
        source: 'manual',
        note: body.note ?? null,
      })
      .returning()
      .get();

    return reply.code(201).send({ data: toDto(row) });
  });

  // PUT /:id -> update entry
  app.put('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const body = entryBody.parse(req.body);

    const account = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, body.accountId), eq(accounts.householdId, householdId)))
      .get();
    if (!account) throw badRequest('Account does not belong to this household');

    const row = db
      .update(ledgerEntries)
      .set({
        accountId: body.accountId,
        entryDate: body.entryDate,
        payee: body.payee,
        categoryId: body.categoryId ?? null,
        amountCents: body.amountCents,
        direction: body.direction,
        cleared: body.cleared ?? false,
        clearedDate: body.clearedDate ?? null,
        note: body.note ?? null,
      })
      .where(and(eq(ledgerEntries.id, id), eq(ledgerEntries.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Ledger entry not found');

    return reply.send({ data: toDto(row) });
  });

  // DELETE /:id
  app.delete('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const row = db
      .delete(ledgerEntries)
      .where(and(eq(ledgerEntries.id, id), eq(ledgerEntries.householdId, householdId)))
      .returning()
      .get();
    if (!row) throw notFound('Ledger entry not found');
    return reply.send({ data: { ok: true } });
  });

  // POST /bulk-categorize -> set the same category on many entries at once.
  app.post('/bulk-categorize', async (req, reply) => {
    const { householdId } = requireSession(req);
    const { ids, categoryId } = bulkCategorizeBody.parse(req.body);

    if (categoryId !== null) {
      const cat = db
        .select()
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
        .get();
      if (!cat) throw badRequest('Category does not belong to this household');
    }

    const res = db
      .update(ledgerEntries)
      .set({ categoryId })
      .where(and(eq(ledgerEntries.householdId, householdId), inArray(ledgerEntries.id, ids)))
      .run();

    return reply.send({ data: { updated: res.changes } });
  });

  // PATCH /:id/cleared -> toggle cleared (+ set/clear clearedDate).
  // PUT is also registered so the web `api` client (get/post/put/del only) can reach it.
  app.route({
    method: ['PATCH', 'PUT'],
    url: '/:id/cleared',
    handler: async (req, reply) => {
      const { householdId } = requireSession(req);
      const id = Number((req.params as { id: string }).id);
      const body = clearedBody.parse(req.body);

      const row = db
        .update(ledgerEntries)
        .set({
          cleared: body.cleared,
          clearedDate: body.cleared ? body.clearedDate ?? null : null,
        })
        .where(and(eq(ledgerEntries.id, id), eq(ledgerEntries.householdId, householdId)))
        .returning()
        .get();
      if (!row) throw notFound('Ledger entry not found');

      return reply.send({ data: toDto(row) });
    },
  });
};

export default ledgerRoutes;
