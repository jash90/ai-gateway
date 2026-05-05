-- M1: Billing wallet + feature flags
--
-- Adds:
--   * Account.tokenBalance (BigInt, default 0) — cached running balance in LLM tokens
--   * Account.stripeCustomerId (text, unique, null) — Stripe Customer ref
--   * Account.refundOnError (bool, default true) — refund hold when provider 4xx/5xx
--   * wallet_transactions table (append-only ledger)
--   * feature_flags table (global + per-account flag rows)
--
-- Idempotent guards keep this safe to re-run on partially-applied envs.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "wallet_tx_type" AS ENUM ('HOLD', 'SETTLE', 'REFUND', 'TOPUP', 'SUBSCRIPTION_GRANT', 'SUBSCRIPTION_RESET', 'ADJUST');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterTable: Account billing columns
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "token_balance" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "refund_on_error" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: wallet_transactions
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "wallet_tx_type" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "request_id" TEXT,
    "stripe_event_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: feature_flags
CREATE TABLE IF NOT EXISTS "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "account_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_stripe_customer_id_key" ON "accounts"("stripe_customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_request_id_key" ON "wallet_transactions"("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_transactions_stripe_event_id_key" ON "wallet_transactions"("stripe_event_id");
CREATE INDEX IF NOT EXISTS "wallet_transactions_account_id_created_at_idx" ON "wallet_transactions"("account_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "feature_flags_key_idx" ON "feature_flags"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_account_id_key" ON "feature_flags"("key", "account_id");

-- Foreign keys (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE "wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "feature_flags"
    ADD CONSTRAINT "feature_flags_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
