import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Wallet DTOs (M1)
// =============================================================================

const balanceResponseSchema = z.object({
  /** Current cached token balance (BigInt serialized as string for safety). */
  tokenBalance: z.string(),
  /** Refund-on-error flag from Account. */
  refundOnError: z.boolean(),
})
export class WalletBalanceDto extends createZodDto(balanceResponseSchema) {}

const txSchema = z.object({
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
  stripeEventId: z.string().nullable(),
  applicationId: z.string().uuid().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
})

const listTxResponseSchema = z.object({
  transactions: z.array(txSchema),
  total: z.number().int().nonnegative(),
})
export class WalletTransactionListDto extends createZodDto(listTxResponseSchema) {}

const listTxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  type: z.enum([
    'HOLD',
    'SETTLE',
    'REFUND',
    'TOPUP',
    'SUBSCRIPTION_GRANT',
    'SUBSCRIPTION_RESET',
    'ADJUST',
  ]).optional(),
  /**
   * Filter by application:
   *   - "<uuid>" → only transactions for that application
   *   - "shared" → only transactions on the shared account wallet (applicationId IS NULL)
   *   - omitted → all transactions
   */
  applicationId: z.union([z.string().uuid(), z.literal('shared')]).optional(),
})
export class ListWalletTransactionsQueryDto extends createZodDto(listTxQuerySchema) {}

// =============================================================================
// Admin grant
// =============================================================================

const adminGrantSchema = z.object({
  /** Positive number of LLM tokens to add (BigInt-compatible string). */
  amount: z.string().regex(/^\d+$/, 'amount must be a positive integer string'),
  /** Free-text reason logged in audit + tx metadata. */
  reason: z.string().trim().min(1).max(280),
  /** When set, credits the application wallet; omitted/null + no endUserId → Account. */
  applicationId: z.string().uuid().optional().nullable(),
  /** When set, credits the end-user wallet (highest priority). */
  endUserId: z.string().uuid().optional().nullable(),
})
export class AdminGrantTokensDto extends createZodDto(adminGrantSchema) {}
