import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const adminAccountSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  applicationsCount: z.number().int().nonnegative(),
  activeKeysCount: z.number().int().nonnegative(),
  providerKeysCount: z.number().int().nonnegative(),
  usageEventsCount: z.number().int().nonnegative(),
  totalCostUsdLast30d: z.number().nonnegative(),
})
export class AdminAccountSummaryDto extends createZodDto(adminAccountSummarySchema) {}

export const adminAccountListResponseSchema = z.object({
  accounts: z.array(adminAccountSummarySchema),
  total: z.number().int().nonnegative(),
})
export class AdminAccountListResponseDto extends createZodDto(adminAccountListResponseSchema) {}

export const adminListAccountsQuerySchema = z.object({
  search: z.string().optional(),
  role: z.enum(['USER', 'ADMIN']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
})
export class AdminListAccountsQueryDto extends createZodDto(adminListAccountsQuerySchema) {}

// ---------------------------------------------------------------------------
// Admin user CRUD
// ---------------------------------------------------------------------------

export const adminCreateAccountSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    /** Initial password. Min 8 chars; admin should communicate to the user OOB. */
    password: z.string().min(8).max(128),
    name: z.string().trim().min(1).max(120).optional().nullable(),
    role: z.enum(['USER', 'ADMIN']).default('USER'),
    /** When true, skips email verification — useful for admin-provisioned accounts. */
    emailVerified: z.boolean().default(true),
  })
  .strict()
export class AdminCreateAccountDto extends createZodDto(adminCreateAccountSchema) {}

export const adminUpdateAccountSchema = z
  .object({
    name: z.string().trim().max(120).optional().nullable(),
    role: z.enum(['USER', 'ADMIN']).optional(),
    /** Suspend (false) / restore (true). Suspending revokes JWT immediately. */
    isActive: z.boolean().optional(),
    /** Force email-verified flag (admin override). */
    emailVerified: z.boolean().optional(),
    /** When set, replaces the password hash. Plaintext is hashed server-side. */
    newPassword: z.string().min(8).max(128).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined ||
      v.role !== undefined ||
      v.isActive !== undefined ||
      v.emailVerified !== undefined ||
      v.newPassword !== undefined,
    { message: 'At least one field must be provided.' },
  )
export class AdminUpdateAccountDto extends createZodDto(adminUpdateAccountSchema) {}

const adminMutationResponseSchema = z.object({
  account: adminAccountSummarySchema,
})
export class AdminMutationResponseDto extends createZodDto(adminMutationResponseSchema) {}
