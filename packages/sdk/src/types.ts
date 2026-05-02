// =============================================================================
// Public types for @raccoon/sdk
//
// Mirrors the gateway request/response shapes (OpenAI-compat at /v1/chat/completions
// and Anthropic-compat at /v1/messages). We don't fully re-declare every option —
// `[key: string]: unknown` keeps unknown fields passing through.
// =============================================================================

export interface RaccoonClientOptions {
  /** Application key — `sk-rcn-live-...` from the dashboard. */
  apiKey: string
  /** Defaults to `https://api.raccoon.dev`. */
  baseUrl?: string
  /** Optional end-user attribution — sent as `x-rcn-end-user` header. */
  endUserId?: string
  /** Optional explicit provider override — sent as `x-rcn-provider` header. */
  provider?: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
  [key: string]: unknown
}

export interface ChatCompletionResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant'; content: string }
    finish_reason: string | null
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface MessagesRequest {
  model: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens: number
  system?: string
  temperature?: number
  stream?: boolean
  [key: string]: unknown
}

export interface MessagesResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<{ type: 'text'; text: string }>
  model: string
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}

export interface ModelEntry {
  id: string
  object: 'model'
  owned_by: string
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  display_name: string | null
}

export interface ModelsResponse {
  object: 'list'
  data: ModelEntry[]
}

export class RaccoonError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string | null,
    message: string,
    public readonly upstreamBody?: unknown,
  ) {
    super(message)
    this.name = 'RaccoonError'
  }
}
