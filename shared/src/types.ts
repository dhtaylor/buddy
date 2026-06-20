/**
 * Shared DTO types — the wire contract between server and web.
 * These mirror the Drizzle schema rows but are the canonical API shapes.
 * All money fields are integer cents. All dates are ISO "YYYY-MM-DD" strings.
 */

import type { PeriodLength } from './period.js';

export type Id = number;

// --- Enums ---
export type AccountType = 'checking' | 'savings' | 'cash';
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
  openingBalanceCents: number;
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
