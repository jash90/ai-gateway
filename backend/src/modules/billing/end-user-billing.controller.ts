import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account, Application } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ClientAuthGuard } from '../auth/guards/client-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { ProductsService } from './services/products.service'
import { CheckoutService } from './services/checkout.service'
import {
  SubscriptionsService,
  type SubscriptionView,
} from './services/subscriptions.service'
import { StripeConfigService } from './services/stripe-config.service'
import {
  EndUserCheckoutRequestDto,
  EndUserCheckoutResponseDto,
  EndUserListResponseDto,
  EndUserListTxQueryDto,
  EndUserMeDto,
  EndUserSubscriptionResponseDto,
  EndUserTransactionListDto,
  EndUserWalletDto,
  ListEndUsersQueryDto,
} from './dto/end-user-billing.dto'

/**
 * EndUserBillingController — B2B2C surface for the integrator's app.
 *
 * Auth: ClientAuthGuard accepts both JWT and application key.
 *   * Application key (sk-rcn-live-…) — application context implicit, used in
 *     server-side integration code that holds the key.
 *   * JWT — panel UI; the integrator's panel uses JWT; queries must include
 *     `?applicationId=<uuid>` to pick which application's end-users to operate
 *     on. Without it, endpoints return 400 APPLICATION_REQUIRED.
 *
 * Path identifies an end-user via the integrator's externalId (whatever
 * opaque id the integrator's app uses internally — UUID, email, slug etc.).
 * Backend resolves externalId → EndUser.id and verifies ownership before
 * acting.
 */
@ApiTags('end-user-billing')
@ApiBearerAuth('bearer')
@Controller('v1/end-users')
@UseGuards(ClientAuthGuard)
export class EndUserBillingController {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private checkout: CheckoutService,
    private subscriptions: SubscriptionsService,
    private stripeConfig: StripeConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // List end-users for the calling application
  // ---------------------------------------------------------------------------

  @Get()
  @ZodResponse({
    status: 200,
    description: 'End-users belonging to the calling application + usage summary.',
    type: EndUserListResponseDto,
  })
  @ApiOperation({ summary: 'List end-users with token balance + usage summary' })
  async list(
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query() query: ListEndUsersQueryDto,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, query.applicationId)

    const where = {
      applicationId,
      ...(query.search ? { externalId: { contains: query.search, mode: 'insensitive' as const } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.endUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.endUser.count({ where }),
    ])

    // Aggregate usage in a single SQL pass per end-user batch
    const ids = rows.map((r) => r.id)
    const usage = ids.length
      ? await this.prisma.usageEvent.groupBy({
          by: ['endUserId'],
          where: { endUserId: { in: ids } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
          _max: { createdAt: true },
        })
      : []
    const usageByEu = new Map(
      usage.map((u) => [
        u.endUserId,
        {
          totalRequests: u._count._all,
          totalInputTokens: u._sum.inputTokens ?? 0,
          totalOutputTokens: u._sum.outputTokens ?? 0,
          lastSeenAt: u._max.createdAt,
        },
      ]),
    )

    const subs = ids.length
      ? await this.prisma.billingSubscription.findMany({
          where: { endUserId: { in: ids }, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          select: { endUserId: true },
        })
      : []
    const activeByEu = new Set(subs.map((s) => s.endUserId).filter(Boolean) as string[])

    return {
      endUsers: rows.map((eu) => {
        const u = usageByEu.get(eu.id)
        return {
          id: eu.id,
          externalId: eu.externalId,
          applicationId: eu.applicationId,
          tokenBalance: eu.tokenBalance.toString(),
          hasStripeCustomer: !!eu.stripeCustomerId,
          hasActiveSubscription: activeByEu.has(eu.id),
          totalRequests: u?.totalRequests ?? 0,
          totalInputTokens: u?.totalInputTokens ?? 0,
          totalOutputTokens: u?.totalOutputTokens ?? 0,
          lastSeenAt: u?.lastSeenAt?.toISOString() ?? null,
          createdAt: eu.createdAt.toISOString(),
          metadata: eu.metadata,
        }
      }),
      total,
    }
  }

  // ---------------------------------------------------------------------------
  // Per-end-user resources (path identifies end-user by externalId)
  // ---------------------------------------------------------------------------

  @Get(':externalId/wallet')
  @ZodResponse({
    status: 200,
    description: 'Token balance for a specific end-user.',
    type: EndUserWalletDto,
  })
  @ApiOperation({ summary: 'Get end-user token balance' })
  async getWallet(
    @Param('externalId') externalId: string,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query('applicationId') applicationIdQuery?: string,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, applicationIdQuery)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)
    return {
      externalId: eu.externalId,
      endUserId: eu.id,
      applicationId: eu.applicationId,
      tokenBalance: eu.tokenBalance.toString(),
      refundOnError: account.refundOnError,
    }
  }

