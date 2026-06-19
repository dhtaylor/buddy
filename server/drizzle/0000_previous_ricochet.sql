CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'checking' NOT NULL,
	`opening_balance_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_household_idx` ON `accounts` (`household_id`);--> statement-breakpoint
CREATE TABLE `bill_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`due_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`ledger_entry_id` integer,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bill_occurrences_bill_idx` ON `bill_occurrences` (`bill_id`);--> statement-breakpoint
CREATE INDEX `bill_occurrences_due_date_idx` ON `bill_occurrences` (`due_date`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`category_id` integer,
	`recurrence` text DEFAULT 'monthly' NOT NULL,
	`typical_day` integer,
	`note` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bills_household_idx` ON `bills` (`household_id`);--> statement-breakpoint
CREATE TABLE `budget_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`planned_cents` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`note` text,
	FOREIGN KEY (`period_id`) REFERENCES `budget_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `budget_lines_period_idx` ON `budget_lines` (`period_id`);--> statement-breakpoint
CREATE TABLE `budget_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`label` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `budget_periods_household_idx` ON `budget_periods` (`household_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`group_name` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `categories_household_idx` ON `categories` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `household_members_user_idx` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `household_members_household_idx` ON `household_members` (`household_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`period_length` text DEFAULT 'weekly' NOT NULL,
	`period_anchor_date` text NOT NULL,
	`period_custom_days` integer
);
--> statement-breakpoint
CREATE TABLE `imported_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`txn_date` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`matched_entry_id` integer,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imported_transactions_import_idx` ON `imported_transactions` (`import_id`);--> statement-breakpoint
CREATE INDEX `imported_transactions_fingerprint_idx` ON `imported_transactions` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`filename` text NOT NULL,
	`source_format` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imports_household_idx` ON `imports` (`household_id`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`entry_date` text NOT NULL,
	`payee` text NOT NULL,
	`category_id` integer,
	`amount_cents` integer NOT NULL,
	`direction` text NOT NULL,
	`cleared` integer DEFAULT false NOT NULL,
	`cleared_date` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_household_idx` ON `ledger_entries` (`household_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_account_idx` ON `ledger_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_date_idx` ON `ledger_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `ledger_entries_category_idx` ON `ledger_entries` (`category_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);