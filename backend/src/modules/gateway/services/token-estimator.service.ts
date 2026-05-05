import { Injectable, Logger } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'

interface EstimateResult {
  /** Approximate prompt tokens parsed from the request body. */
  inputTokens: number
  /** `max_tokens` from body, or fallback default. */
  maxOutputTokens: number
  /** Total tokens to hold (input + max output). */
  totalTokens: number
}

const DEFAULT_MAX_OUTPUT = 4096
const FALLBACK_CHARS_PER_TOKEN = 4 // utf-8 heuristic

/**
 * TokenEstimatorService — pre-flight token count for billing pre-check.
 *
 * Uses provider-native tokenizers when available (cl100k for OpenAI/OpenRouter,
 * @anthropic-ai/tokenizer for Anthropic). Falls back to char/4 heuristic on
 * tokenizer load failure (e.g. WASM init error in resource-constrained envs).
 *
 * The estimate is intentionally generous (input + max_tokens) — the worker
 * later settles against actual usage and refunds overage.
 */
@Injectable()
export class TokenEstimatorService {
  private readonly logger = new Logger(TokenEstimatorService.name)
  // Lazy-loaded tokenizers — keep cold start sane (tiktoken WASM ~1MB).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cl100kEncoder: any = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private anthropicTokenizer: any = null

  estimate(provider: ProviderType, body: Record<string, unknown>): EstimateResult {
    const inputTokens = this.estimateInputTokens(provider, body)
    const maxOutputTokens = this.extractMaxTokens(body) ?? DEFAULT_MAX_OUTPUT
    return {
      inputTokens,
      maxOutputTokens,
      totalTokens: inputTokens + maxOutputTokens,
    }
  }

  private estimateInputTokens(provider: ProviderType, body: Record<string, unknown>): number {
    const text = this.extractPromptText(body)
    if (!text) return 0

    try {
      if (provider === 'OPENAI' || provider === 'OPENROUTER') {
        return this.countCl100k(text)
      }
      if (provider === 'ANTHROPIC') {
        return this.countAnthropic(text)
      }
    } catch (err) {
      this.logger.warn(
        `Tokenizer failed for ${provider}, falling back to char/4: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      )
    }

    return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN)
  }

  private countCl100k(text: string): number {
    if (!this.cl100kEncoder) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tiktoken = require('tiktoken') as { get_encoding: (n: string) => unknown }
      this.cl100kEncoder = tiktoken.get_encoding('cl100k_base')
    }
    const tokens = this.cl100kEncoder.encode(text)
    return tokens.length
  }

  private countAnthropic(text: string): number {
    if (!this.anthropicTokenizer) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@anthropic-ai/tokenizer') as { countTokens?: (t: string) => number }
      this.anthropicTokenizer = mod.countTokens
    }
    if (typeof this.anthropicTokenizer === 'function') {
      return this.anthropicTokenizer(text)
    }
    return Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN)
  }

  /**
   * Extracts concatenated prompt text from a chat-style request body.
   * Supports OpenAI/OpenRouter `messages` shape and Anthropic `messages` +
   * `system` shape. Strings, multimodal content arrays, and tool calls all
   * collapse to text-only for counting purposes (good-enough estimate).
   */
  private extractPromptText(body: Record<string, unknown>): string {
    const parts: string[] = []

    // Anthropic-style top-level system
    if (typeof body.system === 'string') parts.push(body.system)

    const messages = body.messages
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue
        const m = msg as Record<string, unknown>
        const content = m.content
        if (typeof content === 'string') {
          parts.push(content)
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'string') {
              parts.push(block)
            } else if (block && typeof block === 'object') {
              const b = block as Record<string, unknown>
              if (typeof b.text === 'string') parts.push(b.text)
            }
          }
        }
      }
    }

    return parts.join('\n')
  }

  private extractMaxTokens(body: Record<string, unknown>): number | null {
    if (typeof body.max_tokens === 'number') return body.max_tokens
    if (typeof body.max_completion_tokens === 'number') return body.max_completion_tokens
    return null
  }
}
