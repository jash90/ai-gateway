import { Injectable, Logger } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'
import {
  BaseProvider,
  type ProviderResponse,
  type ProxyOptions,
  type UsageMetrics,
} from './base-provider'

/**
 * Anthropic / Messages API provider. Forwards to `/v1/messages`.
 *
 * For non-stream: extracts usage from response.usage (input_tokens,
 * output_tokens, cache_read_input_tokens, cache_creation_input_tokens).
 * For stream: pass-through (Sprint 3 will inline-parse the SSE event stream).
 *
 * Stream usage extraction (Sprint 3): Anthropic emits `message_start` with
 * input usage, then `message_delta` events carry cumulative output tokens.
 */
@Injectable()
export class AnthropicProvider extends BaseProvider {
  protected readonly logger = new Logger(AnthropicProvider.name)
  readonly providerType: ProviderType = 'ANTHROPIC'
  protected readonly defaultBaseUrl = 'https://api.anthropic.com'

  async proxy(options: ProxyOptions): Promise<ProviderResponse> {
    const baseUrl = options.baseUrlOverride ?? this.defaultBaseUrl
    const url = `${baseUrl}/v1/messages`

    const { response, latencyMs } = await this.timedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(options.body),
      signal: options.signal,
    })

    const requestId = response.headers.get('anthropic-request-id') ?? response.headers.get('x-request-id')

    if (!response.ok) {
      const errorBody = await this.safeJson(response)
      return {
        statusCode: response.status,
        body: errorBody,
        usage: null,
        requestId,
        latencyMs,
        ttftMs: null,
        errorCode: extractErrorCode(errorBody, response.status),
        finishReason: null,
      }
    }

    if (options.isStream) {
      // Stream pass-through with inline UsageExtractor (handled by gateway service).
      return {
        statusCode: response.status,
        body: response.body,
        usage: null,
        requestId,
        latencyMs,
        ttftMs: null,
        errorCode: null,
        finishReason: null,
      }
    }

    const json = await this.safeJson(response)
    const usage = extractUsage(json)
    const finishReason = extractStopReason(json)

    return {
      statusCode: response.status,
      body: json,
      usage,
      requestId,
      latencyMs,
      ttftMs: latencyMs,
      errorCode: null,
      finishReason,
    }
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
}

// =============================================================================
// Response parsing helpers (module-private)
// =============================================================================

function extractUsage(body: unknown): UsageMetrics | null {
  const u = (body as { usage?: Record<string, number> } | null)?.usage
  if (!u || typeof u !== 'object') return null
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
  }
}

function extractStopReason(body: unknown): string | null {
  return (body as { stop_reason?: string } | null)?.stop_reason ?? null
}

function extractErrorCode(body: unknown, status: number): string {
  const type = (body as { error?: { type?: string } } | null)?.error?.type
  if (type) return `ANTHROPIC_${type.toUpperCase()}`
  if (status === 401) return 'UPSTREAM_AUTH_FAILED'
  if (status === 429) return 'UPSTREAM_RATE_LIMITED'
  if (status >= 500) return 'UPSTREAM_SERVER_ERROR'
  return 'UPSTREAM_ERROR'
}
