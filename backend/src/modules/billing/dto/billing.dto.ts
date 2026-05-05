import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Stripe config (admin)
// =============================================================================

const stripeConfigPublicSchema = z.object({
  isActive: z.boolean(),
  hasSecretKey: z.boolean(),
  hasWebhookSecret: z.boolean(),
  publishableKey: z.string().nullable(),
  mode: z.enum(['test', 'live']),
  lastWebhookAt: z.string().nullable(),
  lastWebhookEvent: z.string().nullable(),
  webhookUrl: z.string().url(),
  requiredEvents: z.array(z.string()),
})
export class StripeConfigPublicDto extends createZodDto(stripeConfigPublicSchema) {}

const upsertStripeConfigSchema = z.object({
  publishableKey: z.string().trim().max(200).optional().nullable(),
  /** Send only when changing — server keeps previous if absent. */
  secretKey: z.string().trim().min(8).max(500).optional().nullable(),
  webhookSecret: z.string().trim().min(8).max(500).optional().nullable(),
  mode: z.enum(['test', 'live']).optional(),
})
export class UpsertStripeConfigDto extends createZodDto(upsertStripeConfigSchema) {}

// =============================================================================
// Products + Prices
// =============================================================================

const billingModeEnum = z.enum(['PACKAGE', 'SUBSCRIPTION'])

const priceSchema = z.object({
  id: z.string().uuid(),
  stripePriceId: z.string(),
  currency: z.string(),
  unitAmount: z.number().int(),
  interval: z.string().nullable(),
  tokensGranted: z.string(), // BigInt as string
  isActive: z.boolean(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
})

const productSchema = z.object({
  id: z.string().uuid(),
  stripeProductId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  mode: billingModeEnum,
  isActive: z.boolean(),
  createdAt: z.string(),
  prices: z.array(priceSchema),
})

const productListSchema = z.object({
  products: z.array(productSchema),
})
export class ProductListDto extends createZodDto(productListSchema) {}

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  mode: billingModeEnum,
})
export class CreateProductDto extends createZodDto(createProductSchema) {}

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
})
export class UpdateProductDto extends createZodDto(updateProductSchema) {}

const createPriceSchema = z.object({
  productId: z.string().uuid(),
  unitAmount: z.number().int().positive(),
  currency: z.string().trim().length(3).optional(),
  interval: z.enum(['month', 'year']).optional().nullable(),
  /** Number of LLM tokens granted by this price (BigInt-compatible string). */
  tokensGranted: z.string().regex(/^\d+$/),
  metadata: z.record(z.unknown()).optional(),
})
export class CreatePriceDto extends createZodDto(createPriceSchema) {}

// =============================================================================
// Account-facing checkout
// =============================================================================

/**
 * Wallet target for the purchased tokens.
 *   - SHARED_ACCOUNT: credits Account.tokenBalance (used by all applications)
 *   - PER_APPLICATION: credits a specific Application.tokenBalance
 */
const checkoutScopeEnum = z.enum(['SHARED_ACCOUNT', 'PER_APPLICATION'])

const checkoutRequestSchema = z
  .object({
    priceId: z.string().uuid(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    scope: checkoutScopeEnum.optional(),
    /** Required when scope=PER_APPLICATION; ignored otherwise. */
    applicationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.scope !== 'PER_APPLICATION' || !!v.applicationId,
    { message: 'applicationId is required when scope=PER_APPLICATION', path: ['applicationId'] },
  )
export class CheckoutRequestDto extends createZodDto(checkoutRequestSchema) {}

const checkoutResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
})
export class CheckoutResponseDto extends createZodDto(checkoutResponseSchema) {}

// =============================================================================
// Subscription view + unified "me" endpoint
// =============================================================================

const subscriptionStatusEnum = z.enum([
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'TRIALING',
  'UNPAID',
  'PAUSED',
])

const subscriptionItemSchema = z.object({
  id: z.string().uuid(),
  status: subscriptionStatusEnum,
  productName: z.string(),
  priceId: z.string().uuid(),
  unitAmount: z.number().int(),
  currency: z.string(),
  interval: z.string().nullable(),
  tokensGranted: z.string(),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.string().nullable(),
})

/** Wrapper response — `subscription: null` when no active subscription. */
const subscriptionResponseSchema = z.object({
  subscription: subscriptionItemSchema.nullable(),
})
export class SubscriptionResponseDto extends createZodDto(subscriptionResponseSchema) {}

const applicationWalletSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenBalance: z.string(), // BigInt as string
})

const billingSummarySchema = z.object({
  balance: z.object({
    /** Shared (account-level) token balance. */
    tokens: z.string(), // BigInt as string
    refundOnError: z.boolean(),
  }),
  /** Per-application wallet balances. */
  applications: z.array(applicationWalletSchema),
  /** Sum of shared balance + all application balances. */
  totalAvailable: z.string(),
  /** User's default scope picks (used by the BillingCheckoutDialog). */
  preferences: z.object({
    defaultPackageScope: checkoutScopeEnum,
    defaultSubscriptionScope: checkoutScopeEnum,
  }),
  subscription: subscriptionItemSchema.nullable(),
  /** Whether the operator's Stripe is configured (catalog reachable). */
  ready: z.boolean(),
  catalog: z.array(productSchema),
})
export class BillingSummaryDto extends createZodDto(billingSummarySchema) {}

// =============================================================================
// Wallets — combined view + per-application balance
// =============================================================================

const combinedWalletsSchema = z.object({
  sharedBalance: z.string(), // Account.tokenBalance as string
  refundOnError: z.boolean(),
  applications: z.array(applicationWalletSchema),
  totalAvailable: z.string(),
})
export class CombinedWalletsDto extends createZodDto(combinedWalletsSchema) {}

const applicationWalletDetailSchema = z.object({
  applicationId: z.string().uuid(),
  tokenBalance: z.string(),
})
export class ApplicationWalletDto extends createZodDto(applicationWalletDetailSchema) {}

// =============================================================================
// Preferences — default checkout scopes per Account
// =============================================================================

const updatePreferencesSchema = z
  .object({
    defaultPackageScope: checkoutScopeEnum.optional(),
    defaultSubscriptionScope: checkoutScopeEnum.optional(),
    refundOnError: z.boolean().optional(),
  })
  .strict()
export class UpdatePreferencesDto extends createZodDto(updatePreferencesSchema) {}

const preferencesSchema = z.object({
  defaultPackageScope: checkoutScopeEnum,
  defaultSubscriptionScope: checkoutScopeEnum,
  refundOnError: z.boolean(),
})
export class PreferencesDto extends createZodDto(preferencesSchema) {}
