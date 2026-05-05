import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// End-user billing DTOs (B2B2C)
//
// Każdy endpoint wymaga albo (a) auth przez application key — wtedy aplikacja
// jest implicitne `req.application`, albo (b) auth JWT konta + query
// `?applicationId=<uuid>` żeby wybrać do której aplikacji należy end-user.
// Endpointy żyją pod `/v1/end-users/{externalId}/...` — `externalId` to
// klucz integrator's-side, którym aplikacja klienta identyfikuje swoich
// userów. Backend mapuje externalId → EndUser.id wewnętrznie.
// =============================================================================

const endUserWalletSchema = z.object({
  externalId: z.string(),
  endUserId: z.string().uuid(),
  applicationId: z.string().uuid(),
  tokenBalance: z.string(), // BigInt as string
  refundOnError: z.boolean(),
})
export class EndUserWalletDto extends createZodDto(endUserWalletSchema) {}

const endUserSubscriptionItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum([
    'ACTIVE',
    'PAST_DUE',
    'CANCELED',
    'INCOMPLETE',
    'INCOMPLETE_EXPIRED',
    'TRIALING',
    'UNPAID',
    'PAUSED',
  ]),
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

const endUserSubscriptionResponseSchema = z.object({
  subscription: endUserSubscriptionItemSchema.nullable(),
})
export class EndUserSubscriptionResponseDto extends createZodDto(endUserSubscriptionResponseSchema) {}

const endUserMeSchema = z.object({
  externalId: z.string(),
  endUserId: z.string().uuid(),
  applicationId: z.string().uuid(),
  balance: z.object({
    tokens: z.string(),
    refundOnError: z.boolean(),
  }),
  subscription: endUserSubscriptionItemSchema.nullable(),
  ready: z.boolean(),
  catalog: z.array(
    z.object({
      id: z.string().uuid(),
      stripeProductId: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      mode: z.enum(['PACKAGE', 'SUBSCRIPTION']),
      isActive: z.boolean(),
      createdAt: z.string(),
      prices: z.array(
        z.object({
          id: z.string().uuid(),
          stripePriceId: z.string(),
          currency: z.string(),
          unitAmount: z.number().int(),
          interval: z.string().nullable(),
          tokensGranted: z.string(),
          isActive: z.boolean(),
          metadata: z.unknown().nullable(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
})
export class EndUserMeDto extends createZodDto(endUserMeSchema) {}

const endUserTransactionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'HOLD',
    'SETTLE',
    'REFUND',
    'TOPUP',
    'SUBSCRIPTION_GRANT',
    'SUBSCRIPTION_RESET',
    'ADJUST',
  ]),
  amount: z.string(),
  balanceAfter: z.string(),
  requestId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
})

const endUserTransactionListSchema = z.object({
  transactions: z.array(endUserTransactionSchema),
  total: z.number().int().nonnegative(),
})
export class EndUserTransactionListDto extends createZodDto(endUserTransactionListSchema) {}

const listTxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  type: z
    .enum([
      'HOLD',
      'SETTLE',
      'REFUND',
      'TOPUP',
      'SUBSCRIPTION_GRANT',
      'SUBSCRIPTION_RESET',
      'ADJUST',
    ])
    .optional(),
  /** Wymagane gdy auth via JWT (panel UI). Dla auth via app key ignorowane. */
  applicationId: z.string().uuid().optional(),
})
export class EndUserListTxQueryDto extends createZodDto(listTxQuerySchema) {}

const endUserCheckoutRequestSchema = z
  .object({
    priceId: z.string().uuid(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    /** Wymagane gdy auth via JWT — wtedy backend nie wie, do której aplikacji
     * należy end-user. Dla auth via app key ignorowane. */
    applicationId: z.string().uuid().optional(),
  })
  .strict()
export class EndUserCheckoutRequestDto extends createZodDto(endUserCheckoutRequestSchema) {}

const checkoutResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
})
export class EndUserCheckoutResponseDto extends createZodDto(checkoutResponseSchema) {}

// List end-users for the calling application
const endUserListItemSchema = z.object({
  id: z.string().uuid(),
  externalId: z.string(),
  applicationId: z.string().uuid(),
  tokenBalance: z.string(),
  hasStripeCustomer: z.boolean(),
  hasActiveSubscription: z.boolean(),
  totalRequests: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  metadata: z.unknown().nullable(),
})
const endUserListResponseSchema = z.object({
  endUsers: z.array(endUserListItemSchema),
  total: z.number().int().nonnegative(),
})
export class EndUserListResponseDto extends createZodDto(endUserListResponseSchema) {}

const listEndUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Wymagane gdy auth via JWT (panel). Ignorowane dla auth via app key. */
  applicationId: z.string().uuid().optional(),
  /** Search w externalId (substring, case-insensitive). */
  search: z.string().trim().min(1).optional(),
})
export class ListEndUsersQueryDto extends createZodDto(listEndUsersQuerySchema) {}
