import {
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import type { Stripe } from 'stripe/cjs/stripe.core'
import { StripeClientFactory } from '../services/stripe-client.factory'
import { StripeConfigService } from '../services/stripe-config.service'
import { WalletService } from '../../wallet/wallet.service'
import { AuditService } from '../../audit/audit.service'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * Stripe webhook receiver.
 *
 * MUST be reachable without JWT (Stripe doesn't authenticate). Verifies the
 * `Stripe-Signature` header against the webhook signing secret stored in
 * StripeConfig.encryptedWebhookSecret.
 *
 * Idempotency: WalletTransaction.stripeEventId @unique guards against
 * duplicate replays Stripe issues on 5xx responses.
 */
@ApiTags('billing')
@Controller('v1/webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name)

  constructor(
    private stripeFactory: StripeClientFactory,
    private stripeConfig: StripeConfigService,
    private wallet: WalletService,
    private audit: AuditService,
    private prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook receiver (no auth)' })
  async receive(@Req() req: FastifyRequest, @Headers('stripe-signature') sig?: string) {
    if (!sig) {
      throw new BadRequestException({
        message: 'Missing Stripe-Signature header',
        code: 'MISSING_STRIPE_SIGNATURE',
      })
    }

    // Need raw body — must be enabled per route in main.ts (fastify-raw-body).
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer | string }).rawBody
    if (!rawBody) {
      throw new BadRequestException({
        message: 'Raw body unavailable on /v1/webhooks/stripe — check fastify-raw-body config',
        code: 'RAW_BODY_UNAVAILABLE',
      })
    }

    const stripe = await this.stripeFactory.getClient()
    const webhookSecret = await this.stripeFactory.getWebhookSecret()

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      this.logger.warn(`Stripe webhook signature failed: ${reason}`)
      throw new BadRequestException({
        message: 'Invalid Stripe webhook signature',
        code: 'INVALID_STRIPE_SIGNATURE',
      })
    }

    try {
      await this.handleEvent(event)
      await this.stripeConfig.recordWebhookReceived(event.type)
      return { received: true, eventType: event.type, eventId: event.id }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      this.logger.error(`Stripe webhook handler error for ${event.type} (${event.id}): ${message}`)
      // Return 500 so Stripe retries — but only after audit log.
      await this.audit.log({
        actorType: 'SYSTEM',
        actorId: 'stripe-webhook',
        action: 'billing.webhook.error',
        metadata: { eventType: event.type, eventId: event.id, error: message },
      })
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // Event dispatch
  // ---------------------------------------------------------------------------

  private async handleEvent(event: Stripe.Event): Promise<void> {
    this.logger.log(`Stripe webhook: ${event.type} (${event.id})`)

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event)
        break
      case 'invoice.paid':
        await this.handleInvoicePaid(event)
        break
      case 'invoice.payment_failed':
        await this.audit.log({
          actorType: 'SYSTEM',
          actorId: 'stripe-webhook',
          action: 'billing.payment_failed',
          metadata: { eventId: event.id },
        })
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.handleSubscriptionLifecycle(event)
        break
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`)
    }
  }

  private async handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode !== 'payment') {
      // Subscriptions go through invoice.paid for token grants.
      return
    }
    const meta = session.metadata ?? {}
    const accountId = meta.accountId
    const tokensGranted = meta.tokensGranted ? BigInt(meta.tokensGranted) : 0n
    if (!accountId || tokensGranted <= 0n) {
      this.logger.warn(`checkout.session.completed missing metadata: ${event.id}`)
      return
    }

    // Resolve scope. Priority: PER_END_USER → PER_APPLICATION → SHARED_ACCOUNT.
    // Validates ownership before crediting (defense against tampered metadata).
    // If validation fails, fall back to a less-specific scope and reflect the
    // demotion in ledger metadata.
    const requestedScope =
      meta.scope === 'PER_END_USER'
        ? 'PER_END_USER'
        : meta.scope === 'PER_APPLICATION'
          ? 'PER_APPLICATION'
          : 'SHARED_ACCOUNT'

    let endUserId: string | null = null
    let applicationId: string | null = null

    if (requestedScope === 'PER_END_USER' && meta.endUserId) {
      const eu = await this.prisma.endUser.findUnique({
        where: { id: meta.endUserId },
        include: { application: { select: { accountId: true } } },
      })
      if (!eu || eu.application.accountId !== accountId) {
        this.logger.warn(
          `checkout.session.completed endUserId=${meta.endUserId} not owned by account=${accountId}; demoting (event ${event.id})`,
        )
      } else {
        endUserId = eu.id
        applicationId = eu.applicationId
      }
    }

    if (!endUserId && requestedScope !== 'SHARED_ACCOUNT' && meta.applicationId) {
      const app = await this.prisma.application.findFirst({
        where: { id: meta.applicationId, accountId },
        select: { id: true },
      })
      if (app) applicationId = app.id
      else
        this.logger.warn(
          `checkout.session.completed applicationId=${meta.applicationId} not owned by account=${accountId}; demoting (event ${event.id})`,
        )
    }

    const effectiveScope: 'PER_END_USER' | 'PER_APPLICATION' | 'SHARED_ACCOUNT' = endUserId
      ? 'PER_END_USER'
      : applicationId
        ? 'PER_APPLICATION'
        : 'SHARED_ACCOUNT'

    await this.wallet.credit(accountId, 'TOPUP', tokensGranted, {
      stripeEventId: event.id,
      endUserId,
      applicationId: endUserId ? null : applicationId,
      metadata: {
        sessionId: session.id,
        priceId: meta.priceId ?? null,
        amountPaid: session.amount_total ?? null,
        requestedScope,
        scope: effectiveScope,
      },
    })
  }

  private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice
    const stripeSubscriptionId =
      typeof (invoice as Stripe.Invoice & { subscription?: string | null }).subscription === 'string'
        ? ((invoice as Stripe.Invoice & { subscription?: string | null }).subscription as string)
        : null
    if (!stripeSubscriptionId) return

    const sub = await this.prisma.billingSubscription.findUnique({
      where: { stripeSubscriptionId },
      include: { account: { select: { id: true } } },
    })
    if (!sub) {
      this.logger.warn(`invoice.paid for unknown subscription ${stripeSubscriptionId}`)
      return
    }

    const price = await this.prisma.billingPrice.findUnique({ where: { id: sub.priceId } })
    if (!price) return

    const rolloverFlag =
      (price.metadata as { tokensRolloverOnRenew?: boolean } | null)?.tokensRolloverOnRenew === true
    const grantType = rolloverFlag ? 'SUBSCRIPTION_GRANT' : 'SUBSCRIPTION_RESET'

    // Subscription scope was stamped on the BillingSubscription at create time.
    // Priority: PER_END_USER → PER_APPLICATION → SHARED_ACCOUNT. If the target
    // (end-user / application) was deleted between subscription creation and
    // renewal, fall back to a less-specific scope so the credit doesn't get stuck.
    const subRow = sub as typeof sub & { endUserId?: string | null }
    const requestedScope =
      subRow.scope === 'PER_END_USER'
        ? 'PER_END_USER'
        : subRow.scope === 'PER_APPLICATION'
          ? 'PER_APPLICATION'
          : 'SHARED_ACCOUNT'

    let endUserId: string | null = null
    let applicationId: string | null = null

    if (requestedScope === 'PER_END_USER' && subRow.endUserId) {
      const eu = await this.prisma.endUser.findUnique({
        where: { id: subRow.endUserId },
        include: { application: { select: { accountId: true } } },
      })
      if (eu && eu.application.accountId === sub.accountId) {
        endUserId = eu.id
        applicationId = eu.applicationId
      } else {
        this.logger.warn(
          `invoice.paid for sub ${sub.id}: end-user ${subRow.endUserId} no longer owned; demoting`,
        )
      }
    }

    if (!endUserId && requestedScope !== 'SHARED_ACCOUNT' && sub.applicationId) {
      const stillOwned = await this.prisma.application.findFirst({
        where: { id: sub.applicationId, accountId: sub.accountId },
        select: { id: true },
      })
      if (stillOwned) applicationId = stillOwned.id
    }

    const effectiveScope: 'PER_END_USER' | 'PER_APPLICATION' | 'SHARED_ACCOUNT' = endUserId
      ? 'PER_END_USER'
      : applicationId
        ? 'PER_APPLICATION'
        : 'SHARED_ACCOUNT'

    await this.wallet.credit(sub.accountId, grantType, price.tokensGranted, {
      stripeEventId: event.id,
      endUserId,
      applicationId: endUserId ? null : applicationId,
      metadata: {
        subscriptionId: sub.id,
        priceId: price.id,
        invoiceId: invoice.id,
        rollover: rolloverFlag,
        requestedScope,
        scope: effectiveScope,
      },
    })
  }

  private async handleSubscriptionLifecycle(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

    // Customer might be on the Account (SHARED_ACCOUNT/PER_APPLICATION) or on
    // an EndUser (PER_END_USER, B2B2C). Try Account first, then EndUser.
    let account = await this.prisma.account.findFirst({ where: { stripeCustomerId: customerId } })
    let endUser:
      | { id: string; applicationId: string; application: { accountId: string } }
      | null = null

    if (!account) {
      const eu = await this.prisma.endUser.findFirst({
        where: { stripeCustomerId: customerId },
        include: { application: { select: { accountId: true } } },
      })
      if (eu) {
        endUser = eu
        account = await this.prisma.account.findUnique({
          where: { id: eu.application.accountId },
        })
      }
    }

    if (!account) {
      this.logger.warn(`Subscription event for unknown customer ${customerId}`)
      return
    }

    const item = sub.items.data[0]
    const stripePriceId = item?.price?.id
    if (!stripePriceId) return
    const price = await this.prisma.billingPrice.findUnique({ where: { stripePriceId } })
    if (!price) {
      this.logger.warn(`Subscription event for unknown price ${stripePriceId}`)
      return
    }

    const status = mapStripeStatus(sub.status)
    const periodStart = pickEpochSeconds(item, 'current_period_start') ?? sub.start_date
    const periodEnd = pickEpochSeconds(item, 'current_period_end') ?? sub.start_date

    // Scope + applicationId / endUserId carried via subscription_data.metadata
    // at checkout creation.
    const subMeta = sub.metadata ?? {}
    const requestedScope =
      subMeta.scope === 'PER_END_USER'
        ? 'PER_END_USER'
        : subMeta.scope === 'PER_APPLICATION'
          ? 'PER_APPLICATION'
          : 'SHARED_ACCOUNT'

    let endUserId: string | null = null
    let applicationId: string | null = null

    if (requestedScope === 'PER_END_USER' && subMeta.endUserId) {
      const eu =
        endUser?.id === subMeta.endUserId
          ? endUser
          : await this.prisma.endUser.findFirst({
              where: { id: subMeta.endUserId, application: { accountId: account.id } },
              include: { application: { select: { accountId: true } } },
            })
      if (eu) {
        endUserId = eu.id
        applicationId = eu.applicationId
      } else {
        this.logger.warn(
          `Subscription ${sub.id} has endUserId=${subMeta.endUserId} not owned by account=${account.id}`,
        )
      }
    }

    if (!endUserId && requestedScope !== 'SHARED_ACCOUNT' && subMeta.applicationId) {
      const app = await this.prisma.application.findFirst({
        where: { id: subMeta.applicationId, accountId: account.id },
        select: { id: true },
      })
      applicationId = app?.id ?? null
    }

    const effectiveScope = endUserId
      ? 'PER_END_USER'
      : applicationId
        ? 'PER_APPLICATION'
        : 'SHARED_ACCOUNT'

    await this.prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      update: {
        status,
        priceId: price.id,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        scope: effectiveScope,
        applicationId,
        endUserId,
      },
      create: {
        accountId: account.id,
        stripeSubscriptionId: sub.id,
        priceId: price.id,
        status,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        scope: effectiveScope,
        applicationId,
        endUserId,
      },
    })
  }
}

function mapStripeStatus(s: Stripe.Subscription.Status): import('@prisma/client').SubscriptionStatus {
  switch (s) {
    case 'active':
      return 'ACTIVE'
    case 'past_due':
      return 'PAST_DUE'
    case 'canceled':
      return 'CANCELED'
    case 'incomplete':
      return 'INCOMPLETE'
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED'
    case 'trialing':
      return 'TRIALING'
    case 'unpaid':
      return 'UNPAID'
    case 'paused':
      return 'PAUSED'
    default:
      return 'ACTIVE'
  }
}

function pickEpochSeconds(
  item: Stripe.SubscriptionItem | undefined,
  key: 'current_period_start' | 'current_period_end',
): number | null {
  // Stripe API moved these from Subscription to SubscriptionItem in newer versions.
  const v = (item as unknown as Record<string, number | undefined>)?.[key]
  return typeof v === 'number' ? v : null
}
