import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import type { Account, Application, ApplicationKey } from '@prisma/client'
import { ApplicationKeyGuard } from '../auth/guards/application-key.guard'
import {
  CurrentApplication,
  CurrentApplicationKey,
} from '../auth/decorators/current-application.decorator'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { GatewayService, type RequestFormat } from './gateway.service'
import { ModelsAggregatorService } from './services/models-aggregator.service'

/**
 * GatewayController — data plane.
 *
 * Two endpoints:
 *   - POST /v1/chat/completions — OpenAI-compatible (drop-in for `openai` SDK)
 *   - POST /v1/messages         — Anthropic-compatible (drop-in for `@anthropic-ai/sdk`)
 *
 * Auth: ApplicationKeyGuard expects `Authorization: Bearer sk-rcn-live-...`.
 * Optional headers:
 *   - `x-rcn-provider`  — override the inferred provider ("OPENAI" | "ANTHROPIC" | "OPENROUTER")
 *   - `x-rcn-end-user`  — opaque end-user ID for usage attribution
 *
 * Streaming: if request body has `stream: true`, we relay the upstream SSE
 * stream byte-for-byte. Sprint 3 inlines a UsageExtractorTransform to parse
 * usage out of the stream without consuming it.
 */
@ApiTags('gateway')
@ApiSecurity('application-key')
@Controller('v1')
@UseGuards(ApplicationKeyGuard)
export class GatewayController {
  constructor(
    private gateway: GatewayService,
    private modelsAggregator: ModelsAggregatorService,
  ) {}

  @Get('models')
  @ApiOperation({
    summary: 'List models available for this account',
    description:
      'Aggregates models from each configured BYOK provider. Vendor-prefixed IDs ' +
      '(`openai/gpt-4o`, `anthropic/claude-sonnet-4-5`) are returned. Cached 5 min per account.',
  })
  @ApiResponse({ status: 200, description: 'List of available models.' })
  async listModels(@CurrentAccount() account: Account) {
    const models = await this.modelsAggregator.listForAccount(account.id)
    // OpenAI-compatible response shape (so SDKs that call /v1/models work).
    return {
      object: 'list',
      data: models.map((m) => ({
        id: m.id,
        object: 'model',
        owned_by: m.ownedBy ?? 'raccoon',
        provider: m.provider,
        display_name: m.displayName ?? null,
      })),
    }
  }

  @Post('chat/completions')
  @ApiOperation({
    summary: 'OpenAI-compatible chat completions',
    description:
      'Drop-in replacement for `openai.chat.completions.create()` — set baseURL to ' +
      '`https://api.raccoon.dev/v1` and your Application key as the API key.',
  })
  @ApiResponse({ status: 200, description: 'Chat completion response (or SSE stream).' })
  @ApiResponse({ status: 401, description: 'Application key missing/invalid.' })
  @ApiResponse({ status: 403, description: 'BYOK key for this provider not configured.' })
  async chatCompletions(
    @Body() body: Record<string, unknown>,
    @Headers('x-rcn-provider') providerOverride: string | undefined,
    @Headers('x-rcn-end-user') endUserId: string | undefined,
    @CurrentAccount() account: Account,
    @CurrentApplication() application: Application,
    @CurrentApplicationKey() applicationKey: ApplicationKey,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.handleProxy({
      body,
      providerOverride,
      endUserId,
      account,
      application,
      applicationKey,
      reply,
      modelField: 'model',
      requestFormat: 'openai',
    })
  }

  @Post('messages')
  @ApiOperation({
    summary: 'Anthropic-compatible messages API',
    description:
      'Drop-in replacement for `@anthropic-ai/sdk` `client.messages.create()` — set ' +
      'baseURL to `https://api.raccoon.dev` (note: anthropic SDK appends /v1/messages).',
  })
  @ApiResponse({ status: 200, description: 'Messages response (or SSE stream).' })
  @ApiResponse({ status: 401, description: 'Application key missing/invalid.' })
  @ApiResponse({ status: 403, description: 'BYOK key for this provider not configured.' })
  async messages(
    @Body() body: Record<string, unknown>,
    @Headers('x-rcn-provider') providerOverride: string | undefined,
    @Headers('x-rcn-end-user') endUserId: string | undefined,
    @CurrentAccount() account: Account,
    @CurrentApplication() application: Application,
    @CurrentApplicationKey() applicationKey: ApplicationKey,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    return this.handleProxy({
      body,
      providerOverride,
      endUserId,
      account,
      application,
      applicationKey,
      reply,
      modelField: 'model',
      requestFormat: 'anthropic',
    })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async handleProxy(args: {
    body: Record<string, unknown>
    providerOverride: string | undefined
    endUserId: string | undefined
    account: Account
    application: Application
    applicationKey: ApplicationKey
    reply: FastifyReply
    modelField: string
    requestFormat: RequestFormat
  }): Promise<unknown> {
    const rawModel = args.body[args.modelField]
    if (typeof rawModel !== 'string' || !rawModel) {
      throw new HttpException(
        { errorCode: 'MODEL_REQUIRED', message: 'Request body must include a `model` string.' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const isStream = args.body.stream === true

    const { response, streamFinalize } = await this.gateway.forward({
      account: args.account,
      application: args.application,
      applicationKey: args.applicationKey,
      endUserExternalId: args.endUserId,
      rawModel,
      providerOverride: args.providerOverride,
      isStream,
      body: args.body,
      requestFormat: args.requestFormat,
    })

    // Error from upstream — surface upstream's status + body shape.
    if (response.statusCode >= 400) {
      args.reply.status(response.statusCode)
      return response.body ?? { errorCode: response.errorCode, statusCode: response.statusCode }
    }

    if (isStream && response.body) {
      // Stream pass-through. Fastify's reply.raw is a Node.js ServerResponse —
      // we pipe upstream's ReadableStream directly to it. Once we write to .raw,
      // Fastify's auto-serialization is bypassed (we control end()).
      //
      // Note: response.body has been transformed by createUsageExtractorStream()
      // in GatewayService — same bytes flow through, plus accumulated usage in
      // a closure that streamFinalize() reads after .end().
      const stream = response.body as ReadableStream<Uint8Array>
      const reader = stream.getReader()
      const raw = args.reply.raw
      raw.writeHead(response.statusCode, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          raw.write(value)
        }
      } finally {
        raw.end()
        // Fire-and-forget the usage record — client already has the response.
        // No errors thrown here would reach the client anyway (.end called).
        if (streamFinalize) {
          // Closure captured the extractor inside GatewayService.forward().
          void streamFinalize().catch(() => undefined)
        }
      }
      args.reply.hijack()
      return undefined
    }

    args.reply.status(response.statusCode)
    return response.body
  }
}
