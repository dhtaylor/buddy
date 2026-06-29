import { describe, it, expect } from 'vitest';
import type { LedgerEntry } from '@buddy/shared';
import { summarizeBalances } from '../lib/heloc.js';
import { buildTransferLegs, computeRunningBalances } from './ledger.js';

const base = {
  householdId: 1,
  fromAccountName: 'HELOC',
  toAccountName: 'Checking',
  amountCents: 50000,
  entryDate: '2026-06-29',
  cleared: false,
  note: null,
  transferId: 't-1',
};

describe('buildTransferLegs', () => {
  it('debits the source and credits the destination with one shared transferId', () => {
    const legs = buildTransferLegs({ ...base, fromAccountId: 2, toAccountId: 1 });

    expect(legs).toHaveLength(2);
    const [debit, credit] = legs;

    expect(debit.accountId).toBe(2);
    expect(debit.direction).toBe('debit');
    expect(debit.payee).toBe('Transfer to Checking');

    expect(credit.accountId).toBe(1);
    expect(credit.direction).toBe('credit');
    expect(credit.payee).toBe('Transfer from HELOC');

    // Both legs: same amount/date, categoryless, same transferId.
    for (const leg of legs) {
      expect(leg.amountCents).toBe(50000);
      expect(leg.entryDate).toBe('2026-06-29');
      expect(leg.categoryId).toBeNull();
      expect(leg.transferId).toBe('t-1');
    }
  });

  it('sets clearedDate to the entry date only when cleared', () => {
    const [legCleared] = buildTransferLegs({
      ...base,
      fromAccountId: 2,
      toAccountId: 1,
      cleared: true,
    });
    expect(legCleared.cleared).toBe(true);
    expect(legCleared.clearedDate).toBe('2026-06-29');

    const [legPending] = buildTransferLegs({ ...base, fromAccountId: 2, toAccountId: 1 });
    expect(legPending.cleared).toBe(false);
    expect(legPending.clearedDate).toBeNull();
  });
});

/** Promote the insert legs to LedgerEntry DTOs (add ids) for balance helpers. */
function asEntries(legs: ReturnType<typeof buildTransferLegs>): LedgerEntry[] {
  return legs.map((leg, i) => ({
    id: i + 1,
    householdId: leg.householdId,
    accountId: leg.accountId,
    entryDate: leg.entryDate,
    payee: leg.payee,
    categoryId: leg.categoryId ?? null,
    amountCents: leg.amountCents,
    direction: leg.direction as LedgerEntry['direction'],
    cleared: leg.cleared ?? false,
    clearedDate: leg.clearedDate ?? null,
    source: 'manual',
    note: leg.note ?? null,
    transferId: leg.transferId ?? null,
  }));
}

describe('transfer balance semantics', () => {
  it('moves money between accounts and nets to zero', () => {
    // HELOC (id 2) -> Checking (id 1), $500.
    const entries = asEntries(buildTransferLegs({ ...base, fromAccountId: 2, toAccountId: 1 }));
    const opening = new Map([
      [1, 0], // Checking
      [2, 0], // HELOC
    ]);
    const withBal = computeRunningBalances(entries, opening);

    const checking = withBal.find((e) => e.accountId === 1)!;
    const heloc = withBal.find((e) => e.accountId === 2)!;
    expect(checking.runningBalanceCents).toBe(50000); // credit: more cash
    expect(heloc.runningBalanceCents).toBe(-50000); // debit: more owed
  });

  it('a HELOC draw raises liabilities and assets equally (net unchanged)', () => {
    const accounts = [
      { id: 1, type: 'checking', openingBalanceCents: 0 },
      { id: 2, type: 'heloc', openingBalanceCents: 0 },
    ];
    const draw = asEntries(buildTransferLegs({ ...base, fromAccountId: 2, toAccountId: 1 })).map(
      (e) => ({ accountId: e.accountId, amountCents: e.amountCents, direction: e.direction, cleared: e.cleared }),
    );
    const sum = summarizeBalances(accounts, draw);
    expect(sum.assetsCents).toBe(50000); // checking up
    expect(sum.liabilitiesCents).toBe(50000); // HELOC owed up
    expect(sum.netCents).toBe(0); // moving your own money changes nothing net

    // Paying it back (Checking -> HELOC) reverses both sides.
    const payback = asEntries(
      buildTransferLegs({ ...base, fromAccountName: 'Checking', toAccountName: 'HELOC', fromAccountId: 1, toAccountId: 2 }),
    ).map((e) => ({ accountId: e.accountId, amountCents: e.amountCents, direction: e.direction, cleared: e.cleared }));
    const after = summarizeBalances(accounts, [...draw, ...payback]);
    expect(after.assetsCents).toBe(0);
    // `-liabilitySignedCents` yields -0 when nothing is owed; normalize for the
    // strict toBe (-0 serializes to 0 over the wire, so it's harmless).
    expect(after.liabilitiesCents || 0).toBe(0);
    expect(after.netCents).toBe(0);
  });
});
