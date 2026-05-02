import { Injectable, BadRequestException, ForbiddenException, Optional } from '@nestjs/common'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenAIProvider } from './providers/openai.provider'
import { BillingService } from '../billing/billing.service'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { AuditService } from '../audit/audit.service'
import { ProxyResult } from '../../common/types/types'

@Injectable()
export class ProxyService {
  constructor(
    private anthropic: AnthropicProvider,
    private openai: OpenAIProvider,
    private billing: BillingService,
    @Optional() private entitlements: EntitlementsService,
    @Optional() private audit: AuditService,
  ) {}

  async proxy(
    customerId: string,
    provider: string,
    requestBody: unknown,
    isStreaming: boolean,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<ProxyResult> {
    const body = requestBody as Record<string, unknown>
    const model = (body.model as string) ?? ''
    const featureId = (body.featureId as string) ?? 'api-proxy'

    // Check entitlement (if service available)
    if (this.entitlements) {
      const access = await this.entitlements.checkAccess(customerId, featureId)
      if (!access.allowed) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: access.reason,
          suggestion: access.suggestion,
        })
      }
    }

    // Resolve provider
    const resolvedProvider = this.resolveProvider(provider, model)
    if (!resolvedProvider) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_PROVIDER',
        message: `Provider '${provider}' or model '${model}' is not supported`,
      })
    }

    // Proxy request
    const result = await resolvedProvider.proxy(requestBody, '', isStreaming)

    if (result.status >= 400) {
      return result
    }

    // Audit log
    this.audit?.log({
      customerId,
      actorType: 'CUSTOMER',
      actorId: customerId,
      action: 'PROXY_REQUEST',
      resource: 'proxy',
      metadata: { provider: resolvedProvider.name, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    }).catch(() => {})

    // Meter usage (fire-and-forget)
    const metering = {
      customerId,
      provider: resolvedProvider.name,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      userId,
      featureId,
      metadata: { ...metadata, statusCode: result.status },
    }

    this.billing
      .burnCredits(
        metering.customerId,
        metering.provider,
        metering.model,
        metering.inputTokens,
        metering.outputTokens,
        metering.cacheReadTokens,
        metering.cacheCreationTokens,
        metering.userId,
        metering.featureId,
        metering.metadata,
      )
      .catch((err) => {
        console.error('Failed to meter usage:', err.message)
      })

    return result
  }

  private resolveProvider(provider: string, model: string) {
    const lower = provider.toLowerCase()

    if (lower === 'anthropic' || this.anthropic.canHandle(model)) {
      return this.anthropic
    }
    if (lower === 'openai' || this.openai.canHandle(model)) {
      return this.openai
    }

    return null
  }
}
