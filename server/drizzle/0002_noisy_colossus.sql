ALTER TABLE "ledger_entries" ADD COLUMN "transfer_id" text;--> statement-breakpoint
CREATE INDEX "ledger_entries_transfer_idx" ON "ledger_entries" USING btree ("transfer_id");