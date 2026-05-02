import { Injectable, BadRequestException } from '@nestjs/common'
import type { ProviderType, Account, Application, ApplicationKey } from '@prisma/client'
import { ProviderRouterService } from './services/provider-router.service'
import { ByokKeyResolverService } from './services/byok-key-resolver.service'
import { UsageRecorderService } from './services/usage-recorder.service'
import { EndUserResolverService } from './services/end-user-resolver.service'
import { OpenAIProvider } from './providers/openai.provider'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenRouterProvider } from './providers/openrouter.provider'
import { WebhooksService } from '../webhooks/webhooks.service'
import type { BaseProvider, ProviderResponse } from './providers/base-provider'
import {
  openaiToAnthropicRequest,
  anthropicToOpenaiResponse,
} from './translation/openai-to-anthropic'
import {
  anthropicToOpenaiRequest,
  openaiToAnthropicResponse,
} from './translation/anthropic-to-openai'
import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  AnthropicRequest,
  AnthropicResponse,
} from './translation/types'
import {
  createUsageExtractorStream,
  forceIncludeUsage,
} from './streaming/usage-extractor'
import { anthropicToOpenAIStream } from './streaming/anthropic-to-openai-stream'
import { openaiToAnthropicStream } from './streaming/openai-to-anthropic-stream'

/** Which API shape the client used to invoke the gateway. */
export type RequestFormat = 'openai' | 'anthropic'

export interface ForwardResult {
  response: ProviderResponse
  provider: ProviderType
  routedModel: string
  /**
   * Set for streaming success responses. Caller MUST invoke after the SSE
   * stream finishes (or aborts) to record the UsageEvent with extracted
   * tokens + actual TTFT + total latency. The extractor is captured in the
   * closure — callers don't need to thread it through.
   */
  streamFinalize?: () => Promise<void>
}

interface GatewayContext {
  account: Account
  application: Application
  applicationKey: ApplicationKey
  /** Value of `x-rcn-end-user` header, if any. */
  endUserExternalId?: string
  /** Whatever `model` field came in the request body. */
  rawModel: string
  /** Override from `x-rcn-provider` header. */
  providerOverride?: string
  /** Whether the request body has `stream: true`. */
  isStream: boolean
  /** The original request body (forwarded to upstream after model rewrite). */
  body: Record<string, unknown>
  /** Which endpoint the client called — drives request/response translation. */
  requestFormat: RequestFormat
}

/**
 * GatewayService — the heart of the data plane.
 *
 * Flow:
 *   1. Route the request to a ProviderType based on model name + headers.
 *   2. Resolve the BYOK key (with Redis cache) for that provider.
 *   3. Forward to the provider with the model name (prefix stripped).
 *   4. Record a UsageEvent with statusCode, tokens, latency.
 *   5. Return the upstream response (JSON for non-stream, ReadableStream for stream).
 *
 * Note: error responses ALSO get recorded as UsageEvents (statusCode >= 400,
 * errorCode set). This is critical for the "error rate" alert in Phase 4.
 */
@Injectable()
export class GatewayService {
  constructor(
    private router: ProviderRouterService,
    private byokResolver: ByokKeyResolverService,
    private usageRecorder: UsageRecorderService,
    private endUserResolver: EndUserResolverService,
    private openai: OpenAIProvider,
    private anthropic: AnthropicProvider,
    private openrouter: OpenRouterProvider,
    private webhooks: WebhooksService,
  ) {}

