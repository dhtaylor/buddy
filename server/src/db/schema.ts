/**
 * Buddy database schema (Drizzle / PostgreSQL).
 *
 * Conventions:
 * - All money columns are INTEGER CENTS (suffix `_cents`).
 * - Calendar date columns are TEXT ISO "YYYY-MM-DD" (no time); datetimes
 *   (imported_at, confirmed_at) are TEXT ISO-8601 — kept as text for portability.
 * - Booleans are native Postgres `boolean`.
 * - Every domain table carries `household_id` for authorization scoping.
 */

import { boolean, integer, index, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const households = pgTable('households', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // 'weekly' | 'biweekly' | 'monthly' | 'custom'
  periodLength: text('period_length').notNull().default('weekly'),
  periodAnchorDate: text('period_anchor_date').notNull(),
  periodCustomDays: integer('period_custom_days'),
  // When true, Home shows the HELOC cash-sweep view (assets vs. liabilities,
  // HELOC card). Purely presentational — never hides or changes data.
  helocStrategyEnabled: boolean('heloc_strategy_enabled').notNull().default(false),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  // Global admin: may create new households. First registered user bootstraps as admin.
  isAdmin: boolean('is_admin').notNull().default(false),
});

export const householdMembers = pgTable(
  'household_members',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    // 'owner' | 'member'
    role: text('role').notNull().default('member'),
  },
  (t) => ({
    byUser: index('household_members_user_idx').on(t.userId),
    byHousehold: index('household_members_household_idx').on(t.householdId),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    // 'checking' | 'savings' | 'cash' | 'heloc'
    // For 'heloc' (line of credit), openingBalanceCents is the signed balance:
    // negative = amount owed. Drawing is a debit (more negative); a payment/
    // sweep is a credit (toward zero).
    type: text('type').notNull().default('checking'),
    openingBalanceCents: integer('opening_balance_cents').notNull().default(0),
    // HELOC-only. Credit limit (positive cents) and APR in basis points
    // (e.g. 8.50% = 850). Null/0 for non-HELOC accounts.
    creditLimitCents: integer('credit_limit_cents').notNull().default(0),
    aprBps: integer('apr_bps'),
  },
  (t) => ({
    byHousehold: index('accounts_household_idx').on(t.householdId),
  }),
);

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    groupName: text('group_name').notNull(),
    name: text('name').notNull(),
    // 'income' | 'expense'
    kind: text('kind').notNull().default('expense'),
    sortOrder: integer('sort_order').notNull().default(0),
    // Hidden from the Budget page + new-entry pickers, but kept so past
    // transactions and History totals remain intact. Can be unhidden.
    archived: boolean('archived').notNull().default(false),
  },
  (t) => ({
    byHousehold: index('categories_household_idx').on(t.householdId),
  }),
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    entryDate: text('entry_date').notNull(),
    payee: text('payee').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    amountCents: integer('amount_cents').notNull(),
    // 'debit' (money out) | 'credit' (money in)
    direction: text('direction').notNull(),
    cleared: boolean('cleared').notNull().default(false),
    clearedDate: text('cleared_date'),
    // 'manual' | 'imported'
    source: text('source').notNull().default('manual'),
    note: text('note'),
    // Links the two legs of an account-to-account transfer (same id on both).
    // Null for ordinary entries. Transfer legs move balances like any other
    // entry but are excluded from income/expense reporting (History/Budget).
    transferId: text('transfer_id'),
  },
  (t) => ({
    byHousehold: index('ledger_entries_household_idx').on(t.householdId),
    byAccount: index('ledger_entries_account_idx').on(t.accountId),
    byDate: index('ledger_entries_date_idx').on(t.entryDate),
    byCategory: index('ledger_entries_category_idx').on(t.categoryId),
    byTransfer: index('ledger_entries_transfer_idx').on(t.transferId),
  }),
);

export const budgetPeriods = pgTable(
  'budget_periods',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    label: text('label').notNull(),
  },
  (t) => ({
    byHousehold: index('budget_periods_household_idx').on(t.householdId),
  }),
);

export const budgetLines = pgTable(
  'budget_lines',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id')
      .notNull()
      .references(() => budgetPeriods.id),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    plannedCents: integer('planned_cents').notNull().default(0),
    dueDate: text('due_date'),
    note: text('note'),
  },
  (t) => ({
    byPeriod: index('budget_lines_period_idx').on(t.periodId),
  }),
);

export const bills = pgTable(
  'bills',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    // 'monthly' | 'weekly' | 'biweekly' | 'yearly' | 'custom'
    recurrence: text('recurrence').notNull().default('monthly'),
    typicalDay: integer('typical_day'),
    note: text('note'),
  },
  (t) => ({
    byHousehold: index('bills_household_idx').on(t.householdId),
  }),
);

export const billOccurrences = pgTable(
  'bill_occurrences',
  {
    id: serial('id').primaryKey(),
    billId: integer('bill_id')
      .notNull()
      .references(() => bills.id),
    dueDate: text('due_date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paid: boolean('paid').notNull().default(false),
    ledgerEntryId: integer('ledger_entry_id').references(() => ledgerEntries.id),
  },
  (t) => ({
    byBill: index('bill_occurrences_bill_idx').on(t.billId),
    byDueDate: index('bill_occurrences_due_date_idx').on(t.dueDate),
  }),
);

export const imports = pgTable(
  'imports',
  {
    id: serial('id').primaryKey(),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    filename: text('filename').notNull(),
    // 'csv' | 'ofx'
    sourceFormat: text('source_format').notNull(),
    importedAt: text('imported_at').notNull(),
    // Set when the user confirms the import; null = draft (excluded from dedupe).
    confirmedAt: text('confirmed_at'),
  },
  (t) => ({
    byHousehold: index('imports_household_idx').on(t.householdId),
  }),
);

export const importedTransactions = pgTable(
  'imported_transactions',
  {
    id: serial('id').primaryKey(),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id),
    txnDate: text('txn_date').notNull(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    fingerprint: text('fingerprint').notNull(),
    // 'matched' | 'new' | 'ignored'
    status: text('status').notNull().default('new'),
    matchedEntryId: integer('matched_entry_id').references(() => ledgerEntries.id),
  },
  (t) => ({
    byImport: index('imported_transactions_import_idx').on(t.importId),
    byFingerprint: index('imported_transactions_fingerprint_idx').on(t.fingerprint),
  }),
);

// Convenience type exports for server code.
export type HouseholdRow = typeof households.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
