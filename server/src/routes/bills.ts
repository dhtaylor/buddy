import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, toISODate, type Bill, type BillOccurrence } from '@buddy/shared';
import { db } from '../db/index.js';
import { accounts, billOccurrences, bills, ledgerEntries } from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';

const recurrenceEnum = z.enum(['monthly', 'weekly', 'biweekly', 'yearly', 'custom']);

const billBody = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().nullable().optional(),
  recurrence: recurrenceEnum,
  typicalDay: z.number().int().min(1).max(31).nullable().optional(),
  note: z.string().nullable().optional(),
});

const occurrenceInput = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int(),
});

const addOccurrencesBody = z.object({
  occurrences: z.array(occurrenceInput).min(1),
});

const updateOccurrenceBody = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountCents: z.number().int().optional(),
  paid: z.boolean().optional(),
});

const payBody = z.object({
  accountId: z.number().int(),
});

function billToDto(row: typeof bills.$inferSelect): Bill {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    categoryId: row.categoryId,
    recurrence: row.recurrence as Bill['recurrence'],
    typicalDay: row.typicalDay,
    note: row.note,
  };
}

function occurrenceToDto(row: typeof billOccurrences.$inferSelect): BillOccurrence {
  return {
    id: row.id,
    billId: row.billId,
    dueDate: row.dueDate,
    amountCents: row.amountCents,
    paid: row.paid,
    ledgerEntryId: row.ledgerEntryId,
  };
}

/** Load a bill scoped to the household, or throw 404. */
async function requireBill(
  billId: number,
  householdId: number,
): Promise<typeof bills.$inferSelect> {
  const bill = (
    await db
      .select()
      .from(bills)
      .where(and(eq(bills.id, billId), eq(bills.householdId, householdId)))
      .limit(1)
  )[0];
  if (!bill) throw notFound('Bill not found');
  return bill;
}

/** Load an occurrence and verify its parent bill belongs to the household. */
async function requireOccurrence(
  occurrenceId: number,
  householdId: number,
): Promise<{ occurrence: typeof billOccurrences.$inferSelect; bill: typeof bills.$inferSelect }> {
  const occurrence = (
    await db.select().from(billOccurrences).where(eq(billOccurrences.id, occurrenceId)).limit(1)
  )[0];
  if (!occurrence) throw notFound('Occurrence not found');
  const bill = await requireBill(occurrence.billId, householdId);
  return { occurrence, bill };
}

const billsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  // List bills with their occurrences for the household.
  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const billRows = await db.select().from(bills).where(eq(bills.householdId, householdId));

    const ids = billRows.map((b) => b.id);
    const occRows = ids.length
      ? await db
          .select()
          .from(billOccurrences)
          .where(inArray(billOccurrences.billId, ids))
          .orderBy(asc(billOccurrences.dueDate))
      : [];

    const byBill = new Map<number, BillOccurrence[]>();
    for (const o of occRows) {
      const list = byBill.get(o.billId) ?? [];
      list.push(occurrenceToDto(o));
      byBill.set(o.billId, list);
    }

    const data = billRows.map((b) => ({
      ...billToDto(b),
      occurrences: byBill.get(b.id) ?? [],
    }));
    return reply.send({ data });
  });

  // Occurrences in a date range, joined with bill name/category, for week grouping.
  app.get('/occurrences', async (req, reply) => {
    const { householdId } = requireSession(req);
    const q = req.query as { from?: string; to?: string };
    const today = toISODate(new Date());
    const from = q.from ?? today;
    const to = q.to ?? addDays(today, 56); // ~8 weeks

    const rows = await db
      .select({
        id: billOccurrences.id,
        billId: billOccurrences.billId,
        dueDate: billOccurrences.dueDate,
        amountCents: billOccurrences.amountCents,
        paid: billOccurrences.paid,
        ledgerEntryId: billOccurrences.ledgerEntryId,
        billName: bills.name,
        categoryId: bills.categoryId,
      })
      .from(billOccurrences)
      .innerJoin(bills, eq(billOccurrences.billId, bills.id))
      .where(
        and(
          eq(bills.householdId, householdId),
          gte(billOccurrences.dueDate, from),
          lte(billOccurrences.dueDate, to),
        ),
      )
      .orderBy(asc(billOccurrences.dueDate));

    return reply.send({ data: rows });
  });

  // Create a bill.
  app.post('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const body = billBody.parse(req.body);
    const row = (
      await db
        .insert(bills)
        .values({
          householdId,
          name: body.name,
          categoryId: body.categoryId ?? null,
          recurrence: body.recurrence,
          typicalDay: body.typicalDay ?? null,
          note: body.note ?? null,
        })
        .returning()
    )[0];
    return reply.code(201).send({ data: billToDto(row) });
  });

  // Update a bill.
  app.put('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const body = billBody.parse(req.body);
    const row = (
      await db
        .update(bills)
        .set({
          name: body.name,
          categoryId: body.categoryId ?? null,
          recurrence: body.recurrence,
          typicalDay: body.typicalDay ?? null,
          note: body.note ?? null,
        })
        .where(and(eq(bills.id, id), eq(bills.householdId, householdId)))
        .returning()
    )[0];
    if (!row) throw notFound('Bill not found');
    return reply.send({ data: billToDto(row) });
  });

  // Delete a bill (and its occurrences).
  app.delete('/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const bill = (
      await db
        .select()
        .from(bills)
        .where(and(eq(bills.id, id), eq(bills.householdId, householdId)))
        .limit(1)
    )[0];
    if (!bill) throw notFound('Bill not found');
    await db.delete(billOccurrences).where(eq(billOccurrences.billId, id));
    await db.delete(bills).where(eq(bills.id, id));
    return reply.send({ data: { ok: true } });
  });

  // Add one or more occurrences to a bill (supports SPLIT via multiple rows).
  app.post('/:id/occurrences', async (req, reply) => {
    const { householdId } = requireSession(req);
    const billId = Number((req.params as { id: string }).id);
    await requireBill(billId, householdId);
    const body = addOccurrencesBody.parse(req.body);
    const rows = await db
      .insert(billOccurrences)
      .values(
        body.occurrences.map((o) => ({
          billId,
          dueDate: o.dueDate,
          amountCents: o.amountCents,
        })),
      )
      .returning();
    return reply.code(201).send({ data: rows.map(occurrenceToDto) });
  });

  // Edit an occurrence (adjust the floating due date, amount, or paid flag).
  app.put('/occurrences/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    await requireOccurrence(id, householdId);
    const body = updateOccurrenceBody.parse(req.body);
    const patch: Partial<typeof billOccurrences.$inferInsert> = {};
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
    if (body.amountCents !== undefined) patch.amountCents = body.amountCents;
    if (body.paid !== undefined) patch.paid = body.paid;
    if (Object.keys(patch).length === 0) throw badRequest('No fields to update');
    const row = (
      await db.update(billOccurrences).set(patch).where(eq(billOccurrences.id, id)).returning()
    )[0];
    return reply.send({ data: occurrenceToDto(row) });
  });

  // Pay an occurrence: create a ledger entry, mark occurrence paid + link entry.
  app.post('/occurrences/:id/pay', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const { occurrence, bill } = await requireOccurrence(id, householdId);
    const body = payBody.parse(req.body);

    // Verify the account belongs to the household.
    const account = (
      await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, body.accountId), eq(accounts.householdId, householdId)))
        .limit(1)
    )[0];
    if (!account) throw notFound('Account not found');

    const entry = (
      await db
        .insert(ledgerEntries)
        .values({
          householdId,
          accountId: body.accountId,
          entryDate: occurrence.dueDate,
          payee: bill.name,
          categoryId: bill.categoryId,
          amountCents: occurrence.amountCents,
          direction: 'debit',
          cleared: false,
          source: 'manual',
        })
        .returning()
    )[0];

    const updated = (
      await db
        .update(billOccurrences)
        .set({ paid: true, ledgerEntryId: entry.id })
        .where(eq(billOccurrences.id, id))
        .returning()
    )[0];

    return reply.send({ data: occurrenceToDto(updated) });
  });
};

export default billsRoutes;
