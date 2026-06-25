import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Account } from '@buddy/shared';
import { db } from '../db/index.js';
import { accounts, ledgerEntries } from '../db/schema.js';
import { authGuard, requireHouseholdAdmin, requireSession } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';
import { helocSummaryFor } from '../lib/heloc.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const summaryQuery = z.object({
  from: z.string().regex(ISO_DATE).optional(),
  to: z.string().regex(ISO_DATE).optional(),
});

const accountBody = z.object({
  name: z.string().min(1),
  type: z.enum(['checking', 'savings', 'cash', 'heloc']),
  openingBalanceCents: z.number().int(),
  // HELOC-only; ignored (coerced to 0/null) for other account types below.
  creditLimitCents: z.number().int().nonnegative().optional(),
  aprBps: z.number().int().nonnegative().nullable().optional(),
});

function toDto(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    type: row.type as Account['type'],
    openingBalanceCents: row.openingBalanceCents,
    creditLimitCents: row.creditLimitCents,
    aprBps: row.aprBps,
  };
}

/** Normalize HELOC-only fields: zeroed/nulled for non-HELOC account types. */
function helocFields(body: z.infer<typeof accountBody>) {
  if (body.type !== 'heloc') return { creditLimitCents: 0, aprBps: null };
  return { creditLimitCents: body.creditLimitCents ?? 0, aprBps: body.aprBps ?? null };
}

const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = await db.select().from(accounts).where(eq(accounts.householdId, householdId));
    return reply.send({ data: rows.map(toDto) });
  });

  // Per-HELOC cash-sweep summary. Optional ?from&to (YYYY-MM-DD) scope the
  // swept/drawn totals to a period; the balance always reflects every entry.
  app.get('/heloc-summary', async (req, reply) => {
    const { householdId } = requireSession(req);
    const q = summaryQuery.parse(req.query);

    const helocRows = (
      await db.select().from(accounts).where(eq(accounts.householdId, householdId))
    ).filter((a) => a.type === 'heloc');

    if (helocRows.length === 0) return reply.send({ data: [] });

    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.householdId, householdId));

    const range = { from: q.from, to: q.to };
    return reply.send({ data: helocRows.map((a) => helocSummaryFor(a, entries, range)) });
  });

  app.post('/', async (req, reply) => {
    const { userId, householdId } = requireSession(req);
    await requireHouseholdAdmin(userId, householdId);
    const body = accountBody.parse(req.body);
    const row = (
      await db
        .insert(accounts)
        .values({ householdId, ...body, ...helocFields(body) })
        .returning()
    )[0];
    return reply.code(201).send({ data: toDto(row) });
  });

  app.put('/:id', async (req, reply) => {
    const { userId, householdId } = requireSession(req);
    await requireHouseholdAdmin(userId, householdId);
    const id = Number((req.params as { id: string }).id);
    const body = accountBody.parse(req.body);
    const row = (
      await db
        .update(accounts)
        .set({ ...body, ...helocFields(body) })
        .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
        .returning()
    )[0];
    if (!row) throw notFound('Account not found');
    return reply.send({ data: toDto(row) });
  });

  app.delete('/:id', async (req, reply) => {
    const { userId, householdId } = requireSession(req);
    await requireHouseholdAdmin(userId, householdId);
    const id = Number((req.params as { id: string }).id);
    const row = (
      await db
        .delete(accounts)
        .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
        .returning()
    )[0];
    if (!row) throw notFound('Account not found');
    return reply.send({ data: { ok: true } });
  });
};

export default accountsRoutes;
