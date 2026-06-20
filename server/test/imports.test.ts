import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerAdmin, type TestApp } from './harness.js';

let ctx: TestApp;
let a: ReturnType<typeof import('./harness.js').agent>;
let accountId = 0;
let importId = 0;
const today = new Date().toISOString().slice(0, 10);
const csv = `Date,Description,Amount\n${today},Coffee Shop,-12.34\n${today},Mystery Vendor,-99.99\n`;

beforeAll(async () => {
  ctx = await makeApp();
  a = (await registerAdmin(ctx.app)).a;
  accountId = (await a.post('/api/accounts', { name: 'Checking', type: 'checking', openingBalanceCents: 0 })).data.id;
  // A manual, uncleared entry the bank file should auto-match.
  await a.post('/api/ledger', { accountId, entryDate: today, payee: 'Coffee', categoryId: null, amountCents: 1234, direction: 'debit', cleared: false });
});
afterAll(async () => {
  await ctx.close();
});

describe('import upload, auto-match, and confirm', () => {
  it('upload stages rows and auto-matches without touching the ledger', async () => {
    const before = (await a.get('/api/ledger')).data.length;
    const up = await a.uploadCsv('/api/imports', accountId, csv);
    expect(up.status).toBe(201);
    expect(up.data.transactions.filter((t: any) => t.status === 'matched').length).toBe(1);
    expect(up.data.transactions.filter((t: any) => t.status === 'new').length).toBe(1);
    expect(up.data.skipped).toBe(0);
    // nothing written to the ledger yet
    expect((await a.get('/api/ledger')).data.length).toBe(before);
  });

  it('re-uploading an UNCONFIRMED file is not falsely skipped (regression)', async () => {
    const up = await a.uploadCsv('/api/imports', accountId, csv);
    expect(up.data.skipped).toBe(0);
    expect(up.data.transactions.length).toBe(2);
    importId = up.data.import.id;
  });

  it('confirm clears the match and adds the new entry', async () => {
    const detail = (await a.get(`/api/imports/${importId}`)).data;
    const decisions = detail.transactions.map((t: any) =>
      t.status === 'matched'
        ? { importedTxnId: t.id, action: 'clear' }
        : { importedTxnId: t.id, action: 'add', categoryId: null },
    );
    const res = await a.post(`/api/imports/${importId}/confirm`, { decisions });
    expect(res.status).toBe(200);

    const entries = (await a.get('/api/ledger')).data;
    expect(entries.length).toBe(2); // original + 1 added
    expect(entries.find((e: any) => e.payee === 'Coffee').cleared).toBe(true);
  });

  it('re-confirming the same import is rejected (409)', async () => {
    const res = await a.post(`/api/imports/${importId}/confirm`, {
      decisions: [{ importedTxnId: 1, action: 'ignore' }],
    });
    expect(res.status).toBe(409);
  });

  it('after confirming, re-upload of the same file IS skipped as duplicates', async () => {
    const up = await a.uploadCsv('/api/imports', accountId, csv);
    expect(up.data.skipped).toBe(2);
    expect(up.data.transactions.length).toBe(0);
  });
});
