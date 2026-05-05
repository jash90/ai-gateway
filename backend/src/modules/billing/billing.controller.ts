import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { Account } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ClientAuthGuard } from '../auth/guards/client-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { ProductsService } from './services/products.service'
import { CheckoutService } from './services/checkout.service'
import {
  SubscriptionsService,
  type SubscriptionView,
} from './services/subscriptions.service'
import { WalletService } from '../wallet/wallet.service'
import { StripeConfigService } from './services/stripe-config.service'
import {
  CheckoutRequestDto,
  CheckoutResponseDto,
  CombinedWalletsDto,
  ApplicationWalletDto,
  PreferencesDto,
  ProductListDto,
  SubscriptionResponseDto,
  BillingSummaryDto,
  UpdatePreferencesDto,
} from './dto/billing.dto'

/**
 * Account-facing billing API — the integration surface for client apps.
 *
 * This is what an SDK or third-party application calls to:
 *   - list available products/plans (operator-defined)
 *   - check if the current user has an active subscription
 *   - check how many tokens are left
 *   - start a Stripe Checkout for top-up / subscription purchase
 *   - cancel a subscription
 *
 * Stripe is hidden behind these endpoints — the calling app never talks to
 * Stripe directly. Our DB is the source of truth for products, subscriptions
 * and balances; Stripe just processes the payment.
 */
@ApiTags('billing')
@ApiBearerAuth('bearer')
@Controller('v1/billing')
@UseGuards(ClientAuthGuard)
export class BillingController {
  constructor(
    private products: ProductsService,
    private checkout: CheckoutService,
    private subscriptions: SubscriptionsService,
    private wallet: WalletService,
    private stripeConfig: StripeConfigService,
    private prisma: PrismaService,
  ) {}

  @Get('catalog')
  @ZodResponse({
    status: 200,
    description: 'Active products + prices visible to clients.',
    type: ProductListDto,
  })
  @ApiOperation({ summary: 'List active products and prices for purchase' })
  async catalog() {
    const products = await this.products.listActiveForAccount()
    return { products: products.map(serializeProduct) }
  }

  @Get('subscription')
  @ZodResponse({
    status: 200,
    description: 'Active subscription for the current account, or null.',
    type: SubscriptionResponseDto,
  })
  @ApiOperation({
    summary: 'Get current subscription status',
    description:
      'Returns the active (or trialing/past_due) subscription for the authenticated account. ' +
      'Returns null when there is no active subscription.',
  })
  async getSubscription(@CurrentAccount() account: Account) {
    const sub = await this.subscriptions.getActive(account.id)
    return { subscription: sub ? serializeSubscription(sub) : null }
  }

