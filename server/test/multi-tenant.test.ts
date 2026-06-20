import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agent, makeApp, registerAdmin, type TestApp } from './harness.js';

let ctx: TestApp;
let a: ReturnType<typeof import('./harness.js').agent>;
let hh1Id = 0;
let hh2Id = 0;

beforeAll(async () => {
  ctx = await makeApp();
  a = (await registerAdmin(ctx.app)).a;
  hh1Id = (await a.get('/api/household')).data.id;
  // Some data in HH1
  const acct = (await a.post('/api/accounts', { name: 'HH1 Checking', type: 'checking', openingBalanceCents: 0 })).data;
  await a.post('/api/ledger', { accountId: acct.id, entryDate: '2026-06-19', payee: 'HH1 ONLY', categoryId: null, amountCents: 100, direction: 'debit' });
});
afterAll(async () => {
  await ctx.close();
});

describe('household data isolation', () => {
  it('a new household starts empty and segregated', async () => {
    hh2Id = (await a.post('/api/system/households', { name: 'HH2' })).data.id;
    await a.post('/api/household/switch', { householdId: hh2Id });
    expect((await a.get('/api/household')).data.id).toBe(hh2Id);
    expect((await a.get('/api/ledger')).data.length).toBe(0);
    expect((await a.get('/api/accounts')).data.length).toBe(0);
  });

  it('data entered in one household is invisible to the other', async () => {
    // currently in HH2 — add a secret
    const acct = (await a.post('/api/accounts', { name: 'HH2 Checking', type: 'checking', openingBalanceCents: 0 })).data;
    await a.post('/api/ledger', { accountId: acct.id, entryDate: '2026-06-19', payee: 'HH2 SECRET', categoryId: null, amountCents: 200, direction: 'debit' });

    await a.post('/api/household/switch', { householdId: hh1Id });
    const hh1 = (await a.get('/api/ledger')).data;
    expect(hh1.some((e: any) => e.payee === 'HH1 ONLY')).toBe(true);
    expect(hh1.some((e: any) => e.payee === 'HH2 SECRET')).toBe(false);
    expect((await a.get('/api/accounts')).data.some((x: any) => x.name === 'HH2 Checking')).toBe(false);
  });

  it('a user cannot switch into a household they are not a member of', async () => {
    // Add a member to HH1 only, then have them try to switch to HH2.
    const member = (await a.post('/api/auth/add-spouse', { email: 'm@test.local', password: 'password123', displayName: 'M' })).data;
    expect(member.id).toBeGreaterThan(0);

    const m = agent(ctx.app);
    await m.post('/api/auth/login', { email: 'm@test.local', password: 'password123' });
    expect((await m.post('/api/household/switch', { householdId: hh2Id })).status).toBe(403);
  });
});
