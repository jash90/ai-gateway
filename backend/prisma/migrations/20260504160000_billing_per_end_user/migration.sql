-- Per-end-user wallet support (B2B2C).
--
-- Adds:
--   * EndUser.token_balance (BigInt, default 0)
--   * EndUser.stripe_customer_id (nullable, unique)
--   * WalletTransaction.end_user_id (nullable; null = account or app wallet)
--   * BillingSubscription.end_user_id (nullable; set only for scope=PER_END_USER)
--
-- All additive — no backfill (greenfield post-cutover scenario; existing rows
-- keep behaving as before since end_user_id stays null).

-- EndUser wallet columns
ALTER TABLE "end_users" ADD COLUMN IF NOT EXISTS "token_balance" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "end_users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
DO $$ BEGIN
  CREATE UNIQUE INDEX "end_users_stripe_customer_id_key" ON "end_users"("stripe_customer_id");
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- end_users.application_id Cascade → Restrict (now that EndUser owns wallet
-- + maybe a subscription, we must not silently nuke the wallet by hard-deleting
-- the parent app). The FK already exists; we drop+recreate with the new ON DELETE.
DO $$ BEGIN
  ALTER TABLE "end_users" DROP CONSTRAINT "end_users_application_id_fkey";
EXCEPTION WHEN undefined_object THEN null; END $$;
ALTER TABLE "end_users"
  ADD CONSTRAINT "end_users_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- WalletTransaction end_user reference
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "end_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "wallet_transactions_end_user_id_created_at_idx"
    ON "wallet_transactions"("end_user_id", "created_at" DESC);
DO $$ BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_end_user_id_fkey"
    FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- BillingSubscription end_user reference
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "end_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "billing_subscriptions_end_user_id_status_idx"
    ON "billing_subscriptions"("end_user_id", "status");
DO $$ BEGIN
  ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_end_user_id_fkey"
    FOREIGN KEY ("end_user_id") REFERENCES "end_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
