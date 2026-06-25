ALTER TABLE "accounts" ADD COLUMN "credit_limit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "apr_bps" integer;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "heloc_strategy_enabled" boolean DEFAULT false NOT NULL;