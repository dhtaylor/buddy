import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAdmin, type TestApp } from './harness.js';

let ctx: TestApp;
let a: ReturnType<typeof import('./harness.js').agent>;
let accountId = 0;
let groceriesId = 0;
let incomeId = 0;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await makeApp();
  a = (await registerAdmin(ctx.app)).a;
  accountId = (await a.post('/api/accounts', { name: 'Checking', type: 'checking', openingBalanceCents: 10000 })).data.id;
  groceriesId = (await a.post('/api/categories', { groupName: 'Food', name: 'Groceries', kind: 'expense' })).data.id;
  incomeId = (await a.post('/api/categories', { groupName: 'Income', name: 'Paycheck', kind: 'income' })).data.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('ledger running balance & cleared/recorded', () => {
  it('computes per-entry running balance and recorded vs cleared totals', async () => {
    await a.post('/api/ledger', { accountId, entryDate: today, payee: 'Paycheck', categoryId: incomeId, amountCents: 50000, direction: 'credit', cleared: true });
    await a.post('/api/ledger', { accountId, entryDate: today, payee: 'Store', categoryId: groceriesId, amountCents: 20000, direction: 'debit', cleared: false });

    const entries = (await a.get(`/api/ledger?accountId=${accountId}`)).data;
    expect(entries.length).toBe(2);
    expect(entries.every((e: any) => typeof e.runningBalanceCents === 'number')).toBe(true);

    const bal = (await a.get('/api/ledger/balance')).data;
    expect(bal.recordedCents).toBe(40000); // 10000 + 50000 - 20000
    expect(bal.clearedCents).toBe(60000); // 10000 + 50000 (only cleared)
  });
});

describe('budget auto-rollup from ledger', () => {
  it('fills Actual by category and flags over-budget', async () => {
    const budget = (await a.get(`/api/budget?date=${today}`)).data;
    const line = budget.groups.flatMap((g: any) => g.lines).find((l: any) => l.categoryId === groceriesId);
    expect(line.actualCents).toBe(20000);

    await a.put('/api/budget/line', { periodId: budget.period.id, categoryId: groceriesId, plannedCents: 15000, dueDate: today });
    const summary = (await a.get(`/api/budget/summary?date=${today}`)).data;
    expect(summary.expenseActualCents).toBeGreaterThanOrEqual(20000);
    expect(summary.incomeActualCents).toBe(50000);
    expect(summary.overByCents).toBeGreaterThanOrEqual(5000);
  });
});

describe('uncategorized spend is surfaced', () => {
  let uncatEntryId = 0;
  it('shows in Budget and History under Uncategorized', async () => {
    uncatEntryId = (await a.post('/api/ledger', { accountId, entryDate: today, payee: 'Mystery', categoryId: null, amountCents: 3000, direction: 'debit' })).data.id;

    const budget = (await a.get(`/api/budget?date=${today}`)).data;
    const uncat = budget.groups.find((g: any) => g.groupName === 'Uncategorized');
    expect(uncat?.lines[0].actualCents).toBe(3000);

    const hist = (await a.get('/api/history/by-category')).data;
    expect(hist.categories.find((c: any) => c.categoryId === 0)?.totalCents).toBe(3000);
  });

  it('bulk-categorize moves it out of Uncategorized', async () => {
    const res = await a.post('/api/ledger/bulk-categorize', { ids: [uncatEntryId], categoryId: groceriesId });
    expect(res.data.updated).toBe(1);
    const hist = (await a.get('/api/history/by-category')).data;
    expect(hist.categories.find((c: any) => c.categoryId === 0)).toBeUndefined();
  });
});

describe('archive (hide) a category', () => {
  it('removes it from Budget but keeps its History spend', async () => {
    await a.put(`/api/categories/${groceriesId}/archived`, { archived: true });

    const budget = (await a.get(`/api/budget?date=${today}`)).data;
    const stillThere = budget.groups.flatMap((g: any) => g.lines).some((l: any) => l.categoryId === groceriesId);
    expect(stillThere).toBe(false);

    const hist = (await a.get('/api/history/by-category')).data;
    expect((hist.categories.find((c: any) => c.categoryId === groceriesId)?.totalCents ?? 0)).toBeGreaterThan(0);

    await a.put(`/api/categories/${groceriesId}/archived`, { archived: false }); // restore
  });
});

