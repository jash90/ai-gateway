import { Injectable, BadRequestException } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'

/**
 * Routes incoming requests to the right upstream provider based on the model name.
 *
 * Supported prefixes:
 *   - `openai/<model>`     → OpenAI
 *   - `anthropic/<model>`  → Anthropic
 *   - `openrouter/<model>` → OpenRouter
 *
 * No prefix (bare model name): infer from well-known patterns:
 *   - `gpt-*`, `o1*`, `o3*`, `text-*`           → OpenAI
 *   - `claude-*`                                → Anthropic
 *   - any other "<vendor>/<model>" with vendor not in our list → OpenRouter
 *     (OpenRouter handles cross-vendor model routing via its own naming)
 *
 * Override: an explicit `x-rcn-provider` request header bypasses inference.
 */

export interface RoutedRequest {
  provider: ProviderType
  /** Model name as it should be sent to the upstream API (prefix stripped). */
  model: string
}

const SUPPORTED_PROVIDERS: ProviderType[] = ['OPENAI', 'ANTHROPIC', 'OPENROUTER']

@Injectable()
export class ProviderRouterService {
  /**
   * @param model    The user-supplied `model` string from the request body.
   * @param override Optional `x-rcn-provider` header value (case-insensitive).
   */
  route(model: string, override?: string): RoutedRequest {
    if (!model || typeof model !== 'string') {
      throw new BadRequestException({
        errorCode: 'MODEL_REQUIRED',
        message: 'Request body must include a `model` field.',
      })
    }

    if (override) {
      const provider = override.toUpperCase() as ProviderType
      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new BadRequestException({
          errorCode: 'INVALID_PROVIDER',
          message: `x-rcn-provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
        })
      }
      return { provider, model: stripPrefix(model) }
    }

    // Explicit prefix wins.
    const slash = model.indexOf('/')
    if (slash > 0) {
      const prefix = model.slice(0, slash).toUpperCase() as ProviderType
      if (SUPPORTED_PROVIDERS.includes(prefix)) {
        return { provider: prefix, model: model.slice(slash + 1) }
      }
      // Unknown vendor prefix → assume OpenRouter (it accepts vendor/model strings natively).
      return { provider: 'OPENROUTER', model }
    }

    // No prefix: infer from name patterns.
    const inferred = inferProvider(model)
    if (inferred) {
      return { provider: inferred, model }
    }

    throw new BadRequestException({
      errorCode: 'PROVIDER_UNRECOGNIZED',
      message:
        `Cannot determine provider for model "${model}". Use a prefix ` +
        `(e.g. "anthropic/${model}") or set the x-rcn-provider header.`,
    })
  }
}

function stripPrefix(model: string): string {
  const slash = model.indexOf('/')
  if (slash <= 0) return model
  const prefix = model.slice(0, slash).toUpperCase() as ProviderType
  if (SUPPORTED_PROVIDERS.includes(prefix)) {
    return model.slice(slash + 1)
  }
  return model
}

function inferProvider(model: string): ProviderType | null {
  if (/^gpt-/i.test(model) || /^o[13]/i.test(model) || /^text-/i.test(model)) {
    return 'OPENAI'
  }
  if (/^claude-/i.test(model)) {
    return 'ANTHROPIC'
  }
  return null
}
