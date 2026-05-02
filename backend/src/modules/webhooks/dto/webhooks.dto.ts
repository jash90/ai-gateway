import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

/**
 * Webhook event types emitted by the system. Stable string identifiers —
 * adding new events is non-breaking, removing/renaming is breaking.
 *
 * Customers subscribe to a subset by including the event name in `events[]`
 * on their WebhookConfig.
 */
export const WEBHOOK_EVENT_TYPES = [
  'usage.recorded',
  'request.error',
  'provider_key.invalid',
  'application.created',
  'application.deleted',
  'key.created',
  'key.revoked',
  'alert.triggered',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

// =============================================================================
// Request schemas + DTOs
// =============================================================================

const eventArraySchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .min(1, 'Select at least one event type.')

export const createWebhookSchema = z.object({
  url: z.string().url(),
  events: eventArraySchema,
  isActive: z.boolean().optional(),
})
export class CreateWebhookDto extends createZodDto(createWebhookSchema) {}

export const updateWebhookSchema = z
  .object({
    url: z.string().url().optional(),
    events: eventArraySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  })
export class UpdateWebhookDto extends createZodDto(updateWebhookSchema) {}

// =============================================================================
// Response schemas + DTOs
// =============================================================================

export const webhookSummarySchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  events: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // Last delivery status for at-a-glance health.
  lastDelivery: z
    .object({
      event: z.string(),
      statusCode: z.number().int().nullable(),
      deliveredAt: z.coerce.date().nullable(),
      createdAt: z.coerce.date(),
    })
    .nullable(),
})
export class WebhookSummaryDto extends createZodDto(webhookSummarySchema) {}

export const webhookListResponseSchema = z.array(webhookSummarySchema)
export class WebhookListResponseDto extends createZodDto(webhookListResponseSchema) {}

/**
 * One-time create response. Includes the HMAC signing secret — the customer
 * MUST store this; we don't expose it again. Subsequent reads omit `secret`.
 */
export const webhookCreatedSchema = webhookSummarySchema.extend({
  secret: z.string(),
})
export class WebhookCreatedDto extends createZodDto(webhookCreatedSchema) {}

export const webhookDeliverySchema = z.object({
  id: z.string().uuid(),
  event: z.string(),
  payload: z.unknown(),
  statusCode: z.number().int().nullable(),
  response: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  deliveredAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
})
export const webhookDeliveryListResponseSchema = z.array(webhookDeliverySchema)
export class WebhookDeliveryListResponseDto extends createZodDto(
  webhookDeliveryListResponseSchema,
) {}
