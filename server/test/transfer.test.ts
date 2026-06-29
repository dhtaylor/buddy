import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAdmin, type TestApp } from './harness.js';

let ctx: TestApp;
let a: ReturnType<typeof import('./harness.js').agent>;
let checkingId = 0;
let helocId = 0;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await makeApp();
  a = (await registerAdmin(ctx.app)).a;
  checkingId = (await a.post('/api/accounts', { name: 'Checking', type: 'checking', openingBalanceCents: 0 })).data.id;
  helocId = (
    await a.post('/api/accounts', {
      name: 'HELOC',
      type: 'heloc',
      openingBalanceCents: 0,
      creditLimitCents: 5_000_000,
      aprBps: 840,
    })
  ).data.id;
});
afterAll(async () => {
  await ctx.close();
});

describe('POST /ledger/transfer', () => {
  it('creates two linked legs that move balances but are not spending', async () => {
    // Draw $500 from the HELOC into Checking.
    const res = await a.post('/api/ledger/transfer', {
      fromAccountId: helocId,
      toAccountId: checkingId,
      amountCents: 50_000,
      entryDate: today,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveLength(2);
    const transferId = res.data[0].transferId;
    expect(transferId).toBeTruthy();
    expect(res.data.every((l: any) => l.transferId === transferId)).toBe(true);
    expect(res.data.every((l: any) => l.categoryId === null)).toBe(true);

    // Balances moved: Checking +500 (asset), HELOC owes 500 (liability); net unchanged.
    const bal = (await a.get('/api/ledger/balance')).data;
    expect(bal.assetsCents).toBe(50_000);
    expect(bal.liabilitiesCents).toBe(50_000);
    expect(bal.netCents).toBe(0);

    // The HELOC view counts it as a draw.
    const heloc = (await a.get(`/api/accounts/heloc-summary?from=${today}&to=${today}`)).data[0];
    expect(heloc.drawnCents).toBe(50_000);
    expect(heloc.owedCents).toBe(50_000);

    // Not spending: History and Budget show no expense from the transfer.
    const hist = (await a.get('/api/history/by-category')).data;
    expect(hist.categories.find((c: any) => c.categoryId === 0)).toBeUndefined();
    const budget = (await a.get(`/api/budget?date=${today}`)).data;
    expect(budget.totals.expenseActualCents).toBe(0);
    expect(budget.groups.find((g: any) => g.groupName === 'Uncategorized')).toBeUndefined();
  });

  it('rejects a transfer to the same account', async () => {
    const res = await a.post('/api/ledger/transfer', {
      fromAccountId: checkingId,
      toAccountId: checkingId,
      amountCents: 1_000,
      entryDate: today,
    });
    expect(res.status).toBe(400);
  });

  it('deleting one leg removes both', async () => {
    const before = (await a.get('/api/ledger')).data.length;
    const legs = (
      await a.post('/api/ledger/transfer', {
        fromAccountId: checkingId,
        toAccountId: helocId,
        amountCents: 10_000,
        entryDate: today,
      })
    ).data;
    expect((await a.get('/api/ledger')).data.length).toBe(before + 2);

    await a.del(`/api/ledger/${legs[0].id}`);
    expect((await a.get('/api/ledger')).data.length).toBe(before);
  });
});
