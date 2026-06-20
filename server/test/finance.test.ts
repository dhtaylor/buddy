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
