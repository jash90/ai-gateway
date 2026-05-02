import { Injectable, Logger } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'
import {
  BaseProvider,
  type ProviderResponse,
  type ProxyOptions,
  type UsageMetrics,
} from './base-provider'

/**
 * OpenRouter provider. OpenRouter exposes an OpenAI-compatible
 * `/api/v1/chat/completions` endpoint that accepts vendor/model strings
 * (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, `meta-llama/llama-3-70b`)
 * and routes to the underlying provider.
 *
 * Routing assumption: when ProviderRouterService picks OPENROUTER, the model
 * name is passed through as-is (with vendor/model prefix preserved). Examples:
 *   - `openrouter/openai/gpt-4o`         → strip "openrouter/" → `openai/gpt-4o`
 *   - `meta-llama/llama-3-70b-instruct`  → no prefix, ProviderRouter falls back to OPENROUTER
 *
 * Stream pass-through behaves identically to OpenAIProvider.
 */
@Injectable()
export class OpenRouterProvider extends BaseProvider {
  protected readonly logger = new Logger(OpenRouterProvider.name)
  readonly providerType: ProviderType = 'OPENROUTER'
  protected readonly defaultBaseUrl = 'https://openrouter.ai/api'

  async proxy(options: ProxyOptions): Promise<ProviderResponse> {
    const baseUrl = options.baseUrlOverride ?? this.defaultBaseUrl
    const url = `${baseUrl}/v1/chat/completions`

    const { response, latencyMs } = await this.timedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        // OpenRouter recommends these headers for attribution. Optional.
        'HTTP-Referer': 'https://api.raccoon.dev',
        'X-Title': 'Raccoon AI Gateway',
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
      return {
        statusCode: response.status,
        body: response.body,
        usage: null,
        requestId,
        latencyMs,
        ttftMs: latencyMs,
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
// Response parsing — OpenRouter mirrors OpenAI's chat completions shape
// =============================================================================

function extractUsage(body: unknown): UsageMetrics | null {
  const u = (body as { usage?: Record<string, number> } | null)?.usage
  if (!u || typeof u !== 'object') return null
  return {
    inputTokens: Number(u.prompt_tokens ?? 0),
    outputTokens: Number(u.completion_tokens ?? 0),
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
}

function extractFinishReason(body: unknown): string | null {
  const choice = (body as { choices?: Array<{ finish_reason?: string }> } | null)
    ?.choices?.[0]
  return choice?.finish_reason ?? null
}

function extractErrorCode(body: unknown, status: number): string {
  const code = (body as { error?: { code?: string } } | null)?.error?.code
  if (code) return `OPENROUTER_${String(code).toUpperCase()}`
  if (status === 401) return 'UPSTREAM_AUTH_FAILED'
  if (status === 429) return 'UPSTREAM_RATE_LIMITED'
  if (status >= 500) return 'UPSTREAM_SERVER_ERROR'
  return 'UPSTREAM_ERROR'
}
