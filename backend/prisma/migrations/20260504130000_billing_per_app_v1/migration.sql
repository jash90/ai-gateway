-- Per-application wallet support + scope selection for billing.
--
-- Adds:
--   * Application.token_balance (BigInt, default 0)
--   * Account.default_package_scope / default_subscription_scope (defaults)
--   * WalletTransaction.application_id (nullable; null = shared account wallet)
--   * BillingSubscription.scope + application_id (per-app subscriptions)
--
-- All additive — no backfill needed (existing rows keep behaving as
-- "shared account wallet" since application_id stays null).

-- Application wallet column
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "token_balance" BIGINT NOT NULL DEFAULT 0;

-- Account default scopes
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "default_package_scope" TEXT NOT NULL DEFAULT 'PER_APPLICATION';
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "default_subscription_scope" TEXT NOT NULL DEFAULT 'SHARED_ACCOUNT';

-- WalletTransaction application reference
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "application_id" TEXT;
CREATE INDEX IF NOT EXISTS "wallet_transactions_application_id_created_at_idx"
    ON "wallet_transactions"("application_id", "created_at" DESC);
DO $$ BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- BillingSubscription scope + application
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'SHARED_ACCOUNT';
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "application_id" TEXT;
CREATE INDEX IF NOT EXISTS "billing_subscriptions_application_id_status_idx"
    ON "billing_subscriptions"("application_id", "status");
DO $$ BEGIN
  ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