  @Post('subscription/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: 200,
    description: 'Subscription set to cancel at period end.',
    type: SubscriptionResponseDto,
  })
  @ApiOperation({
    summary: 'Cancel subscription at period end',
    description:
      'Marks the subscription to cancel at the end of the current billing period. ' +
      'Service continues until currentPeriodEnd, then status becomes CANCELED.',
  })
  async cancelSubscription(@Param('id') id: string, @CurrentAccount() account: Account) {
    const updated = await this.subscriptions.cancelAtPeriodEnd(account.id, id)
    return { subscription: serializeSubscription(updated) }
  }

  @Get('me')
  @ZodResponse({
    status: 200,
    description: 'Unified billing summary: balance + subscription + catalog.',
    type: BillingSummaryDto,
  })
  @ApiOperation({
    summary: 'Unified billing summary for the current account',
    description:
      'One call returns everything an integrating app typically needs: ' +
      'remaining tokens (shared + per application), active subscription (if any), ' +
      'and the product catalog. Use this from your client SDK to render a billing ' +
      'screen in a single fetch.',
  })
  async getBillingSummary(@CurrentAccount() account: Account) {
    const [view, sub, productsList, config, prefs] = await Promise.all([
      this.wallet.getCombinedView(account.id),
      this.subscriptions.getActive(account.id),
      this.products.listActiveForAccount(),
      this.stripeConfig.getPublic(),
      this.prisma.account.findUnique({
        where: { id: account.id },
        select: { defaultPackageScope: true, defaultSubscriptionScope: true },
      }),
    ])
    return {
      balance: {
        tokens: view.sharedBalance.toString(),
        refundOnError: view.refundOnError,
      },
      applications: view.applications.map((a) => ({
        id: a.id,
        name: a.name,
        tokenBalance: a.tokenBalance.toString(),
      })),
      totalAvailable: view.totalAvailable.toString(),
      preferences: {
        defaultPackageScope: prefs?.defaultPackageScope ?? 'PER_APPLICATION',
        defaultSubscriptionScope: prefs?.defaultSubscriptionScope ?? 'SHARED_ACCOUNT',
      },
      subscription: sub ? serializeSubscription(sub) : null,
      ready: config.isActive,
      catalog: productsList.map(serializeProduct),
    }
  }

  @Get('wallets')
  @ZodResponse({
    status: 200,
    description: 'Combined wallet view: shared + per-application balances.',
    type: CombinedWalletsDto,
  })
  @ApiOperation({
    summary: 'Combined wallet view (shared + per-application)',
    description:
      'Returns the account-wide shared balance plus a per-application breakdown. ' +
      'Use to render an aggregated billing dashboard.',
  })
  async getWallets(@CurrentAccount() account: Account) {
    const view = await this.wallet.getCombinedView(account.id)
    return {
      sharedBalance: view.sharedBalance.toString(),
      refundOnError: view.refundOnError,
      applications: view.applications.map((a) => ({
        id: a.id,
        name: a.name,
        tokenBalance: a.tokenBalance.toString(),
      })),
      totalAvailable: view.totalAvailable.toString(),
    }
  }

  @Get('applications/:applicationId/wallet')
  @ZodResponse({
    status: 200,
    description: 'Token balance for a specific application owned by the current account.',
    type: ApplicationWalletDto,
  })
  @ApiOperation({
    summary: 'Per-application wallet balance',
    description:
      'Returns the token balance for one application. The application MUST belong ' +
      'to the authenticated account, otherwise 404 is returned (defense against IDOR).',
  })
  async getApplicationWallet(
    @Param('applicationId') applicationId: string,
    @CurrentAccount() account: Account,
  ) {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, accountId: account.id },
      select: { id: true, tokenBalance: true },
    })
    if (!app) {
      throw new NotFoundException({
        message: 'Application not found',
        code: 'APPLICATION_NOT_FOUND',
      })
    }
    return {
      applicationId: app.id,
      tokenBalance: app.tokenBalance.toString(),
    }
  }

  @Get('preferences')
  @ZodResponse({
    status: 200,
    description: 'Default checkout scopes + refund policy for the current account.',
    type: PreferencesDto,
  })
  @ApiOperation({ summary: 'Get billing preferences' })
  async getPreferences(@CurrentAccount() account: Account) {
    const prefs = await this.prisma.account.findUnique({
      where: { id: account.id },
      select: {
        defaultPackageScope: true,
        defaultSubscriptionScope: true,
        refundOnError: true,
      },
    })
    return {
      defaultPackageScope: prefs?.defaultPackageScope ?? 'PER_APPLICATION',
      defaultSubscriptionScope: prefs?.defaultSubscriptionScope ?? 'SHARED_ACCOUNT',
      refundOnError: prefs?.refundOnError ?? true,
    }
  }

  @Patch('preferences')
  @ZodResponse({
    status: 200,
    description: 'Updated billing preferences.',
    type: PreferencesDto,
  })
  @ApiOperation({
    summary: 'Update billing preferences',
    description:
      'Update the account\'s default checkout scopes (per-purchase pre-fill in the ' +
      'Checkout dialog) and refundOnError policy.',
  })
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentAccount() account: Account,
  ) {
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: {
        ...(dto.defaultPackageScope ? { defaultPackageScope: dto.defaultPackageScope } : {}),
        ...(dto.defaultSubscriptionScope
          ? { defaultSubscriptionScope: dto.defaultSubscriptionScope }
          : {}),
        ...(dto.refundOnError !== undefined ? { refundOnError: dto.refundOnError } : {}),
      },
      select: {
        defaultPackageScope: true,
        defaultSubscriptionScope: true,
        refundOnError: true,
      },
    })
    return {
      defaultPackageScope: updated.defaultPackageScope,
      defaultSubscriptionScope: updated.defaultSubscriptionScope,
      refundOnError: updated.refundOnError,
    }
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: 200,
    description: 'Stripe Checkout session URL — redirect the browser there.',
    type: CheckoutResponseDto,
  })
  @ApiOperation({
    summary: 'Create a Stripe Checkout session for the given price',
    description:
      'Returns a Stripe Checkout URL. Client redirects the user there to pay. ' +
      'After payment, Stripe webhook credits tokens or activates the subscription. ' +
      'Use `scope` + `applicationId` to direct the credit to a specific application ' +
      'wallet (PER_APPLICATION) or to the shared account wallet (SHARED_ACCOUNT, default).',
  })
  async createCheckout(@Body() dto: CheckoutRequestDto, @CurrentAccount() account: Account) {
    const baseUrl = process.env.PUBLIC_DASHBOARD_URL ?? 'http://localhost:5173'
    return this.checkout.createSession({
      accountId: account.id,
      priceId: dto.priceId,
      successUrl: dto.successUrl ?? `${baseUrl}/settings/billing?status=ok`,
      cancelUrl: dto.cancelUrl ?? `${baseUrl}/settings/billing?status=canceled`,
      scope: dto.scope,
      applicationId: dto.applicationId ?? null,
    })
  }
}

// ---------------------------------------------------------------------------
// Serializers
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
