/**
 * Buddy database schema (Drizzle / SQLite).
 *
 * Conventions:
 * - All money columns are INTEGER CENTS (suffix `_cents`).
 * - All date columns are TEXT ISO "YYYY-MM-DD" (no time).
 * - Booleans are INTEGER 0/1 via `{ mode: 'boolean' }`.
 * - Every domain table carries `household_id` for authorization scoping.
 * - Timestamps (imported_at, created_at) are TEXT ISO-8601 datetimes.
 */

import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const households = sqliteTable('households', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // 'weekly' | 'biweekly' | 'monthly' | 'custom'
  periodLength: text('period_length').notNull().default('weekly'),
  // ISO date anchoring period boundaries (Sun for Sun–Sat weeks).
  periodAnchorDate: text('period_anchor_date').notNull(),
  // Only used when periodLength === 'custom'.
  periodCustomDays: integer('period_custom_days'),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
});

export const householdMembers = sqliteTable(
  'household_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    name: text('name').notNull(),
    // 'checking' | 'savings' | 'cash'
    type: text('type').notNull().default('checking'),
    openingBalanceCents: integer('opening_balance_cents').notNull().default(0),
  },
  (t) => ({
    byHousehold: index('accounts_household_idx').on(t.householdId),
  }),
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    householdId: integer('household_id')
      .notNull()
      .references(() => households.id),
    groupName: text('group_name').notNull(),
    name: text('name').notNull(),
    // 'income' | 'expense'
    kind: text('kind').notNull().default('expense'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    byHousehold: index('categories_household_idx').on(t.householdId),
  }),
);

export const ledgerEntries = sqliteTable(
  'ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
    cleared: integer('cleared', { mode: 'boolean' }).notNull().default(false),
    clearedDate: text('cleared_date'),
    // 'manual' | 'imported'
    source: text('source').notNull().default('manual'),
    note: text('note'),
  },
  (t) => ({
    byHousehold: index('ledger_entries_household_idx').on(t.householdId),
    byAccount: index('ledger_entries_account_idx').on(t.accountId),
    byDate: index('ledger_entries_date_idx').on(t.entryDate),
    byCategory: index('ledger_entries_category_idx').on(t.categoryId),
  }),
);

export const budgetPeriods = sqliteTable(
  'budget_periods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

export const budgetLines = sqliteTable(
  'budget_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

export const bills = sqliteTable(
  'bills',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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

export const billOccurrences = sqliteTable(
  'bill_occurrences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    billId: integer('bill_id')
      .notNull()
      .references(() => bills.id),
    dueDate: text('due_date').notNull(),
    amountCents: integer('amount_cents').notNull(),
    paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
    ledgerEntryId: integer('ledger_entry_id').references(() => ledgerEntries.id),
  },
  (t) => ({
    byBill: index('bill_occurrences_bill_idx').on(t.billId),
    byDueDate: index('bill_occurrences_due_date_idx').on(t.dueDate),
  }),
);

export const imports = sqliteTable(
  'imports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
  },
  (t) => ({
    byHousehold: index('imports_household_idx').on(t.householdId),
  }),
);

export const importedTransactions = sqliteTable(
  'imported_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
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
