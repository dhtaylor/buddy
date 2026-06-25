import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  addDays,
  periodFor,
  periodLabel,
  toISODate,
  type Period,
  type PeriodLength,
} from '@buddy/shared';
import { db } from '../db/index.js';
import { budgetLines, budgetPeriods, categories, households, ledgerEntries } from '../db/schema.js';
import { authGuard, requireSession } from '../lib/auth.js';
import { notFound } from '../lib/errors.js';

/** A period with a human label, as returned to clients. */
export interface LabeledPeriod extends Period {
  label: string;
}

/**
 * Pure: build the ordered list of periods (of the household's configured length)
 * that cover the inclusive range [from, to].
 *
 * The first period is the one containing `from`; subsequent periods follow with
 * no gaps until one contains (or passes) `to`. Each period is anchored via
 * `periodFor`, so boundaries line up with the household's budget periods.
 */
export function buildPeriods(
  from: string,
  to: string,
  length: PeriodLength,
  anchorDate: string,
  customDays?: number | null,
): LabeledPeriod[] {
  const periods: LabeledPeriod[] = [];
  let cursor = from;
  // Guard against pathological inputs (from after to) and runaway loops.
  let guard = 0;
  while (cursor <= to && guard < 1000) {
    const period = periodFor(cursor, length, anchorDate, customDays ?? undefined);
    periods.push({ ...period, label: periodLabel(period) });
    cursor = addDays(period.endDate, 1);
    guard += 1;
  }
  return periods;
}

/**
 * Pure: the default range = the last `count` periods ending with the period that
 * contains `today`. Returns the [from, to] ISO bounds (from = start of the
 * earliest period, to = end of the latest).
 */
export function defaultRange(
  today: string,
  count: number,
  length: PeriodLength,
  anchorDate: string,
  customDays?: number | null,
): { from: string; to: string } {
  const current = periodFor(today, length, anchorDate, customDays ?? undefined);
  let start = current.startDate;
  for (let i = 1; i < count; i += 1) {
    const prev = periodFor(addDays(start, -1), length, anchorDate, customDays ?? undefined);
    start = prev.startDate;
  }
  return { from: start, to: current.endDate };
}

/**
 * Budgeted (planned) cents per history period, summed over the given (expense)
 * category ids, via the matching budget_period rows. Budget periods are created
 * lazily and matched to history periods by start date (both use the household's
 * anchor/length, so boundaries align); periods never budgeted contribute 0.
 * Returns an array aligned to `periods`.
 */
