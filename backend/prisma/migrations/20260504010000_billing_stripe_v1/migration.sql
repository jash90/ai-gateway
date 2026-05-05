-- M2: Stripe billing — config, products, prices, subscriptions
--
-- Adds:
--   * BillingMode enum (PACKAGE, SUBSCRIPTION)
--   * SubscriptionStatus enum
--   * stripe_config singleton
--   * billing_products / billing_prices / billing_subscriptions
--   * model_pricing.wallet_multiplier (Float, default 1.0)
--
-- Idempotent guards keep this safe to re-run.

-- CreateEnum: BillingMode
DO $$ BEGIN
  CREATE TYPE "billing_mode" AS ENUM ('PACKAGE', 'SUBSCRIPTION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: SubscriptionStatus
DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM (
    'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE',
    'INCOMPLETE_EXPIRED', 'TRIALING', 'UNPAID', 'PAUSED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ModelPricing.walletMultiplier
ALTER TABLE "model_pricing" ADD COLUMN IF NOT EXISTS "wallet_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- StripeConfig (singleton)
CREATE TABLE IF NOT EXISTS "stripe_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "publishable_key" TEXT,
    "encrypted_secret_key" BYTEA,
    "encrypted_webhook_secret" BYTEA,
    "encryption_key_id" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "last_webhook_at" TIMESTAMP(3),
    "last_webhook_event" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_config_pkey" PRIMARY KEY ("id")
);

-- BillingProduct
CREATE TABLE IF NOT EXISTS "billing_products" (
    "id" TEXT NOT NULL,
    "stripe_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mode" "billing_mode" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_products_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_products_stripe_product_id_key" ON "billing_products"("stripe_product_id");

-- BillingPrice
CREATE TABLE IF NOT EXISTS "billing_prices" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "stripe_price_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "unit_amount" INTEGER NOT NULL,
    "interval" TEXT,
    "tokens_granted" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_prices_stripe_price_id_key" ON "billing_prices"("stripe_price_id");
CREATE INDEX IF NOT EXISTS "billing_prices_product_id_is_active_idx" ON "billing_prices"("product_id", "is_active");
DO $$ BEGIN
  ALTER TABLE "billing_prices"
    ADD CONSTRAINT "billing_prices_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "billing_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- BillingSubscription
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "price_id" TEXT NOT NULL,
    "status" "subscription_status" NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_stripe_subscription_id_key" ON "billing_subscriptions"("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "billing_subscriptions_account_id_status_idx" ON "billing_subscriptions"("account_id", "status");
DO $$ BEGIN
  ALTER TABLE "billing_subscriptions"
    ADD CONSTRAINT "billing_subscriptions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
