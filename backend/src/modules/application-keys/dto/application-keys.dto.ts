import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Request schemas + DTOs
// =============================================================================

export const createApplicationKeySchema = z.object({
  label: z.string().trim().max(80).optional(),
  /** ISO 8601 datetime. Service converts to Date at use site. */
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be ISO 8601.' })
    .optional(),
})
export class CreateApplicationKeyDto extends createZodDto(createApplicationKeySchema) {}

// =============================================================================
// Response schemas + DTOs
// =============================================================================

export const applicationKeySummarySchema = z.object({
  id: z.string().uuid(),
  keyPrefix: z.string(),
  label: z.string().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})
export class ApplicationKeySummaryDto extends createZodDto(applicationKeySummarySchema) {}

export const applicationKeyCreatedSchema = applicationKeySummarySchema.extend({
  /**
   * The full secret (`sk-rcn-live-...`). Returned exactly once on creation.
   * Frontend must show this in a one-time-reveal modal and never store it.
   */
  secret: z.string(),
})
export class ApplicationKeyCreatedDto extends createZodDto(applicationKeyCreatedSchema) {}

export const applicationKeyListResponseSchema = z.array(applicationKeySummarySchema)
export class ApplicationKeyListResponseDto extends createZodDto(
  applicationKeyListResponseSchema,
) {}

// Service-layer type aliases.
export type ApplicationKeySummary = z.infer<typeof applicationKeySummarySchema>
export type ApplicationKeyCreatedResponse = z.infer<typeof applicationKeyCreatedSchema>
