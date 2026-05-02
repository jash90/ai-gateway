import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const ALERT_RULE_TYPES = [
  'USAGE_THRESHOLD',
  'DAILY_LIMIT',
  'ERROR_RATE_HIGH',
  'LATENCY_P95_HIGH',
] as const
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number]

export const ALERT_CHANNELS = ['EMAIL', 'WEBHOOK', 'BOTH'] as const
export type AlertChannel = (typeof ALERT_CHANNELS)[number]

// =============================================================================
// Request schemas + DTOs
// =============================================================================

export const createAlertSchema = z.object({
  type: z.enum(ALERT_RULE_TYPES),
  /**
   * Threshold semantics depend on `type`:
   *   USAGE_THRESHOLD  — cents (cumulative cost in current period)
   *   DAILY_LIMIT      — cents (cumulative cost in last 24h)
   *   ERROR_RATE_HIGH  — basis points (e.g. 500 = 5%)
   *   LATENCY_P95_HIGH — milliseconds
   */
  threshold: z.number().int().positive(),
  /** Optional: scope to a single application; null = whole account. */
  applicationId: z.string().uuid().optional(),
  channel: z.enum(ALERT_CHANNELS).optional(),
  isActive: z.boolean().optional(),
})
export class CreateAlertDto extends createZodDto(createAlertSchema) {}

export const updateAlertSchema = z
  .object({
    threshold: z.number().int().positive().optional(),
    applicationId: z.string().uuid().nullable().optional(),
    channel: z.enum(ALERT_CHANNELS).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  })
export class UpdateAlertDto extends createZodDto(updateAlertSchema) {}

// =============================================================================
// Response schemas + DTOs
// =============================================================================

export const alertSummarySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ALERT_RULE_TYPES),
  threshold: z.number().int(),
  applicationId: z.string().uuid().nullable(),
  channel: z.enum(ALERT_CHANNELS),
  isActive: z.boolean(),
  lastTriggered: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export class AlertSummaryDto extends createZodDto(alertSummarySchema) {}

export const alertListResponseSchema = z.array(alertSummarySchema)
export class AlertListResponseDto extends createZodDto(alertListResponseSchema) {}

// Dry-run preview

export const dryRunRequestSchema = z.object({
  type: z.enum(ALERT_RULE_TYPES),
  threshold: z.number().int().positive(),
  applicationId: z.string().uuid().nullable().optional(),
})
export class DryRunRequestDto extends createZodDto(dryRunRequestSchema) {}

export const dryRunResponseSchema = z.object({
  windowDays: z.number().int(),
  triggers: z.array(
    z.object({
      at: z.string(),
      measured: z.number(),
    }),
  ),
  peak: z
    .object({ at: z.string(), measured: z.number() })
    .nullable(),
})
export class DryRunResponseDto extends createZodDto(dryRunResponseSchema) {}
