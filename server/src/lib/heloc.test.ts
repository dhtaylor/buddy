import { describe, it, expect } from 'vitest';
import type { Account, LedgerEntry } from '@buddy/shared';
import { estMonthlyInterestCents, helocSummaryFor, summarizeBalances } from './heloc.js';

function acct(over: Partial<Account> & { id: number }): Account {
  return {
    householdId: 1,
    name: 'A',
    type: 'checking',
    openingBalanceCents: 0,
    creditLimitCents: 0,
    aprBps: null,
    ...over,
  };
}

function entry(
  over: Partial<LedgerEntry> & { id: number; accountId: number },
): LedgerEntry {
  return {
    householdId: 1,
    entryDate: '2026-01-15',
    payee: 'Test',
    categoryId: null,
    amountCents: 0,
    direction: 'debit',
    cleared: false,
    clearedDate: null,
    source: 'manual',
    note: null,
    ...over,
  };
}

describe('estMonthlyInterestCents', () => {
  it('returns null when no APR is set', () => {
    expect(estMonthlyInterestCents(100_000, null)).toBeNull();
  });
  it('returns 0 when nothing is owed', () => {
    expect(estMonthlyInterestCents(0, 850)).toBe(0);
    expect(estMonthlyInterestCents(-500, 850)).toBe(0);
  });
  it('computes monthly interest from APR basis points', () => {
    // $25,000 owed at 8.40% APR -> 2,500,000 * 0.084 / 12 = 17,500 cents = $175.00
    expect(estMonthlyInterestCents(2_500_000, 840)).toBe(17_500);
  });
});

describe('summarizeBalances', () => {
  it('splits assets from liabilities and nets them', () => {
    const accounts = [
      acct({ id: 1, type: 'checking', openingBalanceCents: 100_000 }),
      acct({ id: 2, type: 'heloc', openingBalanceCents: -2_500_000, creditLimitCents: 5_000_000 }),
    ];
    const entries = [
      // sweep $1,000 onto the HELOC (credit -> toward zero)
      entry({ id: 1, accountId: 2, amountCents: 100_000, direction: 'credit', cleared: true }),
      // pay a $300 bill from checking (debit)
      entry({ id: 2, accountId: 1, amountCents: 30_000, direction: 'debit', cleared: false }),
    ];
    const r = summarizeBalances(accounts, entries);
    expect(r.assetsCents).toBe(70_000); // 100k - 30k
    expect(r.liabilitiesCents).toBe(2_400_000); // owed 2.5M - 100k swept
    expect(r.netCents).toBe(70_000 - 2_400_000);
    expect(r.recordedCents).toBe(r.netCents); // back-compat: net of all accounts
  });

  it('clearedCents counts opening balances plus only cleared entries', () => {
    const accounts = [acct({ id: 1, openingBalanceCents: 10_000 })];
    const entries = [
      entry({ id: 1, accountId: 1, amountCents: 5_000, direction: 'credit', cleared: true }),
      entry({ id: 2, accountId: 1, amountCents: 2_000, direction: 'credit', cleared: false }),
    ];
    const r = summarizeBalances(accounts, entries);
    expect(r.recordedCents).toBe(17_000);
    expect(r.clearedCents).toBe(15_000);
  });
});

describe('helocSummaryFor', () => {
  const heloc = acct({
    id: 5,
    name: 'HELOC',
    type: 'heloc',
    openingBalanceCents: -2_000_000,
    creditLimitCents: 5_000_000,
    aprBps: 840,
  });

  it('computes owed, available, and interest from the full ledger', () => {
    const entries = [
      entry({ id: 1, accountId: 5, amountCents: 50_000, direction: 'debit' }), // draw
      entry({ id: 2, accountId: 5, amountCents: 300_000, direction: 'credit' }), // sweep
      entry({ id: 3, accountId: 9, amountCents: 999, direction: 'credit' }), // other account, ignored
    ];
    const r = helocSummaryFor(heloc, entries);
    // balance: -2,000,000 - 50,000 + 300,000 = -1,750,000
    expect(r.balanceCents).toBe(-1_750_000);
    expect(r.owedCents).toBe(1_750_000);
    expect(r.availableCents).toBe(5_000_000 - 1_750_000);
    expect(r.estMonthlyInterestCents).toBe(Math.round((1_750_000 * 840) / 10_000 / 12));
  });

  it('scopes swept/drawn to the date range but balance to all entries', () => {
    const entries = [
      entry({ id: 1, accountId: 5, entryDate: '2026-01-05', amountCents: 100_000, direction: 'credit' }),
      entry({ id: 2, accountId: 5, entryDate: '2026-02-10', amountCents: 40_000, direction: 'debit' }),
      entry({ id: 3, accountId: 5, entryDate: '2026-02-20', amountCents: 60_000, direction: 'credit' }),
    ];
    const r = helocSummaryFor(heloc, entries, { from: '2026-02-01', to: '2026-02-28' });
    // balance reflects every entry: -2,000,000 + 100,000 - 40,000 + 60,000 = -1,880,000
    expect(r.balanceCents).toBe(-1_880_000);
    // only February entries counted in swept/drawn
    expect(r.sweptCents).toBe(60_000);
    expect(r.drawnCents).toBe(40_000);
  });

  it('returns null interest fields without a date range or APR', () => {
    const noRange = helocSummaryFor(heloc, []);
    expect(noRange.periodInterestCents).toBeNull();
    expect(noRange.interestSavedCents).toBeNull();

    const noApr = acct({ id: 7, type: 'heloc', openingBalanceCents: -100_000, aprBps: null });
    const r = helocSummaryFor(noApr, [], { from: '2026-01-01', to: '2026-01-10' });
    expect(r.periodInterestCents).toBeNull();
    expect(r.interestSavedCents).toBeNull();
  });

  it('accrues daily interest and credits the sweep with the savings', () => {
    // APR 36.5% -> dailyRate 0.1%/day. Owe $1,000; sweep $1,000 in on Jan 6.
    const acc = acct({
      id: 8,
      type: 'heloc',
      openingBalanceCents: -100_000,
      creditLimitCents: 500_000,
      aprBps: 3650,
    });
    const entries = [
      entry({ id: 1, accountId: 8, entryDate: '2026-01-06', amountCents: 100_000, direction: 'credit' }),
    ];
    const r = helocSummaryFor(acc, entries, { from: '2026-01-01', to: '2026-01-10' });
    // Actual: owed 100,000 for 5 days, 0 for 5 days -> 500,000 * 0.001 = 500 cents.
    expect(r.periodInterestCents).toBe(500);
    // Baseline (no sweep): owed 100,000 all 10 days -> 1,000 cents. Saved = 500.
    expect(r.interestSavedCents).toBe(500);
  });

  it('floors available credit and owed at zero when overpaid', () => {
    const overpaid = acct({
      id: 6,
      type: 'heloc',
      openingBalanceCents: 25_000, // positive = credit balance / overpaid
      creditLimitCents: 1_000_000,
    });
    const r = helocSummaryFor(overpaid, []);
    expect(r.owedCents).toBe(0);
    expect(r.availableCents).toBe(1_000_000);
  });
});
