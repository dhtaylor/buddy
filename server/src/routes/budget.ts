import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  periodFor,
  periodLabel,
  type Period,
  type PeriodLength,
} from '@buddy/shared';
import { db } from '../db/index.js';
import {
  budgetLines,
  budgetPeriods,
  categories,
  households,
  ledgerEntries,
} from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';

/**
 * A ledger row reduced to the fields needed for budget derivation.
 * Kept minimal so {@link bucketActuals} stays pure and trivially testable.
 */
export interface ActualLedgerRow {
  categoryId: number | null;
  amountCents: number;
  direction: 'debit' | 'credit';
}

/**
 * Derive actual cents per category from ledger rows that already fall within a
 * period. Expense actual = sum of 'debit' entries in expense categories; income
 * actual = sum of 'credit' entries in income categories. Entries whose direction
 * does not match their category kind (e.g. a refund credited to an expense
 * category) are ignored, as are entries with no category. Pure function.
 */
export function bucketActuals(
  rows: ActualLedgerRow[],
  categoryKind: Map<number, 'income' | 'expense'>,
): Map<number, number> {
  const actuals = new Map<number, number>();
  for (const row of rows) {
    if (row.categoryId == null) continue;
    const kind = categoryKind.get(row.categoryId);
    if (!kind) continue;
    const matches =
      (kind === 'expense' && row.direction === 'debit') ||
      (kind === 'income' && row.direction === 'credit');
    if (!matches) continue;
    actuals.set(row.categoryId, (actuals.get(row.categoryId) ?? 0) + row.amountCents);
  }
  return actuals;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The household's configured period containing `date`. */
async function householdPeriodFor(householdId: number, date: string): Promise<Period> {
  const hh = (
    await db.select().from(households).where(eq(households.id, householdId)).limit(1)
  )[0];
  if (!hh) throw notFound('Household not found');
  return periodFor(
    date,
    hh.periodLength as PeriodLength,
    hh.periodAnchorDate,
    hh.periodCustomDays ?? undefined,
  );
}

/**
 * Ensure a budget_period row exists for the period containing `date`, creating
 * it if missing. Returns the persisted row.
 */
async function ensurePeriod(
  householdId: number,
  date: string,
): Promise<typeof budgetPeriods.$inferSelect> {
  const period = await householdPeriodFor(householdId, date);
  const existing = (
    await db
      .select()
      .from(budgetPeriods)
      .where(
        and(
          eq(budgetPeriods.householdId, householdId),
          eq(budgetPeriods.startDate, period.startDate),
          eq(budgetPeriods.endDate, period.endDate),
        ),
      )
      .limit(1)
  )[0];
  if (existing) return existing;
  return (
    await db
      .insert(budgetPeriods)
      .values({
        householdId,
        startDate: period.startDate,
        endDate: period.endDate,
        label: periodLabel(period),
      })
      .returning()
  )[0];
}

interface Totals {
  incomePlannedCents: number;
  expensePlannedCents: number;
  incomeActualCents: number;
  expenseActualCents: number;
  overByCents: number;
}

interface BudgetLineDto {
  categoryId: number;
  categoryName: string;
  kind: 'income' | 'expense';
  plannedCents: number;
  dueDate: string | null;
  actualCents: number;
  overBudget: boolean;
}

/**
 * Build the full budget view for a household + persisted period: every category
 * (even with no budget_line yet), grouped by groupName preserving sortOrder,
 * with derived actuals and totals.
 */
async function buildBudget(householdId: number, period: typeof budgetPeriods.$inferSelect) {
  // Archived categories are hidden from the Budget view (and thus its totals);
  // their past spend still surfaces in History.
  const cats = await db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.archived, false)));

  const lines = await db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.periodId, period.id));
  const lineByCategory = new Map(lines.map((l) => [l.categoryId, l]));

  const allLedgerRows = await db
    .select({
      categoryId: ledgerEntries.categoryId,
      amountCents: ledgerEntries.amountCents,
      direction: ledgerEntries.direction,
      transferId: ledgerEntries.transferId,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.householdId, householdId),
        gte(ledgerEntries.entryDate, period.startDate),
        lte(ledgerEntries.entryDate, period.endDate),
      ),
    );
  // Transfers move money between accounts; exclude both legs from income/expense
  // actuals (they still affect balances, just not the budget).
  const ledgerRows = allLedgerRows.filter((r) => r.transferId == null);

  const kindByCategory = new Map(
    cats.map((c) => [c.id, c.kind as 'income' | 'expense']),
  );
  const actuals = bucketActuals(
    ledgerRows.map((r) => ({
      categoryId: r.categoryId,
      amountCents: r.amountCents,
      direction: r.direction as 'debit' | 'credit',
    })),
    kindByCategory,
  );

  const totals: Totals = {
    incomePlannedCents: 0,
    expensePlannedCents: 0,
    incomeActualCents: 0,
    expenseActualCents: 0,
    overByCents: 0,
  };

  // Group categories by groupName, preserving sortOrder within each group and
  // first-appearance order of the groups.
  const sorted = [...cats].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const groupOrder: string[] = [];
  const groupMap = new Map<string, BudgetLineDto[]>();

  for (const c of sorted) {
    const kind = c.kind as 'income' | 'expense';
    const line = lineByCategory.get(c.id);
    const plannedCents = line?.plannedCents ?? 0;
    const actualCents = actuals.get(c.id) ?? 0;
    const overBudget = kind === 'expense' && actualCents > plannedCents;

    if (kind === 'income') {
      totals.incomePlannedCents += plannedCents;
      totals.incomeActualCents += actualCents;
    } else {
      totals.expensePlannedCents += plannedCents;
      totals.expenseActualCents += actualCents;
    }

    if (!groupMap.has(c.groupName)) {
      groupMap.set(c.groupName, []);
      groupOrder.push(c.groupName);
    }
    groupMap.get(c.groupName)!.push({
      categoryId: c.id,
      categoryName: c.name,
      kind,
      plannedCents,
      dueDate: line?.dueDate ?? null,
      actualCents,
      overBudget,
    });
  }

  // Uncategorized expense (e.g. freshly imported, not-yet-categorized debits) has
  // no budget line, but should still count toward Actual and be visible.
  const uncategorizedExpenseCents = ledgerRows
    .filter((r) => r.categoryId == null && r.direction === 'debit')
    .reduce((sum, r) => sum + r.amountCents, 0);
  totals.expenseActualCents += uncategorizedExpenseCents;

  totals.overByCents = totals.expenseActualCents - totals.expensePlannedCents;

  const groups = groupOrder.map((groupName) => ({
    groupName,
    lines: groupMap.get(groupName)!,
  }));

  if (uncategorizedExpenseCents > 0) {
    groups.push({
      groupName: 'Uncategorized',
      lines: [
        {
          categoryId: 0, // sentinel — not a real category; rendered read-only
          categoryName: 'Uncategorized',
          kind: 'expense',
          plannedCents: 0,
          dueDate: null,
          actualCents: uncategorizedExpenseCents,
          overBudget: true,
        },
      ],
    });
  }

  return { totals, groups };
}

