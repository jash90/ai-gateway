import { Injectable, BadRequestException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type { ProviderType, Account, Application, ApplicationKey } from '@prisma/client'
import { ProviderRouterService } from './services/provider-router.service'
import { ByokKeyResolverService } from './services/byok-key-resolver.service'
import { UsageRecorderService } from './services/usage-recorder.service'
import { EndUserResolverService } from './services/end-user-resolver.service'
import { TokenEstimatorService } from './services/token-estimator.service'
import { ProviderErrorMapper } from './services/provider-error-mapper.service'
import { OpenAIProvider } from './providers/openai.provider'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenRouterProvider } from './providers/openrouter.provider'
import { WebhooksService } from '../webhooks/webhooks.service'
import { WalletService, PaymentRequiredException } from '../wallet/wallet.service'
import { FeatureFlagsService } from '../feature-flags/feature-flags.service'
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
    private tokenEstimator: TokenEstimatorService,
    private providerErrorMapper: ProviderErrorMapper,
    private wallet: WalletService,
    private featureFlags: FeatureFlagsService,
    private openai: OpenAIProvider,
    private anthropic: AnthropicProvider,
    private openrouter: OpenRouterProvider,
    private webhooks: WebhooksService,
  ) {}

  async forward(ctx: GatewayContext): Promise<ForwardResult> {
    const reqT0 = Date.now()
    const { provider, model: routedModel } = this.router.route(ctx.rawModel, ctx.providerOverride)

    // M3: stable wallet/usage id (used for hold/settle ledger correlation).
    const requestId = `req_${randomBytes(12).toString('hex')}`
    const billingEnforced = await this.featureFlags.isEnabled(
      'billing.enforced',
      ctx.account.id,
    )

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

    // Resolve EndUser (best-effort, may be null). We need this BEFORE the
    // billing pre-check so we can route the hold to the end-user's wallet
    // when the request carries x-rcn-end-user.
    const endUserId = await this.endUserResolver.resolve(
      ctx.application.id,
      ctx.endUserExternalId,
    )

    // Pick provider implementation.
    const impl = this.pickProvider(provider)

    // ─────────── M3: Billing pre-check (token wallet hold) ───────────
    // Hold AFTER BYOK resolution so we don't lock tokens for requests that
    // never reach the provider (missing key, routing failure).
    //
    // Wallet selection:
    //   * x-rcn-end-user present + EndUser resolved → end-user wallet (B2B2C).
    //     STRICT: no fallback to app/account. End-user pays for themselves.
    //   * otherwise → application wallet first, then shared account fallback.
    if (billingEnforced) {
      const estimate = this.tokenEstimator.estimate(provider, ctx.body)
      if (endUserId) {
        await this.wallet.holdForEndUser(
          ctx.account.id,
          ctx.application.id,
          endUserId,
          requestId,
          BigInt(estimate.totalTokens),
          {
            provider,
            model: routedModel,
            inputTokens: estimate.inputTokens,
            maxOutputTokens: estimate.maxOutputTokens,
          },
        )
      } else {
        await this.wallet.holdForApplication(
          ctx.account.id,
          ctx.application.id,
          requestId,
          BigInt(estimate.totalTokens),
          {
            provider,
            model: routedModel,
            inputTokens: estimate.inputTokens,
            maxOutputTokens: estimate.maxOutputTokens,
          },
        )
      }
    }
    // ─────────── /M3 ───────────

    // Forward.
    let rawResponse: ProviderResponse
    try {
      rawResponse = await impl.proxy({
        apiKey,
        isStream: ctx.isStream,
        body: upstreamBody,
      })
    } catch (err) {
      // If provider call itself throws (network error, timeout) — refund the
      // hold from whichever wallet held the tokens.
      if (billingEnforced) {
        const refundMeta = {
          provider,
          model: routedModel,
          error: err instanceof Error ? err.message : 'unknown',
        }
        if (endUserId) {
          await this.wallet.refundForEndUser(requestId, 'PROVIDER_CALL_FAILED', refundMeta)
        } else {
          await this.wallet.refundForApplication(requestId, 'PROVIDER_CALL_FAILED', refundMeta)
        }
      }
      throw err
    }

    // ─────────── M3: Provider out-of-funds detection ───────────
    // If upstream signals "no credits at provider" — refund the hold and
    // surface a 402 with errorCode=PROVIDER_INSUFFICIENT_FUNDS.
    if (billingEnforced && rawResponse.statusCode >= 400) {
      const upstreamFundsErr = this.providerErrorMapper.mapInsufficientFunds(
        provider,
        rawResponse.statusCode,
        // body may be ReadableStream for streaming requests; only inspect JSON.
        typeof rawResponse.body === 'object' && !(rawResponse.body instanceof ReadableStream)
          ? rawResponse.body
          : null,
      )
      if (upstreamFundsErr) {
        const refundMeta = { provider, model: routedModel }
        if (endUserId) {
          await this.wallet.refundForEndUser(requestId, 'PROVIDER_INSUFFICIENT_FUNDS', refundMeta)
        } else {
          await this.wallet.refundForApplication(requestId, 'PROVIDER_INSUFFICIENT_FUNDS', refundMeta)
        }
        throw new PaymentRequiredException({
          message: 'Provider rejected the call due to insufficient credits at the upstream.',
          code: 'PROVIDER_INSUFFICIENT_FUNDS',
        })
      }
    }
    // ─────────── /M3 ───────────

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
          metadata: billingEnforced ? { walletRequestId: requestId } : undefined,
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
        metadata: billingEnforced ? { walletRequestId: requestId } : undefined,
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
