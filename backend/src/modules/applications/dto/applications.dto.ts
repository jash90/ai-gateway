import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Request schemas + DTOs
// =============================================================================

export const createApplicationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  description: z.string().trim().max(500).optional(),
})
export class CreateApplicationDto extends createZodDto(createApplicationSchema) {}

export const updateApplicationSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  })
export class UpdateApplicationDto extends createZodDto(updateApplicationSchema) {}

export const listApplicationsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional(),
})
export class ListApplicationsQueryDto extends createZodDto(listApplicationsQuerySchema) {}

// Helper for the controller — keeps the DTO clean for OpenAPI generation while
// the actual service expects a boolean.
export function parseIncludeInactive(value: 'true' | 'false' | undefined): boolean {
  return value === 'true'
}

// =============================================================================
// Response schemas + DTOs
// =============================================================================

export const applicationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export class ApplicationSummaryDto extends createZodDto(applicationSummarySchema) {}

export const applicationDetailSchema = applicationSummarySchema.extend({
  keysCount: z.number().int().nonnegative(),
  activeKeysCount: z.number().int().nonnegative(),
  lastUsageAt: z.coerce.date().nullable(),
})
export class ApplicationDetailDto extends createZodDto(applicationDetailSchema) {}

export const applicationListResponseSchema = z.array(applicationSummarySchema)
export class ApplicationListResponseDto extends createZodDto(applicationListResponseSchema) {}

// Type aliases for service-layer usage (keep ApplicationsService signatures clean).
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>
