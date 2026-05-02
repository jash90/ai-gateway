import type {
  RaccoonClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  MessagesRequest,
  MessagesResponse,
  ModelsResponse,
} from './types'
import { RaccoonError } from './types'

const DEFAULT_BASE_URL = 'https://api.raccoon.dev'

/**
 * Native Raccoon AI Gateway client.
 *
 * Two ways to use it:
 *
 *   // 1. As a typed client:
 *   const client = new RaccoonClient({ apiKey: process.env.RACCOON_KEY! })
 *   const r = await client.chat.completions.create({ model: 'gpt-4o', messages: [...] })
 *
 *   // 2. As a baseURL for the official OpenAI / Anthropic SDKs:
 *   import OpenAI from 'openai'
 *   const openai = new OpenAI({
 *     apiKey: process.env.RACCOON_KEY,
 *     baseURL: 'https://api.raccoon.dev/v1',
 *   })
 *
 * `withEndUser(externalId)` returns a per-call wrapper that adds the
 * `x-rcn-end-user` header so usage attribution flows through.
 */
export class RaccoonClient {
  private apiKey: string
  private baseUrl: string
  private defaultHeaders: Record<string, string>

  constructor(options: RaccoonClientOptions) {
    if (!options.apiKey) {
      throw new Error('RaccoonClient: apiKey is required.')
    }
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.defaultHeaders = {}
    if (options.endUserId) this.defaultHeaders['x-rcn-end-user'] = options.endUserId
    if (options.provider) this.defaultHeaders['x-rcn-provider'] = options.provider
  }

  /** Returns a clone of this client with `x-rcn-end-user` set to the given ID. */
  withEndUser(externalId: string): RaccoonClient {
    return new RaccoonClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      endUserId: externalId,
      provider: this.defaultHeaders['x-rcn-provider'] as RaccoonClientOptions['provider'],
    })
  }

  /** Returns a clone with explicit provider override. */
  withProvider(provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'): RaccoonClient {
    return new RaccoonClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      provider,
      endUserId: this.defaultHeaders['x-rcn-end-user'],
    })
  }

  // ---------------------------------------------------------------------------
  // chat.completions — OpenAI-compat
  // ---------------------------------------------------------------------------

  readonly chat = {
    completions: {
      create: async (
        request: ChatCompletionRequest,
      ): Promise<ChatCompletionResponse | ReadableStream<Uint8Array>> => {
        const response = await this.request('POST', '/v1/chat/completions', request)
        if (request.stream) {
          if (!response.body) throw new Error('No response body for stream.')
          return response.body
        }
        return (await response.json()) as ChatCompletionResponse
      },
    },
  }

  // ---------------------------------------------------------------------------
  // messages — Anthropic-compat
  // ---------------------------------------------------------------------------

  readonly messages = {
    create: async (
      request: MessagesRequest,
    ): Promise<MessagesResponse | ReadableStream<Uint8Array>> => {
      const response = await this.request('POST', '/v1/messages', request)
      if (request.stream) {
        if (!response.body) throw new Error('No response body for stream.')
        return response.body
      }
      return (await response.json()) as MessagesResponse
    },
  }

  // ---------------------------------------------------------------------------
  // models
  // ---------------------------------------------------------------------------

  readonly models = {
    list: async (): Promise<ModelsResponse> => {
      const response = await this.request('GET', '/v1/models')
      return (await response.json()) as ModelsResponse
    },
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const upstreamBody = await response.json().catch(() => null)
      const errorCode =
        (upstreamBody as { errorCode?: string } | null)?.errorCode ?? null
      const message =
        (upstreamBody as { message?: string } | null)?.message ??
        `Raccoon Gateway returned HTTP ${response.status}`
      throw new RaccoonError(response.status, errorCode, message, upstreamBody)
    }

    return response
  }
}

export { RaccoonError }
export type {
  RaccoonClientOptions,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  MessagesRequest,
  MessagesResponse,
  ModelEntry,
  ModelsResponse,
} from './types'
