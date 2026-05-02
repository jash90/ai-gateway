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