async function plannedExpensePerPeriod(
  householdId: number,
  periods: LabeledPeriod[],
  categoryIds: Set<number>,
): Promise<number[]> {
  const result = new Array<number>(periods.length).fill(0);
  if (categoryIds.size === 0) return result;

  const periodRows = await db
    .select({ id: budgetPeriods.id, startDate: budgetPeriods.startDate })
    .from(budgetPeriods)
    .where(eq(budgetPeriods.householdId, householdId));
  const idxByPeriodId = new Map<number, number>();
  for (const pr of periodRows) {
    const i = periods.findIndex((p) => p.startDate === pr.startDate);
    if (i >= 0) idxByPeriodId.set(pr.id, i);
  }
  const periodIds = [...idxByPeriodId.keys()];
  if (periodIds.length === 0) return result;

  const lines = await db
    .select({
      periodId: budgetLines.periodId,
      categoryId: budgetLines.categoryId,
      plannedCents: budgetLines.plannedCents,
    })
    .from(budgetLines)
    .where(inArray(budgetLines.periodId, periodIds));
  for (const l of lines) {
    if (!categoryIds.has(l.categoryId)) continue;
    const i = idxByPeriodId.get(l.periodId);
    if (i != null) result[i] += l.plannedCents;
  }
  return result;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIODS = 8;

const historyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', authGuard);

  // GET /by-category ?from=&to=  -> per-category expense spend bucketed by period.
  app.get('/by-category', async (req, reply) => {
    const { householdId } = requireSession(req);
    const q = req.query as { from?: string; to?: string };

    const household = (
      await db.select().from(households).where(eq(households.id, householdId)).limit(1)
    )[0];
    if (!household) throw notFound('Household not found');

    const length = household.periodLength as PeriodLength;
    const anchor = household.periodAnchorDate;
    const customDays = household.periodCustomDays;

    const today = toISODate(new Date());
    const from =
      q.from && ISO_DATE.test(q.from)
        ? q.from
        : defaultRange(today, DEFAULT_PERIODS, length, anchor, customDays).from;
    const to = q.to && ISO_DATE.test(q.to) ? q.to : today;

    const periods = buildPeriods(from, to, length, anchor, customDays);

    // All expense categories for the household (so empty categories still appear
    // in a stable order, and we know each category's group).
    const catRows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.kind, 'expense')))
      .orderBy(asc(categories.groupName), asc(categories.sortOrder), asc(categories.name));

    // Expense actuals = debit entries within the covered range.
    const rangeStart = periods.length ? periods[0].startDate : from;
    const rangeEnd = periods.length ? periods[periods.length - 1].endDate : to;
    const entries = (
      await db
        .select({
          categoryId: ledgerEntries.categoryId,
          entryDate: ledgerEntries.entryDate,
          amountCents: ledgerEntries.amountCents,
        })
        .from(ledgerEntries)
        .where(
          and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.direction, 'debit')),
        )
    ).filter((e) => e.entryDate >= rangeStart && e.entryDate <= rangeEnd);

    // Index periods by date for fast bucketing.
    const findPeriodIndex = (date: string): number =>
      periods.findIndex((p) => date >= p.startDate && date <= p.endDate);

    // Accumulate per category. Uncategorized debits go into their own bucket so
    // they still surface in History (e.g. freshly imported, not-yet-categorized rows).
    const byCategory = new Map<number, number[]>();
    for (const cat of catRows) byCategory.set(cat.id, new Array(periods.length).fill(0));
    const uncategorized = new Array<number>(periods.length).fill(0);
    for (const e of entries) {
      const idx = findPeriodIndex(e.entryDate);
      if (idx < 0) continue;
      if (e.categoryId == null) {
        uncategorized[idx] += e.amountCents;
        continue;
      }
      const bucket = byCategory.get(e.categoryId);
      if (!bucket) continue; // not an expense category (e.g. income) — ignore
      bucket[idx] += e.amountCents;
    }

    const categoriesOut = catRows.map((cat) => {
      const perPeriodCents = byCategory.get(cat.id) ?? new Array(periods.length).fill(0);
      const totalCents = perPeriodCents.reduce((s, n) => s + n, 0);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        groupName: cat.groupName,
        totalCents,
        perPeriodCents,
      };
    });

    // Surface uncategorized spending (categoryId 0 is a sentinel — no real
    // category uses it) so imported/not-yet-categorized debits aren't lost.
    const uncategorizedTotal = uncategorized.reduce((s, n) => s + n, 0);
    if (uncategorizedTotal > 0) {
      categoriesOut.push({
        categoryId: 0,
        categoryName: 'Uncategorized',
        groupName: 'Uncategorized',
        totalCents: uncategorizedTotal,
        perPeriodCents: uncategorized,
      });
    }

    // Convenience: totals per group across the whole range.
    const groupTotals = new Map<string, number>();
    for (const c of categoriesOut) {
      groupTotals.set(c.groupName, (groupTotals.get(c.groupName) ?? 0) + c.totalCents);
    }
    const totalsByGroup = [...groupTotals.entries()].map(([groupName, totalCents]) => ({
      groupName,
      totalCents,
    }));

    // Budgeted (planned) expense per period: sum of budget_lines.plannedCents for
    // the matching budget period, expense categories only. Budget periods are
    // created lazily, so periods that were never budgeted contribute 0.
    const plannedPerPeriodCents = await plannedExpensePerPeriod(
      householdId,
      periods,
      new Set(catRows.map((c) => c.id)),
    );

    return reply.send({
      data: { periods, categories: categoriesOut, totalsByGroup, plannedPerPeriodCents },
    });
  });

  // GET /category/:id ?from=&to=  -> time series of expense spend for one category.
  app.get('/category/:id', async (req, reply) => {
    const { householdId } = requireSession(req);
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { from?: string; to?: string };

    // id 0 is the synthetic "Uncategorized" bucket; otherwise look up a real category.
    const category =
      id === 0
        ? { id: 0, name: 'Uncategorized' }
        : (
            await db
              .select()
              .from(categories)
              .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
              .limit(1)
          )[0];
    if (!category) throw notFound('Category not found');

    const household = (
      await db.select().from(households).where(eq(households.id, householdId)).limit(1)
    )[0];
    if (!household) throw notFound('Household not found');

    const length = household.periodLength as PeriodLength;
    const anchor = household.periodAnchorDate;
    const customDays = household.periodCustomDays;

    const today = toISODate(new Date());
    const from =
      q.from && ISO_DATE.test(q.from)
        ? q.from
        : defaultRange(today, DEFAULT_PERIODS, length, anchor, customDays).from;
    const to = q.to && ISO_DATE.test(q.to) ? q.to : today;

    const periods = buildPeriods(from, to, length, anchor, customDays);
    const rangeStart = periods.length ? periods[0].startDate : from;
    const rangeEnd = periods.length ? periods[periods.length - 1].endDate : to;

    const categoryFilter =
      id === 0 ? isNull(ledgerEntries.categoryId) : eq(ledgerEntries.categoryId, id);
    const entries = (
      await db
        .select({ entryDate: ledgerEntries.entryDate, amountCents: ledgerEntries.amountCents })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.householdId, householdId),
            eq(ledgerEntries.direction, 'debit'),
            categoryFilter,
          ),
        )
    ).filter((e) => e.entryDate >= rangeStart && e.entryDate <= rangeEnd);

    const amounts = new Array(periods.length).fill(0);
    for (const e of entries) {
      const idx = periods.findIndex((p) => e.entryDate >= p.startDate && e.entryDate <= p.endDate);
      if (idx >= 0) amounts[idx] += e.amountCents;
    }

    // Budgeted per period for this category (0 for the synthetic Uncategorized bucket).
    const planned = await plannedExpensePerPeriod(
      householdId,
      periods,
      id === 0 ? new Set() : new Set([id]),
    );

    const points = periods.map((p, i) => ({
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate,
      amountCents: amounts[i],
      plannedCents: planned[i],
    }));

    return reply.send({
      data: { category: { id: category.id, name: category.name }, points },
    });
  });
};

export default historyRoutes;
