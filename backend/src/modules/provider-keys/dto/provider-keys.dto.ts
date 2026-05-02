import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Provider key shape patterns — sanity check, not full vendor format validation
// =============================================================================

const PROVIDER_KEY_PATTERNS: Record<'OPENAI' | 'ANTHROPIC' | 'OPENROUTER', RegExp> = {
  OPENAI: /^sk-/,
  ANTHROPIC: /^sk-ant-/,
  OPENROUTER: /^sk-or-/,
}

// =============================================================================
// Request schemas + DTOs
// =============================================================================

export const createProviderKeySchema = z
  .object({
    provider: z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']),
    key: z.string().min(20, 'Key looks too short.').max(500),
    label: z.string().trim().max(80).optional(),
  })
  .refine(
    (data) => PROVIDER_KEY_PATTERNS[data.provider].test(data.key),
    {
      message: 'Key does not match the expected format for this provider.',
      path: ['key'],
    },
  )
export class CreateProviderKeyDto extends createZodDto(createProviderKeySchema) {}

// =============================================================================
// Response schemas + DTOs
// =============================================================================

export const providerKeySummarySchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']),
  label: z.string().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export class ProviderKeySummaryDto extends createZodDto(providerKeySummarySchema) {}

export const providerKeyListResponseSchema = z.array(providerKeySummarySchema)
export class ProviderKeyListResponseDto extends createZodDto(providerKeyListResponseSchema) {}

export const providerKeyTestResultSchema = z.object({
  ok: z.boolean(),
  sampleModels: z.array(z.string()).optional(),
  errorCode: z
    .enum(['INVALID_KEY', 'RATE_LIMITED', 'NETWORK_ERROR', 'UNKNOWN'])
    .optional(),
  upstreamStatus: z.number().int().optional(),
})
export class ProviderKeyTestResultDto extends createZodDto(providerKeyTestResultSchema) {}

// Service-layer type aliases.
export type ProviderKeySummary = z.infer<typeof providerKeySummarySchema>
export type ProviderKeyTestResult = z.infer<typeof providerKeyTestResultSchema>