  async forward(ctx: GatewayContext): Promise<ForwardResult> {
    const reqT0 = Date.now()
    const { provider, model: routedModel } = this.router.route(ctx.rawModel, ctx.providerOverride)

    // Detect cross-provider mismatch. If client called /v1/chat/completions
    // (OpenAI shape) but model routed to ANTHROPIC, we must translate the
    // request → Anthropic shape, send, then translate the response back.
    // OpenRouter accepts OpenAI shape natively, so it doesn't need translation.
    const upstreamFormat: RequestFormat = provider === 'ANTHROPIC' ? 'anthropic' : 'openai'
    const needsTranslation = ctx.requestFormat !== upstreamFormat

    // Cross-provider streaming: the upstream stream gets transformed inline
    // (Anthropic SSE ↔ OpenAI SSE). We still wrap with UsageExtractor on the
    // original upstream chunks before transformation — it parses the native
    // shape and works regardless of what the client sees downstream.

    // Build upstream request body with model name swapped + format translated.
    let upstreamBody = needsTranslation
      ? this.translateRequest(ctx.body, ctx.requestFormat, upstreamFormat, routedModel)
      : { ...ctx.body, model: routedModel }

    // For streaming OpenAI/OpenRouter: force `stream_options.include_usage`
    // so the SSE stream's last chunk includes prompt/completion token counts.
    if (ctx.isStream) {
      upstreamBody = forceIncludeUsage(provider, upstreamBody)
    }

    // Resolve BYOK key. Throws ForbiddenException if not configured.
    const apiKey = await this.byokResolver.resolve(ctx.account.id, provider, {
      model: routedModel,
    })

    // Resolve EndUser (best-effort, may be null).
    const endUserId = await this.endUserResolver.resolve(
      ctx.application.id,
      ctx.endUserExternalId,
    )

    // Pick provider implementation.
    const impl = this.pickProvider(provider)

    // Forward.
    const rawResponse = await impl.proxy({
      apiKey,
      isStream: ctx.isStream,
      body: upstreamBody,
    })

    let response: ProviderResponse = rawResponse
    let streamFinalize: ForwardResult['streamFinalize']

    if (
      ctx.isStream &&
      rawResponse.statusCode < 400 &&
      rawResponse.body instanceof ReadableStream
    ) {
      // Wrap the stream with UsageExtractor first — it parses the native upstream
      // shape, so it must run BEFORE format translation (otherwise we'd parse
      // the translated shape with the wrong parser).
      const { stream: extractedStream, result: extractor } = createUsageExtractorStream(
        rawResponse.body,
        provider,
      )
      // Now translate the SSE shape if client and provider mismatch.
      let outStream: ReadableStream<Uint8Array> = extractedStream
      if (needsTranslation) {
        if (upstreamFormat === 'anthropic' && ctx.requestFormat === 'openai') {
          outStream = anthropicToOpenAIStream(extractedStream, ctx.rawModel)
        } else if (upstreamFormat === 'openai' && ctx.requestFormat === 'anthropic') {
          outStream = openaiToAnthropicStream(extractedStream, ctx.rawModel)
        }
      }
      response = { ...rawResponse, body: outStream }
      streamFinalize = async () => {
        const finalUsage = extractor.getUsage()
        const firstChunkAt = extractor.getFirstChunkAt()
        const finishReason = extractor.getFinishReason()
        await this.usageRecorder.record({
          accountId: ctx.account.id,
          applicationId: ctx.application.id,
          applicationKeyId: ctx.applicationKey.id,
          endUserId,
          provider,
          model: routedModel,
          isStream: true,
          statusCode: rawResponse.statusCode,
          errorCode: null,
          finishReason,
          requestId: rawResponse.requestId,
          ttftMs: firstChunkAt !== null ? firstChunkAt - reqT0 : null,
          latencyMs: Date.now() - reqT0,
          usage: finalUsage,
        })
        // Webhook dispatch on stream completion. Errors are best-effort.
        void this.webhooks.dispatch({
          accountId: ctx.account.id,
          event: 'usage.recorded',
          payload: {
            applicationId: ctx.application.id,
            provider,
            model: routedModel,
            isStream: true,
            inputTokens: finalUsage?.inputTokens ?? 0,
            outputTokens: finalUsage?.outputTokens ?? 0,
            latencyMs: Date.now() - reqT0,
            requestId: rawResponse.requestId,
          },
        })
      }

    } else if (needsTranslation && rawResponse.statusCode < 400) {
      response = {
        ...rawResponse,
        body: this.translateResponse(
          rawResponse.body,
          upstreamFormat,
          ctx.requestFormat,
          ctx.rawModel,
        ),
      }
    }

    // Record now if not a streaming success (those defer to streamFinalize).
    if (!streamFinalize) {
      await this.usageRecorder.record({
        accountId: ctx.account.id,
        applicationId: ctx.application.id,
        applicationKeyId: ctx.applicationKey.id,
        endUserId,
        provider,
        model: routedModel,
        isStream: ctx.isStream,
        statusCode: response.statusCode,
        errorCode: response.errorCode,
        finishReason: response.finishReason,
        requestId: response.requestId,
        ttftMs: response.ttftMs,
        latencyMs: response.latencyMs,
        usage: response.usage,
      })

      // Webhook dispatch — split success/error events.
      if (response.statusCode >= 400) {
        void this.webhooks.dispatch({
          accountId: ctx.account.id,
          event: 'request.error',
          payload: {
            applicationId: ctx.application.id,
            provider,
            model: routedModel,
            statusCode: response.statusCode,
            errorCode: response.errorCode,
            requestId: response.requestId,
            latencyMs: response.latencyMs,
          },
        })
      } else {
        void this.webhooks.dispatch({
          accountId: ctx.account.id,
          event: 'usage.recorded',
          payload: {
            applicationId: ctx.application.id,
            provider,
            model: routedModel,
            isStream: ctx.isStream,
            inputTokens: response.usage?.inputTokens ?? 0,
            outputTokens: response.usage?.outputTokens ?? 0,
            latencyMs: response.latencyMs,
            requestId: response.requestId,
          },
        })
      }
    }

    return { response, provider, routedModel, streamFinalize }
  }

  // ---------------------------------------------------------------------------
  // Translation helpers
  // ---------------------------------------------------------------------------

  private translateRequest(
    body: Record<string, unknown>,
    from: RequestFormat,
    to: RequestFormat,
    routedModel: string,
  ): Record<string, unknown> {
    const withModel = { ...body, model: routedModel }
    if (from === 'openai' && to === 'anthropic') {
      return openaiToAnthropicRequest(withModel as OpenAIChatRequest) as unknown as Record<string, unknown>
    }
    if (from === 'anthropic' && to === 'openai') {
      return anthropicToOpenaiRequest(withModel as AnthropicRequest) as unknown as Record<string, unknown>
    }
    return withModel
  }

  private translateResponse(
    body: unknown,
    from: RequestFormat,
    to: RequestFormat,
    /** Original (vendor-prefixed) model name from the client request. */
    clientModel: string,
  ): unknown {
    if (from === 'anthropic' && to === 'openai') {
      return anthropicToOpenaiResponse(body as AnthropicResponse, clientModel)
    }
    if (from === 'openai' && to === 'anthropic') {
      return openaiToAnthropicResponse(body as OpenAIChatResponse, clientModel)
    }
    return body
  }

  private pickProvider(provider: ProviderType): BaseProvider {
    switch (provider) {
      case 'OPENAI':
        return this.openai
      case 'ANTHROPIC':
        return this.anthropic
      case 'OPENROUTER':
        return this.openrouter
      default: {
        const exhaustive: never = provider
        void exhaustive
        throw new BadRequestException({
          errorCode: 'INVALID_PROVIDER',
          message: `Unsupported provider: ${provider}`,
        })
      }
    }
  }
}
