import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  AnthropicRequest,
  AnthropicResponse,
} from './types'

const DEFAULT_MAX_TOKENS = 1024

/**
 * Translate an OpenAI chat completions request → Anthropic messages request.
 *
 * Behavior:
 *   - System messages collected and joined (Anthropic puts them in `system`)
 *   - tool messages collapsed into user content (best-effort, Sprint 3 native tools)
 *   - Multi-content messages flattened to text-only
 *   - max_tokens defaults to 1024 if absent (Anthropic requires it)
 *   - n > 1 silently dropped (Anthropic supports only one completion)
 */
export function openaiToAnthropicRequest(req: OpenAIChatRequest): AnthropicRequest {
  const systemParts: string[] = []
  const messages: AnthropicRequest['messages'] = []

  for (const msg of req.messages) {
    const text = flattenContent(msg.content)
    if (msg.role === 'system') {
      systemParts.push(text)
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: text })
    } else if (msg.role === 'tool') {
      // Best-effort: surface tool result as a user message. Sprint 3 will
      // translate to Anthropic's tool_result content blocks.
      messages.push({ role: 'user', content: `[tool result]: ${text}` })
    }
  }

  const out: AnthropicRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? req.max_completion_tokens ?? DEFAULT_MAX_TOKENS,
  }

  if (systemParts.length > 0) {
    out.system = systemParts.join('\n\n')
  }
  if (req.temperature !== undefined) out.temperature = req.temperature
  if (req.top_p !== undefined) out.top_p = req.top_p
  if (req.stream !== undefined) out.stream = req.stream
  if (req.stop !== undefined) {
    out.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop]
  }
  if (req.user) out.metadata = { user_id: req.user }

  return out
}

/**
 * Translate an Anthropic messages response → OpenAI chat completion response.
 */
export function anthropicToOpenaiResponse(
  res: AnthropicResponse,
  /** Pass-through model name from the original OpenAI request, in case caller wants the prefix. */
  responseModel?: string,
): OpenAIChatResponse {
  const text = res.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')

  return {
    id: `chatcmpl-${res.id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: responseModel ?? res.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: mapAnthropicStopReason(res.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: res.usage.input_tokens,
      completion_tokens: res.usage.output_tokens,
      total_tokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  }
}

// =============================================================================
// Helpers
// =============================================================================

function flattenContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
    .filter(Boolean)
    .join('')
}

function mapAnthropicStopReason(reason: string | null): string {
  switch (reason) {
    case 'end_turn':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    default:
      return reason ?? 'stop'
  }
}