const dateQuery = z.object({
  date: z.string().regex(ISO_RE).optional(),
});

const lineBody = z.object({
  periodId: z.number().int(),
  categoryId: z.number().int(),
  plannedCents: z.number().int(),
  dueDate: z.string().regex(ISO_RE).nullable().optional(),
});

const budgetRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  // Full budget for the period containing ?date (default today).
  app.get('/', async (req, reply) => {
    const { householdId } = requireSession(req);
    const { date } = dateQuery.parse(req.query);
    const period = await ensurePeriod(householdId, date ?? todayISO());
    const { totals, groups } = await buildBudget(householdId, period);
    return reply.send({
      data: {
        period: {
          id: period.id,
          startDate: period.startDate,
          endDate: period.endDate,
          label: period.label,
        },
        groups,
        totals,
      },
    });
  });

  // Compact totals for the Home dashboard.
  app.get('/summary', async (req, reply) => {
    const { householdId } = requireSession(req);
    const { date } = dateQuery.parse(req.query);
    const period = await ensurePeriod(householdId, date ?? todayISO());
    const { totals } = await buildBudget(householdId, period);
    return reply.send({
      data: {
        period: {
          startDate: period.startDate,
          endDate: period.endDate,
          label: period.label,
        },
        ...totals,
      },
    });
  });

  // Upsert a planned budget line for (period, category).
  app.put('/line', async (req, reply) => {
    const { householdId } = requireSession(req);
    const body = lineBody.parse(req.body);

    const period = (
      await db
        .select()
        .from(budgetPeriods)
        .where(
          and(eq(budgetPeriods.id, body.periodId), eq(budgetPeriods.householdId, householdId)),
        )
        .limit(1)
    )[0];
    if (!period) throw notFound('Budget period not found');

    const category = (
      await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, body.categoryId), eq(categories.householdId, householdId)))
        .limit(1)
    )[0];
    if (!category) throw notFound('Category not found');

    const existing = (
      await db
        .select()
        .from(budgetLines)
        .where(
          and(
            eq(budgetLines.periodId, body.periodId),
            eq(budgetLines.categoryId, body.categoryId),
          ),
        )
        .limit(1)
    )[0];

    const dueDate = body.dueDate ?? null;
    const row = existing
      ? (
          await db
            .update(budgetLines)
            .set({ plannedCents: body.plannedCents, dueDate })
            .where(eq(budgetLines.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(budgetLines)
            .values({
              periodId: body.periodId,
              categoryId: body.categoryId,
              plannedCents: body.plannedCents,
              dueDate,
            })
            .returning()
        )[0];

    return reply.send({
      data: {
        id: row.id,
        periodId: row.periodId,
        categoryId: row.categoryId,
        plannedCents: row.plannedCents,
        dueDate: row.dueDate,
        note: row.note,
      },
    });
  });

  // All persisted periods for this household (period picker).
  app.get('/periods', async (req, reply) => {
    const { householdId } = requireSession(req);
    const rows = await db
      .select()
      .from(budgetPeriods)
      .where(eq(budgetPeriods.householdId, householdId));
    rows.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
    return reply.send({ data: rows });
  });

  // Ensure/create the period containing ?date (default today).
  app.post('/period', async (req, reply) => {
    const { householdId } = requireSession(req);
    const { date } = dateQuery.parse(req.query);
    const period = await ensurePeriod(householdId, date ?? todayISO());
    return reply.send({ data: period });
  });
};

export default budgetRoutes;
