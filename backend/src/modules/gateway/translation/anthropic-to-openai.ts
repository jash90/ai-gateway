import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  AnthropicRequest,
  AnthropicResponse,
} from './types'

/**
 * Translate an Anthropic messages request → OpenAI chat completions request.
 *
 * Behavior:
 *   - `system` field becomes a leading system message
 *   - `messages` content blocks flattened to text
 *   - `stop_sequences` → `stop`
 *   - `metadata.user_id` → `user`
 */
export function anthropicToOpenaiRequest(req: AnthropicRequest): OpenAIChatRequest {
  const messages: OpenAIMessage[] = []

  if (req.system) {
    const systemText = typeof req.system === 'string'
      ? req.system
      : req.system.map((s) => s.text).join('\n\n')
    messages.push({ role: 'system', content: systemText })
  }

  for (const msg of req.messages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('')
    messages.push({ role: msg.role, content: text })
  }

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
  }
  if (req.temperature !== undefined) out.temperature = req.temperature
  if (req.top_p !== undefined) out.top_p = req.top_p
  if (req.stream !== undefined) out.stream = req.stream
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    out.stop = req.stop_sequences.length === 1 ? req.stop_sequences[0] : req.stop_sequences
  }
  if (req.metadata?.user_id) out.user = req.metadata.user_id

  return out
}

/**
 * Translate an OpenAI chat completion response → Anthropic messages response.
 */
export function openaiToAnthropicResponse(
  res: OpenAIChatResponse,
  responseModel?: string,
): AnthropicResponse {
  const choice = res.choices[0]
  const text = choice?.message?.content ?? ''

  return {
    id: res.id.startsWith('chatcmpl-') ? `msg_${res.id.slice('chatcmpl-'.length)}` : `msg_${res.id}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: responseModel ?? res.model,
    stop_reason: mapOpenaiFinishReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage.prompt_tokens,
      output_tokens: res.usage.completion_tokens,
    },
  }
}

function mapOpenaiFinishReason(reason: string | null): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return reason
  }
}