  @Get(':externalId/me')
  @ZodResponse({
    status: 200,
    description: 'One-shot summary for the end-user billing screen.',
    type: EndUserMeDto,
  })
  @ApiOperation({
    summary: 'Unified summary: balance + active subscription + product catalog for an end-user',
  })
  async getMe(
    @Param('externalId') externalId: string,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query('applicationId') applicationIdQuery?: string,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, applicationIdQuery)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)

    const [sub, productsList, config] = await Promise.all([
      this.subscriptions.getActiveForEndUser(eu.id),
      this.products.listActiveForAccount(),
      this.stripeConfig.getPublic(),
    ])

    return {
      externalId: eu.externalId,
      endUserId: eu.id,
      applicationId: eu.applicationId,
      balance: {
        tokens: eu.tokenBalance.toString(),
        refundOnError: account.refundOnError,
      },
      subscription: sub ? serializeSubscription(sub) : null,
      ready: config.isActive,
      catalog: productsList.map(serializeProduct),
    }
  }

  @Get(':externalId/transactions')
  @ZodResponse({
    status: 200,
    description: 'Wallet ledger filtered to a specific end-user.',
    type: EndUserTransactionListDto,
  })
  @ApiOperation({ summary: 'List end-user wallet transactions' })
  async listTransactions(
    @Param('externalId') externalId: string,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query() query: EndUserListTxQueryDto,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, query.applicationId)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)

    const where = {
      accountId: account.id,
      endUserId: eu.id,
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      ...(query.type ? { type: query.type } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ])
    return {
      transactions: rows.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        balanceAfter: tx.balanceAfter.toString(),
        requestId: tx.requestId,
        metadata: tx.metadata,
        createdAt: tx.createdAt.toISOString(),
      })),
      total,
    }
  }

  @Get(':externalId/subscription')
  @ZodResponse({
    status: 200,
    description: 'Active subscription for the end-user, or null.',
    type: EndUserSubscriptionResponseDto,
  })
  @ApiOperation({ summary: 'Get active end-user subscription' })
  async getSubscription(
    @Param('externalId') externalId: string,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query('applicationId') applicationIdQuery?: string,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, applicationIdQuery)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)
    const sub = await this.subscriptions.getActiveForEndUser(eu.id)
    return { subscription: sub ? serializeSubscription(sub) : null }
  }

  @Post(':externalId/subscription/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: 200,
    description: 'Subscription set to cancel at period end.',
    type: EndUserSubscriptionResponseDto,
  })
  @ApiOperation({ summary: 'Cancel end-user subscription at period end' })
  async cancelSubscription(
    @Param('externalId') externalId: string,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
    @Query('applicationId') applicationIdQuery?: string,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, applicationIdQuery)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)
    const updated = await this.subscriptions.cancelAtPeriodEndForEndUser(eu.id, id)
    return { subscription: serializeSubscription(updated) }
  }

  @Post(':externalId/checkout')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: 200,
    description: 'Stripe Checkout session URL — redirect the end-user there.',
    type: EndUserCheckoutResponseDto,
  })
  @ApiOperation({
    summary: 'Create a Stripe Checkout session for an end-user (scope=PER_END_USER)',
    description:
      'Tokens granted by this checkout land in the end-user wallet. Customer is ' +
      'lazy-created on first checkout (one Stripe Customer per end-user, separate ' +
      'from the operator account customer).',
  })
  async createCheckout(
    @Param('externalId') externalId: string,
    @Body() dto: EndUserCheckoutRequestDto,
    @Req() req: FastifyRequest,
    @CurrentAccount() account: Account,
  ) {
    const applicationId = await this.resolveApplicationId(req, account, dto.applicationId)
    const eu = await this.findEndUserOrThrow(externalId, applicationId)

    const baseUrl = process.env.PUBLIC_DASHBOARD_URL ?? 'http://localhost:5173'
    return this.checkout.createSession({
      accountId: account.id,
      priceId: dto.priceId,
      scope: 'PER_END_USER',
      endUserId: eu.id,
      applicationId,
      successUrl: dto.successUrl ?? `${baseUrl}/settings/billing?status=ok`,
      cancelUrl: dto.cancelUrl ?? `${baseUrl}/settings/billing?status=canceled`,
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves which Application the request acts on:
   *   - Auth via app key → req.application.id (implicit).
   *   - Auth via JWT     → must come from query/body. Validates ownership.
   *
   * Throws BadRequestException(APPLICATION_REQUIRED) when JWT is used without
   * applicationId, NotFoundException(APPLICATION_NOT_FOUND) when the supplied
   * id doesn't belong to the authenticated account.
   */
  private async resolveApplicationId(
    req: FastifyRequest,
    account: Account,
    fromQuery?: string,
  ): Promise<string> {
    const fromKey = (req as FastifyRequest & { application?: Application }).application
    if (fromKey) return fromKey.id

    if (!fromQuery) {
      throw new BadRequestException({
        message: 'applicationId is required when authenticating with JWT.',
        code: 'APPLICATION_REQUIRED',
      })
    }
    const app = await this.prisma.application.findFirst({
      where: { id: fromQuery, accountId: account.id },
      select: { id: true },
    })
    if (!app) {
      throw new NotFoundException({
        message: 'Application not found',
        code: 'APPLICATION_NOT_FOUND',
      })
    }
    return app.id
  }

  private async findEndUserOrThrow(externalId: string, applicationId: string) {
    const eu = await this.prisma.endUser.findUnique({
      where: { applicationId_externalId: { applicationId, externalId } },
    })
    if (!eu) {
      throw new NotFoundException({
        message: 'End user not found',
        code: 'END_USER_NOT_FOUND',
      })
    }
    return eu
  }
}

// ---------------------------------------------------------------------------
// Serializers (mirror BillingController helpers)
// ---------------------------------------------------------------------------

function serializeProduct(
  p: Awaited<ReturnType<ProductsService['listActiveForAccount']>>[number],
) {
  return {
    id: p.id,
    stripeProductId: p.stripeProductId,
    name: p.name,
    description: p.description,
    mode: p.mode,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    prices: p.prices.map((px) => ({
      id: px.id,
      stripePriceId: px.stripePriceId,
      currency: px.currency,
      unitAmount: px.unitAmount,
      interval: px.interval,
      tokensGranted: px.tokensGranted.toString(),
      isActive: px.isActive,
      metadata: px.metadata,
      createdAt: px.createdAt.toISOString(),
    })),
  }
}

function serializeSubscription(sub: SubscriptionView) {
  return {
    id: sub.id,
    status: sub.status,
    productName: sub.price.product.name,
    priceId: sub.priceId,
    unitAmount: sub.price.unitAmount,
    currency: sub.price.currency,
    interval: sub.price.interval,
    tokensGranted: sub.price.tokensGranted.toString(),
    currentPeriodStart: sub.currentPeriodStart.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt?.toISOString() ?? null,
  }
}
