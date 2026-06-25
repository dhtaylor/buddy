/**
 * Shared DTO types — the wire contract between server and web.
 * These mirror the Drizzle schema rows but are the canonical API shapes.
 * All money fields are integer cents. All dates are ISO "YYYY-MM-DD" strings.
 */

import type { PeriodLength } from './period.js';

export type Id = number;

// --- Enums ---
export type AccountType = 'checking' | 'savings' | 'cash' | 'heloc';
export type CategoryKind = 'income' | 'expense';
export type EntryDirection = 'debit' | 'credit';
export type EntrySource = 'manual' | 'imported';
export type MemberRole = 'owner' | 'member';
export type BillRecurrence = 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'custom';
export type ImportFormat = 'csv' | 'ofx';
export type ImportedTxnStatus = 'matched' | 'new' | 'ignored';

// --- Auth / household ---
export interface User {
  id: Id;
  email: string;
  displayName: string;
  /** Global admin: may create new households. */
  isAdmin: boolean;
}

export interface Household {
  id: Id;
  name: string;
  periodLength: PeriodLength;
  /** For biweekly/custom alignment and Sun–Sat weeks. ISO date. */
  periodAnchorDate: string;
  /** Only meaningful when periodLength === 'custom'. */
  periodCustomDays: number | null;
  /** When true, Home shows the HELOC cash-sweep view. Presentational only. */
  helocStrategyEnabled: boolean;
}

export interface HouseholdMember {
  householdId: Id;
  userId: Id;
  role: MemberRole;
}

// --- Domain ---
export interface Account {
  id: Id;
  householdId: Id;
  name: string;
  type: AccountType;
  /** For HELOC accounts, the signed balance: negative = amount owed. */
  openingBalanceCents: number;
  /** HELOC-only credit limit (positive cents); 0 otherwise. */
  creditLimitCents: number;
  /** HELOC-only APR in basis points (8.50% = 850); null otherwise. */
  aprBps: number | null;
}

export interface Category {
  id: Id;
  householdId: Id;
  groupName: string;
  name: string;
  kind: CategoryKind;
  sortOrder: number;
  /** Hidden from Budget + new-entry pickers; past data is retained. */
  archived: boolean;
}

export interface LedgerEntry {
  id: Id;
  householdId: Id;
  accountId: Id;
  entryDate: string;
  payee: string;
  categoryId: Id | null;
  amountCents: number;
  direction: EntryDirection;
  cleared: boolean;
  clearedDate: string | null;
  source: EntrySource;
  note: string | null;
}

export interface BudgetPeriod {
  id: Id;
  householdId: Id;
  startDate: string;
  endDate: string;
  label: string;
}

export interface BudgetLine {
  id: Id;
  periodId: Id;
  categoryId: Id;
  plannedCents: number;
  dueDate: string | null;
  note: string | null;
}

export interface Bill {
  id: Id;
  householdId: Id;
  name: string;
  categoryId: Id | null;
  recurrence: BillRecurrence;
  typicalDay: number | null;
  note: string | null;
}

export interface BillOccurrence {
  id: Id;
  billId: Id;
  dueDate: string;
  amountCents: number;
  paid: boolean;
  ledgerEntryId: Id | null;
}

export interface ImportRecord {
  id: Id;
  householdId: Id;
  accountId: Id;
  filename: string;
  sourceFormat: ImportFormat;
  importedAt: string;
}

export interface ImportedTransaction {
  id: Id;
  importId: Id;
  txnDate: string;
  description: string;
  amountCents: number;
  fingerprint: string;
  status: ImportedTxnStatus;
  matchedEntryId: Id | null;
}

// --- Derived / summary shapes ---
/** GET /ledger/balance. recorded/cleared kept for back-compat (= net). */
export interface BalanceSummary {
  recordedCents: number;
  clearedCents: number;
  /** Sum of non-HELOC account balances (recorded). */
  assetsCents: number;
  /** Total HELOC amount owed (positive), recorded. */
  liabilitiesCents: number;
  /** assetsCents - liabilitiesCents (equals recordedCents). */
  netCents: number;
}

/** One entry of GET /accounts/heloc-summary, per HELOC account. */
export interface HelocSummary {
  accountId: Id;
  name: string;
  /** Signed balance: negative = owed. */
  balanceCents: number;
  /** Amount owed (positive). */
  owedCents: number;
  creditLimitCents: number;
  /** creditLimitCents - owedCents, floored at 0. */
  availableCents: number;
  aprBps: number | null;
  /** Estimated interest for one month at the current balance. Null if no APR. */
  estMonthlyInterestCents: number | null;
  /** Payments/sweeps (credits) within the requested range. */
  sweptCents: number;
  /** Draws (debits) within the requested range. */
  drawnCents: number;
  /**
   * Interest actually accrued over [from, to], computed day-by-day on the real
   * daily balance (daily rate = APR / 365). Null if no APR or no date range.
   */
  periodInterestCents: number | null;
  /**
   * The velocity-banking payoff: interest saved over [from, to] by sweeping
   * income onto the line. Compares the real daily balance against a
   * counterfactual where this period's sweeps (credits) never happened.
   * Null if no APR or no date range.
   */
  interestSavedCents: number | null;
}

// --- API envelope ---
/** Every successful API response is wrapped as { data: T }. */
export interface ApiSuccess<T> {
  data: T;
}

/** Every error response is wrapped as { error: { code, message } } with non-2xx status. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