describe('HELOC cash-sweep view', () => {
  it('splits assets/liabilities and summarizes draws vs. sweeps', async () => {
    const heloc = (
      await a.post('/api/accounts', {
        name: 'HELOC',
        type: 'heloc',
        openingBalanceCents: -2_000_000, // $20,000 owed
        creditLimitCents: 5_000_000,
        aprBps: 840,
      })
    ).data;
    expect(heloc.creditLimitCents).toBe(5_000_000);
    expect(heloc.aprBps).toBe(840);

    // Draw $500 to pay a bill; sweep $3,000 of income onto the HELOC.
    await a.post('/api/ledger', { accountId: heloc.id, entryDate: today, payee: 'Bill draw', amountCents: 50_000, direction: 'debit' });
    await a.post('/api/ledger', { accountId: heloc.id, entryDate: today, payee: 'Income sweep', amountCents: 300_000, direction: 'credit' });

    // owed = 2,000,000 + 50,000 - 300,000 = 1,750,000
    const summary = (await a.get(`/api/accounts/heloc-summary?from=${today}&to=${today}`)).data;
    expect(summary.length).toBe(1);
    const h = summary[0];
    expect(h.owedCents).toBe(1_750_000);
    expect(h.availableCents).toBe(3_250_000);
    expect(h.sweptCents).toBe(300_000);
    expect(h.drawnCents).toBe(50_000);
    expect(h.estMonthlyInterestCents).toBe(Math.round((1_750_000 * 840) / 10_000 / 12));
    // Velocity payoff: a same-day sweep means baseline owed >= actual owed, so saving >= 0.
    expect(typeof h.periodInterestCents).toBe('number');
    expect(h.interestSavedCents).toBeGreaterThanOrEqual(0);

    const bal = (await a.get('/api/ledger/balance')).data;
    expect(bal.liabilitiesCents).toBe(1_750_000); // only the HELOC is a liability
    expect(bal.netCents).toBe(bal.assetsCents - bal.liabilitiesCents);
    expect(bal.recordedCents).toBe(bal.netCents); // back-compat invariant
  });

  it('scopes swept/drawn to the date range, not the balance', async () => {
    const heloc = (await a.get('/api/accounts')).data.find((x: any) => x.type === 'heloc');
    // A sweep dated outside the queried range must not count toward sweptCents.
    await a.post('/api/ledger', { accountId: heloc.id, entryDate: '2020-01-01', payee: 'Old sweep', amountCents: 111, direction: 'credit' });
    const summary = (await a.get(`/api/accounts/heloc-summary?from=${today}&to=${today}`)).data;
    const h = summary[0];
    expect(h.sweptCents).toBe(300_000); // unchanged — old sweep excluded from range
    expect(h.balanceCents).toBe(-1_750_000 + 111); // but balance reflects every entry
  });
});

describe('bills: split + mark paid → ledger', () => {
  it('splitting creates occurrences and paying writes a ledger entry', async () => {
    const bill = (await a.post('/api/bills', { name: 'Internet', categoryId: groceriesId, recurrence: 'monthly' })).data;
    const occs = (await a.post(`/api/bills/${bill.id}/occurrences`, {
      occurrences: [{ dueDate: today, amountCents: 3000 }, { dueDate: today, amountCents: 3000 }],
    })).data;
    expect(occs.length).toBe(2);

    const balBefore = (await a.get('/api/ledger/balance')).data.recordedCents;
    const pay = await a.post(`/api/bills/occurrences/${occs[0].id}/pay`, { accountId });
    expect(pay.status).toBe(200);
    expect(pay.data.paid).toBe(true);
    const balAfter = (await a.get('/api/ledger/balance')).data.recordedCents;
    expect(balAfter).toBe(balBefore - 3000);
  });
});
