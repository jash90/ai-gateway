import { Injectable, NotFoundException } from '@nestjs/common'
import type { BillingSubscription, BillingPrice, BillingProduct } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { StripeClientFactory } from './stripe-client.factory'

export type SubscriptionView = BillingSubscription & {
  price: BillingPrice & { product: BillingProduct }
}

/**
 * BillingSubscription has no Prisma relation to BillingPrice (priceId is a
 * plain string referencing BillingPrice.id). We hydrate the price + product
 * in the service via a separate findUnique call. Tradeoff: 1 extra round-trip
 * vs. avoiding a schema migration that adds a foreign key + relation.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeClientFactory,
  ) {}

  /**
   * Returns the most recent active-ish subscription for an account, or null.
   */
  async getActive(accountId: string): Promise<SubscriptionView | null> {
    const sub = await this.prisma.billingSubscription.findFirst({
      where: {
        accountId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      orderBy: { currentPeriodEnd: 'desc' },
    })
    if (!sub) return null
    return this.hydrate(sub)
  }

  async listForAccount(accountId: string): Promise<SubscriptionView[]> {
    const subs = await this.prisma.billingSubscription.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    })
    return Promise.all(subs.map((s) => this.hydrate(s)))
  }

  async listAll(): Promise<SubscriptionView[]> {
    const subs = await this.prisma.billingSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return Promise.all(subs.map((s) => this.hydrate(s)))
  }

  async cancelAtPeriodEnd(accountId: string, subscriptionId: string): Promise<SubscriptionView> {
    const sub = await this.prisma.billingSubscription.findFirst({
      where: { id: subscriptionId, accountId },
    })
    if (!sub) {
      throw new NotFoundException({ message: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' })
    }

    const stripe = await this.stripe.getClient()
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })

    const updated = await this.prisma.billingSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    })
    return this.hydrate(updated)
  }

  // ---------------------------------------------------------------------------
  // End-user variants (B2B2C)
  // ---------------------------------------------------------------------------

  async getActiveForEndUser(endUserId: string): Promise<SubscriptionView | null> {
    const sub = await this.prisma.billingSubscription.findFirst({
      where: {
        endUserId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      orderBy: { currentPeriodEnd: 'desc' },
    })
    if (!sub) return null
    return this.hydrate(sub)
  }

  async cancelAtPeriodEndForEndUser(
    endUserId: string,
    subscriptionId: string,
  ): Promise<SubscriptionView> {
    const sub = await this.prisma.billingSubscription.findFirst({
      where: { id: subscriptionId, endUserId },
    })
    if (!sub) {
      throw new NotFoundException({ message: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' })
    }

    const stripe = await this.stripe.getClient()
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })

    const updated = await this.prisma.billingSubscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    })
    return this.hydrate(updated)
  }

  private async hydrate(sub: BillingSubscription): Promise<SubscriptionView> {
    const price = await this.prisma.billingPrice.findUnique({
      where: { id: sub.priceId },
      include: { product: true },
    })
    if (!price) {
      // Price was deleted out-of-band — fall back to a synthetic record so the
      // caller can still render something.
      return {
        ...sub,
        price: {
          id: sub.priceId,
          productId: '',
          stripePriceId: '',
          currency: 'usd',
          unitAmount: 0,
          interval: null,
          tokensGranted: BigInt(0),
          isActive: false,
          metadata: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          product: {
            id: '',
            stripeProductId: '',
            name: '(deleted product)',
            description: null,
            mode: 'PACKAGE',
            isActive: false,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
        },
      }
    }
    return { ...sub, price }
  }
}
