/**
 * Pure helpers for the HELOC cash-sweep view.
 *
 * Sign convention (matches the ledger): a HELOC account's balance is negative
 * when money is owed. A draw is a debit (more negative); a payment/sweep is a
 * credit (toward zero). Assets (checking/savings/cash) carry positive balances.
 */

import { addDays, type BalanceSummary, type HelocSummary } from '@buddy/shared';

/** HELOC is the only liability account type today. */
export function isLiability(type: string): boolean {
  return type === 'heloc';
}

/** Signed cents for a ledger entry: credit adds, debit subtracts. */
function signed(amountCents: number, direction: string): number {
  return direction === 'credit' ? amountCents : -amountCents;
}

/**
 * Estimated interest for one month at the given owed balance.
 * APR fraction = aprBps / 10_000; monthly = / 12. Null when no APR is set.
 */
export function estMonthlyInterestCents(owedCents: number, aprBps: number | null): number | null {
  if (aprBps == null) return null;
  if (owedCents <= 0) return 0;
  return Math.round((owedCents * aprBps) / 10_000 / 12);
}

type BalanceAccount = { id: number; type: string; openingBalanceCents: number };
type BalanceEntry = { accountId: number; amountCents: number; direction: string; cleared: boolean };

/**
 * Split household balances into assets vs. liabilities (owed, positive) and net.
 * recordedCents/clearedCents are preserved for back-compat and equal the net of
 * every account (assets minus liabilities).
 */
export function summarizeBalances(
  accounts: BalanceAccount[],
  entries: BalanceEntry[],
): BalanceSummary {
  const typeById = new Map(accounts.map((a) => [a.id, a.type] as const));
  let recordedCents = 0;
  let clearedCents = 0;
  let assetsCents = 0;
  let liabilitySignedCents = 0; // negative = owed

  for (const a of accounts) {
    recordedCents += a.openingBalanceCents;
    clearedCents += a.openingBalanceCents;
    if (isLiability(a.type)) liabilitySignedCents += a.openingBalanceCents;
    else assetsCents += a.openingBalanceCents;
  }
  for (const e of entries) {
    const delta = signed(e.amountCents, e.direction);
    recordedCents += delta;
    if (e.cleared) clearedCents += delta;
    if (isLiability(typeById.get(e.accountId) ?? 'checking')) liabilitySignedCents += delta;
    else assetsCents += delta;
  }

  const liabilitiesCents = -liabilitySignedCents; // positive owed
  return {
    recordedCents,
    clearedCents,
    assetsCents,
    liabilitiesCents,
    netCents: assetsCents - liabilitiesCents,
  };
}

type HelocAccount = {
  id: number;
  name: string;
  openingBalanceCents: number;
  creditLimitCents: number;
  aprBps: number | null;
};
type HelocEntry = { accountId: number; amountCents: number; direction: string; entryDate: string };

/**
 * Day-by-day interest accrual over [from, to] (inclusive), for the real ledger
 * and for a counterfactual in which this period's sweeps (credits) never landed.
 *
 * Interest accrues daily on the amount owed at dailyRate = APR / 365. The
 * counterfactual adds back each in-range sweep from its date onward, so the
 * difference isolates how much interest the sweeps saved — the velocity payoff.
 */
function accrueInterest(
  account: HelocAccount,
  acctEntries: HelocEntry[],
  from: string,
  to: string,
): { periodInterestCents: number; interestSavedCents: number } | null {
  if (account.aprBps == null) return null;
  const dailyRate = account.aprBps / 10_000 / 365;
  const sorted = [...acctEntries].sort((a, b) =>
    a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0,
  );

  let balanceCents = account.openingBalanceCents;
  let sweptInRangeSoFar = 0;
  let cursor = 0;
  let actual = 0;
  let baseline = 0;

  for (let day = from; day <= to; day = addDays(day, 1)) {
    // Fold in every entry dated on or before this day.
    while (cursor < sorted.length && sorted[cursor].entryDate <= day) {
      const e = sorted[cursor];
      balanceCents += signed(e.amountCents, e.direction);
      if (e.entryDate >= from && e.direction === 'credit') sweptInRangeSoFar += e.amountCents;
      cursor++;
    }
    const actualOwed = Math.max(0, -balanceCents);
    // Without the sweeps the balance would be more negative (higher owed).
    const baselineOwed = Math.max(0, -(balanceCents - sweptInRangeSoFar));
    actual += actualOwed * dailyRate;
    baseline += baselineOwed * dailyRate;
  }

  return {
    periodInterestCents: Math.round(actual),
    interestSavedCents: Math.round(baseline - actual),
  };
}

/**
 * Summarize one HELOC account. The balance reflects every entry; swept (credits)
 * and drawn (debits) are summed only within the optional [from, to] date range.
 * When a full range and an APR are present, also returns accrued/saved interest.
 */
export function helocSummaryFor(
  account: HelocAccount,
  entries: HelocEntry[],
  range?: { from?: string; to?: string },
): HelocSummary {
  const acctEntries = entries.filter((e) => e.accountId === account.id);

  let balanceCents = account.openingBalanceCents;
  let sweptCents = 0;
  let drawnCents = 0;

  for (const e of acctEntries) {
    balanceCents += signed(e.amountCents, e.direction);
    const inRange =
      (!range?.from || e.entryDate >= range.from) && (!range?.to || e.entryDate <= range.to);
    if (!inRange) continue;
    if (e.direction === 'credit') sweptCents += e.amountCents;
    else drawnCents += e.amountCents;
  }

  const owedCents = Math.max(0, -balanceCents);
  const availableCents = Math.max(0, account.creditLimitCents - owedCents);
  const interest =
    range?.from && range?.to ? accrueInterest(account, acctEntries, range.from, range.to) : null;

  return {
    accountId: account.id,
    name: account.name,
    balanceCents,
    owedCents,
    creditLimitCents: account.creditLimitCents,
    availableCents,
    aprBps: account.aprBps,
    estMonthlyInterestCents: estMonthlyInterestCents(owedCents, account.aprBps),
    sweptCents,
    drawnCents,
    periodInterestCents: interest?.periodInterestCents ?? null,
    interestSavedCents: interest?.interestSavedCents ?? null,
  };
}
