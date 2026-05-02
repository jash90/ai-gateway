import { Injectable, Logger } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'
import {
  BaseProvider,
  type ProviderResponse,
  type ProxyOptions,
  type UsageMetrics,
} from './base-provider'

/**
 * OpenAI / Chat Completions provider. Forwards to `/v1/chat/completions`.
 *
 * For non-stream: extracts usage from response.usage.
 * For stream: pass-through (Sprint 3 inlines SSE parsing).
 *
 * Stream usage extraction (Sprint 3): we'll force `stream_options.include_usage`
 * on outgoing requests so the LAST data chunk before [DONE] contains
 * `{ usage: { prompt_tokens, completion_tokens } }`.
 */
@Injectable()
export class OpenAIProvider extends BaseProvider {
  protected readonly logger = new Logger(OpenAIProvider.name)
  readonly providerType: ProviderType = 'OPENAI'
  protected readonly defaultBaseUrl = 'https://api.openai.com'

  async proxy(options: ProxyOptions): Promise<ProviderResponse> {
    const baseUrl = options.baseUrlOverride ?? this.defaultBaseUrl
    const url = `${baseUrl}/v1/chat/completions`

    const { response, latencyMs } = await this.timedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(options.body),
      signal: options.signal,
    })

    const requestId = response.headers.get('x-request-id')

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
      // Stream pass-through with inline UsageExtractor. Caller wires response.body
      // to reply.raw downstream; we extract token usage + finishReason + actual TTFT
      // from the SSE chunks as they flow.
      return {
        statusCode: response.status,
        body: response.body,
        usage: null, // late-bound in caller via streamUsageExtractor below
        requestId,
        latencyMs,
        ttftMs: null, // late-bound from extractor.getFirstChunkAt()
        errorCode: null,
        finishReason: null,
      }
    }

    const json = await this.safeJson(response)
    const usage = extractUsage(json)
    const finishReason = extractFinishReason(json)

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
    inputTokens: Number(u.prompt_tokens ?? 0),
    outputTokens: Number(u.completion_tokens ?? 0),
    // OpenAI exposes prompt_tokens_details.cached_tokens (since 2024-10).
    cacheReadTokens: Number(
      (u as { prompt_tokens_details?: { cached_tokens?: number } })
        .prompt_tokens_details?.cached_tokens ?? 0,
    ),
    cacheCreationTokens: 0,
  }
}

function extractFinishReason(body: unknown): string | null {
  const choice = (body as { choices?: Array<{ finish_reason?: string }> } | null)
    ?.choices?.[0]
  return choice?.finish_reason ?? null
}

function extractErrorCode(body: unknown, status: number): string {
  const code = (body as { error?: { code?: string; type?: string } } | null)
    ?.error?.code
  if (code) return `OPENAI_${code.toUpperCase()}`
  if (status === 401) return 'UPSTREAM_AUTH_FAILED'
  if (status === 429) return 'UPSTREAM_RATE_LIMITED'
  if (status >= 500) return 'UPSTREAM_SERVER_ERROR'
  return 'UPSTREAM_ERROR'
}
