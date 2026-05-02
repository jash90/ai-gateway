import type { ProviderType } from '@prisma/client'
import type { UsageMetrics } from '../providers/base-provider'

/**
 * Extracts token usage from a Server-Sent Events stream WHILE relaying every
 * chunk byte-for-byte to the client. Both providers stream JSON-in-data lines:
 *
 *   - OpenAI: each `data: {...}` chunk; LAST chunk before `data: [DONE]` carries
 *             `usage: { prompt_tokens, completion_tokens, prompt_tokens_details }`
 *             when `stream_options.include_usage: true` is sent.
 *   - Anthropic: event-stream with `event: message_start` (usage.input_tokens),
 *             `event: message_delta` (usage.output_tokens cumulative), and
 *             `event: message_stop`. We accumulate the latest output_tokens.
 *
 * Implementation uses a TransformStream that splits chunks on '\n\n' (SSE
 * record boundary), parses each record locally, and re-emits the same bytes
 * unchanged downstream.
 *
 * State is per-instance — create a fresh extractor per request.
 */

export interface ExtractorResult {
  /** Final usage metrics, available after the source stream closes. */
  getUsage(): UsageMetrics | null
  /** First-chunk timestamp (ms epoch), set when the first chunk arrives. */
  getFirstChunkAt(): number | null
  /** Provider's reported finish reason (last seen). */
  getFinishReason(): string | null
}

const TEXT_DECODER = new TextDecoder()
const TEXT_ENCODER = new TextEncoder()

interface ExtractorState {
  buffer: string
  usage: UsageMetrics | null
  finishReason: string | null
  firstChunkAt: number | null
  forceIncludeUsageNote: boolean
}

/**
 * Wrap a ReadableStream<Uint8Array> with usage extraction. Returns a NEW stream
 * that emits the same bytes downstream, plus an ExtractorResult for late retrieval.
 */
export function createUsageExtractorStream(
  source: ReadableStream<Uint8Array>,
  provider: ProviderType,
): { stream: ReadableStream<Uint8Array>; result: ExtractorResult } {
  const state: ExtractorState = {
    buffer: '',
    usage: null,
    finishReason: null,
    firstChunkAt: null,
    forceIncludeUsageNote: false,
  }

  const parseRecord = pickParser(provider)

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (state.firstChunkAt === null) {
        state.firstChunkAt = Date.now()
      }
      // Pass-through immediately so client sees no extra latency.
      controller.enqueue(chunk)

      // Buffer + scan for SSE record boundaries (\n\n).
      state.buffer += TEXT_DECODER.decode(chunk, { stream: true })
      let idx: number
      while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
        const record = state.buffer.slice(0, idx)
        state.buffer = state.buffer.slice(idx + 2)
        try {
          parseRecord(record, state)
        } catch {
          // SSE parse failures are not fatal — continue streaming, lose usage.
        }
      }
    },
    flush() {
      // Drain any tail (rarely happens with well-formed providers).
      if (state.buffer.trim()) {
        try {
          parseRecord(state.buffer, state)
        } catch {
          // ignored
        }
      }
    },
  })

  const stream = source.pipeThrough(transform)
  const result: ExtractorResult = {
    getUsage: () => state.usage,
    getFirstChunkAt: () => state.firstChunkAt,
    getFinishReason: () => state.finishReason,
  }
  return { stream, result }
}

// =============================================================================
// Provider-specific SSE parsers
// =============================================================================

function pickParser(provider: ProviderType): (record: string, s: ExtractorState) => void {
  switch (provider) {
    case 'OPENAI':
      return parseOpenAIRecord
    case 'OPENROUTER':
      return parseOpenAIRecord // same OpenAI-compat shape
    case 'ANTHROPIC':
      return parseAnthropicRecord
    default:
      return () => {
        // unknown provider — no-op
      }
  }
}

function parseOpenAIRecord(record: string, s: ExtractorState): void {
  // OpenAI records: one or more `data: ...` lines; can have `[DONE]` sentinel.
  for (const line of record.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') continue

    const json = JSON.parse(payload) as {
      choices?: Array<{ finish_reason?: string }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
    }

    if (json.choices?.[0]?.finish_reason) {
      s.finishReason = json.choices[0].finish_reason
    }

    if (json.usage) {
      s.usage = {
        inputTokens: Number(json.usage.prompt_tokens ?? 0),
        outputTokens: Number(json.usage.completion_tokens ?? 0),
        cacheReadTokens: Number(json.usage.prompt_tokens_details?.cached_tokens ?? 0),
        cacheCreationTokens: 0,
      }
    }
  }
}

function parseAnthropicRecord(record: string, s: ExtractorState): void {
  // Anthropic records: `event: <type>` line + `data: <json>` line.
  let event: string | null = null
  let dataRaw: string | null = null
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataRaw = line.slice('data:'.length).trim()
  }
  if (!event || !dataRaw) return

  const data = JSON.parse(dataRaw) as {
    message?: {
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
      stop_reason?: string
    }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    delta?: { stop_reason?: string }
  }

  if (event === 'message_start' && data.message?.usage) {
    const u = data.message.usage
    s.usage = {
      inputTokens: Number(u.input_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
      cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
    }
  } else if (event === 'message_delta') {
    // message_delta carries cumulative output_tokens + final stop_reason.
    if (s.usage && data.usage?.output_tokens !== undefined) {
      s.usage.outputTokens = Number(data.usage.output_tokens)
    }
    if (data.delta?.stop_reason) {
      s.finishReason = data.delta.stop_reason
    }
  }
}

/**
 * Force `stream_options.include_usage: true` on outgoing OpenAI requests so the
 * stream's last chunk includes token counts. No-op for non-OpenAI providers.
 */
export function forceIncludeUsage(
  provider: ProviderType,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (provider !== 'OPENAI' && provider !== 'OPENROUTER') return body
  if (body.stream !== true) return body
  const existing = (body.stream_options as Record<string, unknown> | undefined) ?? {}
  return {
    ...body,
    stream_options: { ...existing, include_usage: true },
  }
}

/** Re-export for test parity / encoder consistency. */
export { TEXT_ENCODER as STREAM_TEXT_ENCODER }
