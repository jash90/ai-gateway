import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

const flagScopeEnum = z.enum(['global', 'account'])

const flagSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  scope: flagScopeEnum,
  accountId: z.string().uuid().nullable(),
  enabled: z.boolean(),
  payload: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  flags: z.array(flagSchema),
  total: z.number().int().nonnegative(),
})
export class FeatureFlagListDto extends createZodDto(listResponseSchema) {}

const upsertSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9._-]+$/, 'lowercase, dots, dashes, underscores only'),
  scope: flagScopeEnum,
  /** Required when scope=account, must be null/omitted when scope=global. */
  accountId: z.string().uuid().nullable().optional(),
  enabled: z.boolean(),
  payload: z.record(z.unknown()).nullable().optional(),
}).refine(
  (data) => (data.scope === 'global' ? !data.accountId : !!data.accountId),
  { message: 'accountId required for scope=account, must be omitted for scope=global', path: ['accountId'] },
)
export class UpsertFeatureFlagDto extends createZodDto(upsertSchema) {}

const listQuerySchema = z.object({
  scope: flagScopeEnum.optional(),
  accountId: z.string().uuid().optional(),
  key: z.string().optional(),
})
export class ListFeatureFlagsQueryDto extends createZodDto(listQuerySchema) {}
