import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { StripeClientFactory } from './stripe-client.factory'

/** Wallet target. End-user is the highest-priority B2B2C target. */
export type CheckoutScope = 'SHARED_ACCOUNT' | 'PER_APPLICATION' | 'PER_END_USER'

/** Short, URL-safe, collision-resistant id used for Stripe idempotency keys. */
function shortId(): string {
  return randomBytes(8).toString('hex')
}

@Injectable()
export class CheckoutService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeClientFactory,
  ) {}

  /**
   * Create a Stripe Checkout Session for the given Account + Price.
   *
   * `scope` controls where the granted tokens land after the webhook fires:
   *   - SHARED_ACCOUNT → Account.tokenBalance (default, available to all apps)
   *   - PER_APPLICATION → Application.tokenBalance (requires applicationId)
   *
   * `applicationId` is required when scope=PER_APPLICATION, and the application
   * MUST belong to the account (ownership check). For subscriptions with
   * scope=PER_APPLICATION, the BillingSubscription row is also stamped with
   * applicationId so future invoice.paid events route correctly.
   *
   * Lazily creates a Stripe Customer if the Account doesn't have one yet.
   */
  async createSession(input: {
    accountId: string
    priceId: string
    successUrl: string
    cancelUrl: string
    scope?: CheckoutScope
    applicationId?: string | null
    /** End-user UUID (internal id from EndUser table) — required for scope=PER_END_USER. */
    endUserId?: string | null
  }): Promise<{ url: string; sessionId: string }> {
    const account = await this.prisma.account.findUnique({ where: { id: input.accountId } })
    if (!account) throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })

    const price = await this.prisma.billingPrice.findUnique({
      where: { id: input.priceId },
      include: { product: true },
    })
    if (!price || !price.isActive) {
      throw new NotFoundException({ message: 'Price not found or inactive', code: 'PRICE_NOT_FOUND' })
    }

    const scope: CheckoutScope = input.scope ?? 'SHARED_ACCOUNT'
    let applicationId: string | null = null
    let endUserId: string | null = null
    let endUserStripeCustomerId: string | null = null

    if (scope === 'PER_APPLICATION') {
      if (!input.applicationId) {
        throw new BadRequestException({
          message: 'applicationId is required when scope=PER_APPLICATION',
          code: 'APPLICATION_REQUIRED_FOR_SCOPE',
        })
      }
      const app = await this.prisma.application.findUnique({
        where: { id: input.applicationId },
        select: { id: true, accountId: true, isActive: true },
      })
      if (!app || app.accountId !== input.accountId) {
        throw new NotFoundException({
          message: 'Application not found',
          code: 'APPLICATION_NOT_FOUND',
        })
      }
      if (!app.isActive) {
        throw new BadRequestException({
          message: 'Application is inactive',
          code: 'APPLICATION_INACTIVE',
        })
      }
      applicationId = app.id
    } else if (scope === 'PER_END_USER') {
      if (!input.endUserId) {
        throw new BadRequestException({
          message: 'endUserId is required when scope=PER_END_USER',
          code: 'END_USER_REQUIRED_FOR_SCOPE',
        })
      }
      const eu = await this.prisma.endUser.findUnique({
        where: { id: input.endUserId },
        include: { application: { select: { accountId: true, isActive: true } } },
      })
      if (!eu || eu.application.accountId !== input.accountId) {
        throw new NotFoundException({ message: 'End user not found', code: 'END_USER_NOT_FOUND' })
      }
      if (!eu.application.isActive) {
        throw new BadRequestException({
          message: 'Parent application is inactive',
          code: 'APPLICATION_INACTIVE',
        })
      }
      endUserId = eu.id
      applicationId = eu.applicationId
      endUserStripeCustomerId = eu.stripeCustomerId
    }

    const stripe = await this.stripe.getClient()

    // Pick / lazy-create Stripe Customer. End-user gets their own Customer
    // (separate receipts, separate tax records); for SHARED_ACCOUNT and
    // PER_APPLICATION we use the Account's Customer.
    let customerId: string
    if (scope === 'PER_END_USER') {
      if (endUserStripeCustomerId) {
        customerId = endUserStripeCustomerId
      } else {
        const customer = await stripe.customers.create(
          {
            // We deliberately do NOT use the account email for end-user
            // checkout — Stripe Checkout will collect end-user email from the
            // payer themselves. Pass description so the dashboard shows context.
            description: `End-user ${endUserId} of account ${account.id}`,
            metadata: {
              accountId: account.id,
              endUserId: endUserId ?? '',
              applicationId: applicationId ?? '',
            },
          },
          { idempotencyKey: `customer-enduser-${endUserId}` },
        )
        customerId = customer.id
        await this.prisma.endUser.update({
          where: { id: endUserId! },
          data: { stripeCustomerId: customerId },
        })
      }
    } else {
      if (account.stripeCustomerId) {
        customerId = account.stripeCustomerId
      } else {
        const customer = await stripe.customers.create(
          {
            email: account.email,
            name: account.name ?? undefined,
            metadata: { accountId: account.id },
          },
          { idempotencyKey: `customer-${account.id}` },
        )
        customerId = customer.id
        await this.prisma.account.update({
          where: { id: account.id },
          data: { stripeCustomerId: customerId },
        })
      }
    }

    const isSubscription = !!price.interval
    if (isSubscription && price.product.mode !== 'SUBSCRIPTION') {
      throw new BadRequestException({
        message: 'Price has interval but product is not a SUBSCRIPTION',
        code: 'PRICE_MODE_MISMATCH',
      })
    }

    // Stripe metadata values must be strings — we read them in the webhook.
    const metadata: Record<string, string> = {
      accountId: account.id,
      priceId: price.id,
      tokensGranted: price.tokensGranted.toString(),
      mode: price.product.mode,
      scope,
    }
    if (applicationId) metadata.applicationId = applicationId
    if (endUserId) metadata.endUserId = endUserId

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: isSubscription ? 'subscription' : 'payment',
        line_items: [{ price: price.stripePriceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata,
        // For subscriptions, propagate metadata onto the Subscription itself so
        // future invoice.paid webhooks (which don't carry session metadata) can
        // route the credit to the right wallet.
        ...(isSubscription
          ? { subscription_data: { metadata } }
          : {}),
      },
      {
        idempotencyKey: `checkout-${account.id}-${endUserId ?? applicationId ?? 'shared'}-${price.id}-${shortId()}`,
      },
    )

    return { url: session.url ?? '', sessionId: session.id }
  }
}
