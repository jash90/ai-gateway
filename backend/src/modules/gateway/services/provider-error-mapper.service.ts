import { Injectable } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'

/**
 * ProviderErrorMapper — detects "provider has no funds" responses across the
 * three providers and emits a unified error code.
 *
 * Used by the gateway after a provider call: if the result matches any of
 * these patterns, we refund the held wallet tokens and return 402 with
 * `errorCode: PROVIDER_INSUFFICIENT_FUNDS` so the user sees a helpful
 * message instead of "internal error".
 */
@Injectable()
export class ProviderErrorMapper {
  /**
   * Returns 'PROVIDER_INSUFFICIENT_FUNDS' when the response signals an
   * out-of-credits state at the upstream provider, otherwise null.
   */
  mapInsufficientFunds(
    provider: ProviderType,
    statusCode: number,
    body: unknown,
  ): 'PROVIDER_INSUFFICIENT_FUNDS' | null {
    if (statusCode < 400) return null

    if (provider === 'OPENAI') {
      // OpenAI: 429 with body.error.code = 'insufficient_quota'
      if (statusCode === 429) {
        const code = readPath(body, ['error', 'code'])
        const type = readPath(body, ['error', 'type'])
        if (code === 'insufficient_quota' || type === 'insufficient_quota') {
          return 'PROVIDER_INSUFFICIENT_FUNDS'
        }
      }
    }

    if (provider === 'ANTHROPIC') {
      // Anthropic: 400 with message containing "credit balance"
      if (statusCode === 400) {
        const msg = readPath(body, ['error', 'message'])
        if (typeof msg === 'string' && /credit\s*balance/i.test(msg)) {
          return 'PROVIDER_INSUFFICIENT_FUNDS'
        }
      }
    }

    if (provider === 'OPENROUTER') {
      // OpenRouter: status 402 passthrough
      if (statusCode === 402) {
        return 'PROVIDER_INSUFFICIENT_FUNDS'
      }
    }

    return null
  }
}

function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return cur
}
