/**
 * Transforms an Anthropic /v1/messages SSE stream into an OpenAI
 * /v1/chat/completions SSE stream on-the-fly.
 *
 * Anthropic events (input):
 *   event: message_start         data: { message: { id, model, usage: {input_tokens} } }
 *   event: content_block_start   data: { index: 0, content_block: { type: "text", text: "" } }
 *   event: content_block_delta   data: { index: 0, delta: { type: "text_delta", text: "..." } }
 *   event: content_block_stop    data: { index: 0 }
 *   event: message_delta         data: { delta: { stop_reason: "..." }, usage: { output_tokens } }
 *   event: message_stop          data: {}
 *
 * OpenAI chunks (output):
 *   data: {"id","object":"chat.completion.chunk","created","model","choices":[{"index":0,"delta":{"role":"assistant"}}]}
 *   data: {"...","choices":[{"index":0,"delta":{"content":"Hi"}}]}
 *   data: {"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
 *   data: {"...","choices":[],"usage":{"prompt_tokens":..,"completion_tokens":..,"total_tokens":..}}
 *   data: [DONE]
 *
 * Limitations (Sprint 5):
 *   - Tool calls not translated (Anthropic tool_use blocks → OpenAI tool_calls).
 *   - Image content not translated.
 *   - Translation is text-only, single content block.
 */

const TEXT_DECODER = new TextDecoder()
const TEXT_ENCODER = new TextEncoder()

export function anthropicToOpenAIStream(
  source: ReadableStream<Uint8Array>,
  /** The original model name from the OpenAI client (e.g. "anthropic/claude-..."). */
  clientModel: string,
): ReadableStream<Uint8Array> {
  let buffer = ''
  let chatId = `chatcmpl-${Math.random().toString(36).slice(2, 12)}`
  let modelName = clientModel
  let inputTokens = 0
  let outputTokens = 0
  let createdSec = Math.floor(Date.now() / 1000)
  let roleEmitted = false
  let finishedEmitted = false

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += TEXT_DECODER.decode(chunk, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        try {
          processAnthropicEvent(record, controller, {
            getChatId: () => chatId,
            setChatId: (v) => (chatId = v),
            getModel: () => modelName,
            setModel: (v) => (modelName = v),
            getCreated: () => createdSec,
            setCreated: (v) => (createdSec = v),
            getInputTokens: () => inputTokens,
            setInputTokens: (v) => (inputTokens = v),
            getOutputTokens: () => outputTokens,
            setOutputTokens: (v) => (outputTokens = v),
            isRoleEmitted: () => roleEmitted,
            markRoleEmitted: () => (roleEmitted = true),
            isFinishedEmitted: () => finishedEmitted,
            markFinishedEmitted: () => (finishedEmitted = true),
          })
        } catch {
          // Drop malformed records — never break the downstream.
        }
      }
    },
    flush(controller) {
      // Final [DONE] sentinel is always emitted, even if upstream cut early.
      if (!finishedEmitted) {
        emitOpenAIChunk(controller, {
          id: chatId,
          model: modelName,
          created: createdSec,
          delta: {},
          finish_reason: 'stop',
        })
      }
      controller.enqueue(TEXT_ENCODER.encode('data: [DONE]\n\n'))
    },
  })

  return source.pipeThrough(transform)
}

interface State {
  getChatId(): string
  setChatId(v: string): void
  getModel(): string
  setModel(v: string): void
  getCreated(): number
  setCreated(v: number): void
  getInputTokens(): number
  setInputTokens(v: number): void
  getOutputTokens(): number
  setOutputTokens(v: number): void
  isRoleEmitted(): boolean
  markRoleEmitted(): void
  isFinishedEmitted(): boolean
  markFinishedEmitted(): void
}

function processAnthropicEvent(
  record: string,
  controller: TransformStreamDefaultController<Uint8Array>,
  state: State,
): void {
  let event: string | null = null
  let dataRaw: string | null = null
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataRaw = line.slice('data:'.length).trim()
  }
  if (!event || !dataRaw) return

  const data = JSON.parse(dataRaw) as Record<string, any>

  switch (event) {
    case 'message_start': {
      const msg = data.message ?? {}
      if (msg.id) state.setChatId(`chatcmpl-${msg.id}`)
      if (msg.model) state.setModel(msg.model)
      state.setCreated(Math.floor(Date.now() / 1000))
      const usage = msg.usage ?? {}
      if (typeof usage.input_tokens === 'number') state.setInputTokens(usage.input_tokens)
      // Emit OpenAI-style "role" chunk first.
      if (!state.isRoleEmitted()) {
        emitOpenAIChunk(controller, {
          id: state.getChatId(),
          model: state.getModel(),
          created: state.getCreated(),
          delta: { role: 'assistant', content: '' },
        })
        state.markRoleEmitted()
      }
      break
    }

    case 'content_block_delta': {
      const text = (data.delta?.text ?? '') as string
      if (text) {
        emitOpenAIChunk(controller, {
          id: state.getChatId(),
          model: state.getModel(),
          created: state.getCreated(),
          delta: { content: text },
        })
      }
      break
    }

    case 'message_delta': {
      const stopReason = data.delta?.stop_reason as string | undefined
      const usage = data.usage ?? {}
      if (typeof usage.output_tokens === 'number') state.setOutputTokens(usage.output_tokens)
      if (stopReason) {
        emitOpenAIChunk(controller, {
          id: state.getChatId(),
          model: state.getModel(),
          created: state.getCreated(),
          delta: {},
          finish_reason: mapStopReason(stopReason),
        })
        state.markFinishedEmitted()
      }
      break
    }

    case 'message_stop': {
      // Emit usage chunk (OpenAI's stream_options.include_usage convention).
      const total = state.getInputTokens() + state.getOutputTokens()
      emitOpenAIUsageChunk(controller, {
        id: state.getChatId(),
        model: state.getModel(),
        created: state.getCreated(),
        prompt_tokens: state.getInputTokens(),
        completion_tokens: state.getOutputTokens(),
        total_tokens: total,
      })
      break
    }

    // Other events (ping, content_block_start, content_block_stop, error) are ignored.
    default:
      break
  }
}

function emitOpenAIChunk(
  controller: TransformStreamDefaultController<Uint8Array>,
  args: {
    id: string
    model: string
    created: number
    delta: { role?: string; content?: string }
    finish_reason?: string
  },
): void {
  const chunk = {
    id: args.id,
    object: 'chat.completion.chunk',
    created: args.created,
    model: args.model,
    choices: [
      {
        index: 0,
        delta: args.delta,
        finish_reason: args.finish_reason ?? null,
      },
    ],
  }
  controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`))
}

function emitOpenAIUsageChunk(
  controller: TransformStreamDefaultController<Uint8Array>,
  args: {
    id: string
    model: string
    created: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  },
): void {
  const chunk = {
    id: args.id,
    object: 'chat.completion.chunk',
    created: args.created,
    model: args.model,
    choices: [],
    usage: {
      prompt_tokens: args.prompt_tokens,
      completion_tokens: args.completion_tokens,
      total_tokens: args.total_tokens,
    },
  }
  controller.enqueue(TEXT_ENCODER.encode(`data: ${JSON.stringify(chunk)}\n\n`))
}

function mapStopReason(reason: string): string {
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
      return 'stop'
  }
}
