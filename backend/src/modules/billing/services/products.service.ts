import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type BillingProduct, type BillingPrice, type BillingMode } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { StripeClientFactory } from './stripe-client.factory'

interface CreateProductInput {
  name: string
  description?: string | null
  mode: BillingMode
}

interface CreatePriceInput {
  productId: string
  unitAmount: number // cents
  currency?: string // default 'usd'
  interval?: 'month' | 'year' | null
  tokensGranted: bigint
  metadata?: Record<string, unknown>
}

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private stripe: StripeClientFactory,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async listProducts(): Promise<(BillingProduct & { prices: BillingPrice[] })[]> {
    return this.prisma.billingProduct.findMany({
      include: { prices: { orderBy: { unitAmount: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  /** Public — used by /v1/billing/checkout and account UI. Active prices only. */
  async listActiveForAccount(): Promise<(BillingProduct & { prices: BillingPrice[] })[]> {
    return this.prisma.billingProduct.findMany({
      where: { isActive: true },
      include: { prices: { where: { isActive: true }, orderBy: { unitAmount: 'asc' } } },
      orderBy: { mode: 'asc' },
    })
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async createProduct(input: CreateProductInput): Promise<BillingProduct> {
    const stripe = await this.stripe.getClient()
    const stripeProduct = await stripe.products.create({
      name: input.name,
      description: input.description ?? undefined,
      metadata: { mode: input.mode },
    })
    return this.prisma.billingProduct.create({
      data: {
        stripeProductId: stripeProduct.id,
        name: input.name,
        description: input.description ?? null,
        mode: input.mode,
      },
    })
  }

  async updateProduct(
    id: string,
    input: { name?: string; description?: string | null; isActive?: boolean },
  ): Promise<BillingProduct> {
    const product = await this.prisma.billingProduct.findUnique({ where: { id } })
    if (!product) throw new NotFoundException({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' })

    const stripe = await this.stripe.getClient()
    if (input.name !== undefined || input.description !== undefined || input.isActive !== undefined) {
      await stripe.products.update(product.stripeProductId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? '' } : {}),
        ...(input.isActive !== undefined ? { active: input.isActive } : {}),
      })
    }

    return this.prisma.billingProduct.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
  }

  async createPrice(input: CreatePriceInput): Promise<BillingPrice> {
    const product = await this.prisma.billingProduct.findUnique({ where: { id: input.productId } })
    if (!product) throw new NotFoundException({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' })

    const stripe = await this.stripe.getClient()
    const stripePrice = await stripe.prices.create({
      product: product.stripeProductId,
      unit_amount: input.unitAmount,
      currency: input.currency ?? 'usd',
      ...(input.interval ? { recurring: { interval: input.interval } } : {}),
      metadata: {
        tokensGranted: input.tokensGranted.toString(),
        ...(input.metadata as Record<string, string> | undefined),
      },
    })

    return this.prisma.billingPrice.create({
      data: {
        productId: input.productId,
        stripePriceId: stripePrice.id,
        currency: input.currency ?? 'usd',
        unitAmount: input.unitAmount,
        interval: input.interval ?? null,
        tokensGranted: input.tokensGranted,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    })
  }

  async deactivatePrice(id: string): Promise<BillingPrice> {
    const price = await this.prisma.billingPrice.findUnique({ where: { id } })
    if (!price) throw new NotFoundException({ message: 'Price not found', code: 'PRICE_NOT_FOUND' })

    const stripe = await this.stripe.getClient()
    await stripe.prices.update(price.stripePriceId, { active: false })

    return this.prisma.billingPrice.update({
      where: { id },
      data: { isActive: false },
    })
  }
}
