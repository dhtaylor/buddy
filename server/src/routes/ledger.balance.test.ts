import { describe, it, expect } from 'vitest';
import type { LedgerEntry } from '@buddy/shared';
import { computeRunningBalances, signedAmountCents } from './ledger.js';

function entry(over: Partial<LedgerEntry> & { id: number; accountId: number }): LedgerEntry {
  return {
    householdId: 1,
    entryDate: '2026-01-01',
    payee: 'Test',
    categoryId: null,
    amountCents: 0,
    direction: 'debit',
    cleared: false,
    clearedDate: null,
    source: 'manual',
    note: null,
    transferId: null,
    ...over,
  };
}

describe('signedAmountCents', () => {
  it('credit adds, debit subtracts', () => {
    expect(signedAmountCents({ amountCents: 500, direction: 'credit' })).toBe(500);
    expect(signedAmountCents({ amountCents: 500, direction: 'debit' })).toBe(-500);
  });
});

describe('computeRunningBalances', () => {
  it('starts from the account opening balance', () => {
    const opening = new Map<number, number>([[1, 10_000]]);
    const result = computeRunningBalances(
      [entry({ id: 1, accountId: 1, amountCents: 2_500, direction: 'debit' })],
      opening,
    );
    expect(result[0].runningBalanceCents).toBe(7_500);
  });

  it('defaults opening balance to 0 when account is unknown', () => {
    const result = computeRunningBalances(
      [entry({ id: 1, accountId: 9, amountCents: 1_000, direction: 'credit' })],
      new Map(),
    );
    expect(result[0].runningBalanceCents).toBe(1_000);
  });

  it('accumulates in order with correct debit/credit signs', () => {
    const opening = new Map<number, number>([[1, 0]]);
    const result = computeRunningBalances(
      [
        entry({ id: 1, accountId: 1, amountCents: 10_000, direction: 'credit' }), // +100.00 -> 100.00
        entry({ id: 2, accountId: 1, amountCents: 3_000, direction: 'debit' }), //  -30.00 ->  70.00
        entry({ id: 3, accountId: 1, amountCents: 2_000, direction: 'debit' }), //  -20.00 ->  50.00
      ],
      opening,
    );
    expect(result.map((r) => r.runningBalanceCents)).toEqual([10_000, 7_000, 5_000]);
  });

  it('tracks running balance independently per account', () => {
    const opening = new Map<number, number>([
      [1, 1_000],
      [2, 5_000],
    ]);
    const result = computeRunningBalances(
      [
        entry({ id: 1, accountId: 1, amountCents: 500, direction: 'debit' }), // acct1: 1000-500=500
        entry({ id: 2, accountId: 2, amountCents: 1_000, direction: 'credit' }), // acct2: 5000+1000=6000
        entry({ id: 3, accountId: 1, amountCents: 250, direction: 'credit' }), // acct1: 500+250=750
      ],
      opening,
    );
    expect(result[0].runningBalanceCents).toBe(500);
    expect(result[1].runningBalanceCents).toBe(6_000);
    expect(result[2].runningBalanceCents).toBe(750);
  });

  it('preserves input order in the output (relies on caller ordering)', () => {
    const opening = new Map<number, number>([[1, 0]]);
    const result = computeRunningBalances(
      [
        entry({ id: 5, accountId: 1, entryDate: '2026-01-02', amountCents: 100, direction: 'credit' }),
        entry({ id: 6, accountId: 1, entryDate: '2026-01-03', amountCents: 100, direction: 'credit' }),
      ],
      opening,
    );
    expect(result.map((r) => r.id)).toEqual([5, 6]);
    expect(result.map((r) => r.runningBalanceCents)).toEqual([100, 200]);
  });
});
