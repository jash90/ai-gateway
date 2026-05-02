import { Logger } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'

/**
 * Token usage extracted from a successful response. Mirrors the shape of
 * UsageEvent's accounting columns.
 */
export interface UsageMetrics {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ProviderResponse {
  /** HTTP status from upstream. */
  statusCode: number
  /** Parsed JSON body (for non-stream) or null (for stream — caller streams reply.raw). */
  body: unknown
  /** Token accounting if extractable from the upstream response. */
  usage: UsageMetrics | null
  /** Upstream's request ID, if surfaced in headers. */
  requestId: string | null
  /** Wall-clock latency from request send to response complete (ms). */
  latencyMs: number
  /** Time-to-first-byte / first chunk (ms). For non-stream === latencyMs. */
  ttftMs: number | null
  /** Set when upstream returned an error (>= 400). Captures backend-side parsed code. */
  errorCode: string | null
  /** Provider-side stop reason ("stop", "length", "tool_use", ...). */
  finishReason: string | null
}

export interface ProxyOptions {
  /** Decrypted upstream API key. */
  apiKey: string
  /** Whether the client requested streaming (we may pass-through SSE). */
  isStream: boolean
  /** Raw request body to forward to upstream (already routed/translated). */
  body: unknown
  /** Optional per-call override of the upstream URL (e.g. for testing). */
  baseUrlOverride?: string
  /** Abort signal — currently unused, hook for Sprint 3 streaming cancel. */
  signal?: AbortSignal
}

/**
 * Abstract base for upstream provider adapters. One subclass per ProviderType.
 *
 * Subclasses implement `proxy()` which:
 *   1. Sends the request to the provider's API with the BYOK key
 *   2. Returns ProviderResponse with extracted usage if non-stream, null if stream
 *
 * Streaming is currently pass-through (we don't yet parse SSE for usage). Sprint 3
 * adds `UsageExtractorTransform` which inline-parses the SSE stream to extract usage
 * mid-flight while still sending each chunk to the client.
 */
export abstract class BaseProvider {
  protected abstract readonly logger: Logger
  abstract readonly providerType: ProviderType
  /** Default upstream URL — overridable via `baseUrlOverride`. */
  protected abstract readonly defaultBaseUrl: string

  abstract proxy(options: ProxyOptions): Promise<ProviderResponse>

  /**
   * Helper used by subclasses: time the fetch + return parsed body or error.
   * Centralizes wall-clock measurement.
   */
  protected async timedFetch(
    url: string,
    init: RequestInit,
  ): Promise<{ response: Response; latencyMs: number }> {
    const t0 = Date.now()
    const response = await fetch(url, init)
    const latencyMs = Date.now() - t0
    return { response, latencyMs }
  }
}
