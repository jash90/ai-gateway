import { Injectable, NotFoundException } from '@nestjs/common'
import type { StripeConfig } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { EncryptionService } from '../../crypto/encryption.service'

const SINGLETON_ID = 'singleton'

export interface StripeConfigPublic {
  isActive: boolean
  hasSecretKey: boolean
  hasWebhookSecret: boolean
  publishableKey: string | null
  mode: 'test' | 'live'
  lastWebhookAt: string | null
  lastWebhookEvent: string | null
  webhookUrl: string
  /** Events the operator must subscribe to in Stripe Dashboard. */
  requiredEvents: string[]
}

const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

/**
 * StripeConfigService — singleton config for the operator's Stripe account.
 *
 * Secret + webhook signing keys are encrypted at rest with the same master
 * key used for BYOK provider keys (EncryptionService). The publishable key
 * is plaintext (it's safe to expose by design).
 */
@Injectable()
export class StripeConfigService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  /** Read-only summary for admin UI — never returns secrets. */
  async getPublic(): Promise<StripeConfigPublic> {
    const cfg = await this.prisma.stripeConfig.findUnique({ where: { id: SINGLETON_ID } })
    return {
      isActive: cfg?.isActive ?? false,
      hasSecretKey: !!cfg?.encryptedSecretKey,
      hasWebhookSecret: !!cfg?.encryptedWebhookSecret,
      publishableKey: cfg?.publishableKey ?? null,
      mode: (cfg?.mode as 'test' | 'live') ?? 'test',
      lastWebhookAt: cfg?.lastWebhookAt?.toISOString() ?? null,
      lastWebhookEvent: cfg?.lastWebhookEvent ?? null,
      webhookUrl: this.buildWebhookUrl(),
      requiredEvents: REQUIRED_EVENTS,
    }
  }

  /** Save/update Stripe keys — encrypts secrets, stores publishable as plaintext. */
  async upsert(
    dto: {
      publishableKey?: string | null
      secretKey?: string | null
      webhookSecret?: string | null
      mode?: 'test' | 'live'
    },
    actor: { actorId: string },
  ): Promise<StripeConfigPublic> {
    const updates: Record<string, unknown> = {}

    if (dto.publishableKey !== undefined) {
      updates.publishableKey = dto.publishableKey || null
    }

    if (dto.secretKey) {
      const enc = await this.encryption.encrypt(dto.secretKey, { accountId: actor.actorId })
      updates.encryptedSecretKey = enc.ciphertext
      updates.encryptionKeyId = enc.encryptionKeyId
    }

    if (dto.webhookSecret) {
      const enc = await this.encryption.encrypt(dto.webhookSecret, { accountId: actor.actorId })
      updates.encryptedWebhookSecret = enc.ciphertext
      updates.encryptionKeyId = enc.encryptionKeyId
    }

    if (dto.mode) {
      updates.mode = dto.mode
    }

    // Auto-activate when both secret + webhook secret are present.
    const existing = await this.prisma.stripeConfig.findUnique({ where: { id: SINGLETON_ID } })
    const hasSecret = !!(updates.encryptedSecretKey ?? existing?.encryptedSecretKey)
    const hasWebhook = !!(updates.encryptedWebhookSecret ?? existing?.encryptedWebhookSecret)
    updates.isActive = hasSecret && hasWebhook

    type Bytes = ReturnType<Uint8Array['slice']>
    await this.prisma.stripeConfig.upsert({
      where: { id: SINGLETON_ID },
      update: updates,
      create: {
        id: SINGLETON_ID,
        publishableKey: (updates.publishableKey as string | null) ?? null,
        encryptedSecretKey: (updates.encryptedSecretKey as Bytes | undefined) ?? null,
        encryptedWebhookSecret: (updates.encryptedWebhookSecret as Bytes | undefined) ?? null,
        encryptionKeyId: (updates.encryptionKeyId as string | undefined) ?? null,
        mode: (updates.mode as string | undefined) ?? 'test',
        isActive: !!updates.isActive,
      },
    })

    return this.getPublic()
  }

  /** Internal — used by StripeClientFactory + webhook controller. */
  async getDecryptedSecrets(actor: { actorId: string }): Promise<{
    secretKey: string
    webhookSecret: string
    config: StripeConfig
  }> {
    const cfg = await this.prisma.stripeConfig.findUnique({ where: { id: SINGLETON_ID } })
    if (!cfg || !cfg.encryptedSecretKey || !cfg.encryptedWebhookSecret || !cfg.encryptionKeyId) {
      throw new NotFoundException({
        message: 'Stripe is not configured. Save secret + webhook keys in /admin/billing/stripe.',
        code: 'STRIPE_NOT_CONFIGURED',
      })
    }
    const [secretKey, webhookSecret] = await Promise.all([
      this.encryption.decrypt(cfg.encryptedSecretKey, cfg.encryptionKeyId, { accountId: actor.actorId }),
      this.encryption.decrypt(cfg.encryptedWebhookSecret, cfg.encryptionKeyId, { accountId: actor.actorId }),
    ])
    return { secretKey, webhookSecret, config: cfg }
  }

  /** Webhook endpoint URL — built from env or current request host. */
  buildWebhookUrl(): string {
    const base =
      process.env.PUBLIC_BACKEND_URL ??
      process.env.RAILWAY_PUBLIC_DOMAIN ??
      'http://localhost:3000'
    const url = base.startsWith('http') ? base : `https://${base}`
    return `${url.replace(/\/$/, '')}/v1/webhooks/stripe`
  }

  async recordWebhookReceived(eventType: string): Promise<void> {
    await this.prisma.stripeConfig.update({
      where: { id: SINGLETON_ID },
      data: { lastWebhookAt: new Date(), lastWebhookEvent: eventType },
    })
  }
}
