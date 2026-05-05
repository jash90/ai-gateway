import { Injectable } from '@nestjs/common'
import StripeCtor from 'stripe'
import type { Stripe } from 'stripe/cjs/stripe.core'
import { StripeConfigService } from './stripe-config.service'

type StripeClient = Stripe

const SYSTEM_ACTOR = 'system-stripe-factory'

/**
 * StripeClientFactory — memoized Stripe SDK instance.
 *
 * Cache invalidated by `StripeConfig.updatedAt`. Multi-replica deploy needs
 * Redis pub/sub on config changes (M4 hardening); for M2 single-replica
 * Railway is fine.
 */
@Injectable()
export class StripeClientFactory {
  private cached: { client: StripeClient; updatedAtMs: number } | null = null

  constructor(private stripeConfig: StripeConfigService) {}

  async getClient(): Promise<StripeClient> {
    const { secretKey, config } = await this.stripeConfig.getDecryptedSecrets({
      actorId: SYSTEM_ACTOR,
    })
    const stamp = config.updatedAt.getTime()
    if (this.cached && this.cached.updatedAtMs === stamp) {
      return this.cached.client
    }
    const client = new StripeCtor(secretKey, {
      maxNetworkRetries: 2,
      timeout: 15_000,
      appInfo: { name: 'ai-gateway', version: '0.1.0' },
    })
    this.cached = { client, updatedAtMs: stamp }
    return client
  }

  async getWebhookSecret(): Promise<string> {
    const { webhookSecret } = await this.stripeConfig.getDecryptedSecrets({ actorId: SYSTEM_ACTOR })
    return webhookSecret
  }
}
