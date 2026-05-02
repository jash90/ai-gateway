/**
 * Transforms an OpenAI /v1/chat/completions SSE stream into an Anthropic
 * /v1/messages SSE stream on-the-fly.
 *
 * Used when an Anthropic-compat client (e.g. @anthropic-ai/sdk) calls
 * /v1/messages with an OpenAI model (e.g. "openai/gpt-4o-mini"). We route to
 * OpenAI upstream, get OpenAI-shape SSE chunks, and re-emit Anthropic events.
 *
 * OpenAI chunks (input):
 *   data: {"id","model","choices":[{"index":0,"delta":{"role":"assistant"}}]}
 *   data: {"...","choices":[{"index":0,"delta":{"content":"Hi"}}]}
 *   data: {"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
 *   data: {"...","choices":[],"usage":{...}}  (when stream_options.include_usage)
 *   data: [DONE]
 *
 * Anthropic events (output):
 *   event: message_start         data: {message: {id, model, role, content: [], usage: {input_tokens}}}
 *   event: content_block_start   data: {index: 0, content_block: {type: "text", text: ""}}
 *   event: content_block_delta   data: {index: 0, delta: {type: "text_delta", text: "Hi"}}
 *   event: content_block_stop    data: {index: 0}
 *   event: message_delta         data: {delta: {stop_reason: "end_turn"}, usage: {output_tokens}}
 *   event: message_stop          data: {}
 */

const TEXT_DECODER = new TextDecoder()
const TEXT_ENCODER = new TextEncoder()

export function openaiToAnthropicStream(
  source: ReadableStream<Uint8Array>,
  clientModel: string,
): ReadableStream<Uint8Array> {
  let buffer = ''
  let messageId = `msg_${Math.random().toString(36).slice(2, 12)}`
  let modelName = clientModel
  let promptTokens = 0
  let completionTokens = 0
  let stopReason: string | null = null
  let messageStarted = false
  let blockStarted = false
  let blockStopped = false
  let messageDeltaSent = false
  let messageStopped = false

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += TEXT_DECODER.decode(chunk, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        for (const line of record.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice('data:'.length).trim()
          if (!payload || payload === '[DONE]') continue

          try {
            const data = JSON.parse(payload) as Record<string, any>

            if (data.model && modelName === clientModel) modelName = data.model
            if (data.id && messageId.startsWith('msg_')) {
              messageId = `msg_${String(data.id).replace(/^chatcmpl-/, '')}`
            }

            const choice = data.choices?.[0]
            const delta = choice?.delta ?? {}

            // Initial role chunk → emit message_start + content_block_start.
            if (!messageStarted) {
              emitEvent(controller, 'message_start', {
                type: 'message_start',
                message: {
                  id: messageId,
                  type: 'message',
                  role: 'assistant',
                  content: [],
                  model: modelName,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              })
              emitEvent(controller, 'content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              })
              messageStarted = true
              blockStarted = true
            }

            // Content delta.
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              emitEvent(controller, 'content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content },
              })
            }

            // Finish reason.
            if (choice?.finish_reason) {
              stopReason = mapFinishReason(choice.finish_reason)
            }

            // Usage chunk (only emitted when stream_options.include_usage).
            if (data.usage) {
              promptTokens = Number(data.usage.prompt_tokens ?? 0)
              completionTokens = Number(data.usage.completion_tokens ?? 0)
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    },
    flush(controller) {
      // Cleanup sequence: content_block_stop → message_delta → message_stop.
      if (blockStarted && !blockStopped) {
        emitEvent(controller, 'content_block_stop', {
          type: 'content_block_stop',
          index: 0,
        })
        blockStopped = true
      }
      if (!messageDeltaSent) {
        emitEvent(controller, 'message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: stopReason ?? 'end_turn',
            stop_sequence: null,
          },
          usage: { output_tokens: completionTokens },
        })
        messageDeltaSent = true
      }
      if (!messageStopped) {
        emitEvent(controller, 'message_stop', { type: 'message_stop' })
        messageStopped = true
      }
      // Anthropic doesn't use [DONE] sentinel — message_stop is the terminator.
    },
  })

  // Suppress lint for unused vars used only as state markers.
  void promptTokens

  return source.pipeThrough(transform)
}

function emitEvent(
  controller: TransformStreamDefaultController<Uint8Array>,
  event: string,
  data: Record<string, unknown>,
): void {
  const lines = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  controller.enqueue(TEXT_ENCODER.encode(lines))
}

function mapFinishReason(reason: string): string {
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
      return 'end_turn'
  }
}
