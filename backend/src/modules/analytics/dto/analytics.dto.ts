import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

// =============================================================================
// Common query schemas
// =============================================================================

const dateRangeSchema = {
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  applicationId: z.string().uuid().optional(),
}

export const overviewQuerySchema = z.object(dateRangeSchema)
export class OverviewQueryDto extends createZodDto(overviewQuerySchema) {}

export const breakdownQuerySchema = z.object({
  ...dateRangeSchema,
  dimension: z.enum(['app', 'model', 'provider', 'endUser']),
})
export class BreakdownQueryDto extends createZodDto(breakdownQuerySchema) {}

export const timeseriesQuerySchema = z.object({
  ...dateRangeSchema,
  metric: z.enum(['requests', 'tokens', 'cost', 'latency_p95']),
  granularity: z.enum(['hour', 'day']),
})
export class TimeseriesQueryDto extends createZodDto(timeseriesQuerySchema) {}

export const eventsQuerySchema = z.object({
  ...dateRangeSchema,
  /** Cursor: ISO datetime + id, encoded as `<isoCreatedAt>__<eventId>`. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']).optional(),
  status: z.enum(['success', 'client_error', 'server_error']).optional(),
  model: z.string().optional(),
})
export class EventsQueryDto extends createZodDto(eventsQuerySchema) {}

// =============================================================================
// Response schemas
// =============================================================================

export const overviewResponseSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
  errorCount: z.number().int().nonnegative(),
  fromIso: z.string(),
  toIso: z.string(),
})
export class OverviewResponseDto extends createZodDto(overviewResponseSchema) {}

export const breakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  errorCount: z.number().int().nonnegative(),
})
export const breakdownResponseSchema = z.object({
  dimension: z.enum(['app', 'model', 'provider', 'endUser']),
  rows: z.array(breakdownRowSchema),
})
export class BreakdownResponseDto extends createZodDto(breakdownResponseSchema) {}

export const timeseriesPointSchema = z.object({
  bucket: z.string(),
  value: z.number(),
})
export const timeseriesResponseSchema = z.object({
  metric: z.enum(['requests', 'tokens', 'cost', 'latency_p95']),
  granularity: z.enum(['hour', 'day']),
  points: z.array(timeseriesPointSchema),
})
export class TimeseriesResponseDto extends createZodDto(timeseriesResponseSchema) {}

export const eventRowSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  applicationKeyId: z.string().uuid(),
  endUserId: z.string().uuid().nullable(),
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']),
  model: z.string(),
  isStream: z.boolean(),
  statusCode: z.number().int(),
  errorCode: z.string().nullable(),
  finishReason: z.string().nullable(),
  requestId: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheCreationTokens: z.number().int(),
  costUsd: z.number().nullable(),
  ttftMs: z.number().int().nullable(),
  latencyMs: z.number().int(),
  createdAt: z.coerce.date(),
})
export const eventsResponseSchema = z.object({
  events: z.array(eventRowSchema),
  /** Pass back as `cursor` query param to fetch next page. Null = no more. */
  nextCursor: z.string().nullable(),
})
export class EventsResponseDto extends createZodDto(eventsResponseSchema) {}
