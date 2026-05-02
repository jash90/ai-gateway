/**
 * Translation layer between OpenAI's chat completions API and Anthropic's
 * messages API. Sprint 2 covers text-only chat + non-streaming. Sprint 3
 * adds tool calls, image inputs, and stream-aware translation.
 */

// =============================================================================
// OpenAI shapes (chat completions)
// =============================================================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text'; text: string }>
  name?: string
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  stop?: string | string[]
  user?: string
  /** Allow extra fields for provider-specific options. */
  [key: string]: unknown
}

export interface OpenAIChatResponse {
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

// =============================================================================
// Anthropic shapes (messages API)
// =============================================================================

export type AnthropicMessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: string; [k: string]: unknown }>

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicMessageContent
}

export interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  max_tokens: number
  system?: string | Array<{ type: 'text'; text: string }>
  temperature?: number
  top_p?: number
  stream?: boolean
  stop_sequences?: string[]
  metadata?: { user_id?: string }
  [key: string]: unknown
}

export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<{ type: 'text'; text: string }>
  model: string
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}
