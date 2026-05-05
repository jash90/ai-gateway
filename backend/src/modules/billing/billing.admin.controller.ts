import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AuditService } from '../audit/audit.service'
import { StripeConfigService } from './services/stripe-config.service'
import { ProductsService } from './services/products.service'
import {
  StripeConfigPublicDto,
  UpsertStripeConfigDto,
  ProductListDto,
  CreateProductDto,
  UpdateProductDto,
  CreatePriceDto,
} from './dto/billing.dto'

@ApiTags('billing-admin')
@ApiBearerAuth('bearer')
@ApiSecurity('admin-key')
@Controller('v1/admin/billing')
@UseGuards(AdminGuard)
export class BillingAdminController {
  constructor(
    private stripeConfig: StripeConfigService,
    private products: ProductsService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Stripe config
  // ---------------------------------------------------------------------------

  @Get('config')
  @ZodResponse({
    status: 200,
    description: 'Stripe configuration (no secrets returned).',
    type: StripeConfigPublicDto,
  })
  @ApiOperation({ summary: 'Get Stripe configuration' })
  async getConfig() {
    return this.stripeConfig.getPublic()
  }

  @Patch('config')
  @ZodResponse({ status: 200, description: 'Updated config (no secrets).', type: StripeConfigPublicDto })
  @ApiOperation({ summary: 'Update Stripe configuration (encrypts secrets)' })
  async upsertConfig(@Body() dto: UpsertStripeConfigDto, @Req() req: FastifyRequest) {
    const actor = req.account
      ? { actorId: req.account.id }
      : { actorId: 'legacy-admin-key' }
    const cfg = await this.stripeConfig.upsert(dto, actor)
    await this.audit.log({
      accountId: req.account?.id,
      actorType: req.account ? 'ADMIN' : 'SYSTEM',
      actorId: actor.actorId,
      action: 'billing.config.updated',
      resource: 'stripe_config:singleton',
      metadata: {
        secretChanged: !!dto.secretKey,
        webhookChanged: !!dto.webhookSecret,
        modeChanged: !!dto.mode,
      },
      ipAddress: extractIp(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    })
    return cfg
  }

  // ---------------------------------------------------------------------------
  // Products + Prices
  // ---------------------------------------------------------------------------

  @Get('products')
  @ZodResponse({ status: 200, description: 'List products with prices.', type: ProductListDto })
  @ApiOperation({ summary: 'List billing products + prices' })
  async listProducts() {
    const products = await this.products.listProducts()
    return {
      products: products.map((p) => ({
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
      })),
    }
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new product (and Stripe Product)' })
  async createProduct(@Body() dto: CreateProductDto, @Req() req: FastifyRequest) {
    const product = await this.products.createProduct(dto)
    await this.audit.log({
      accountId: req.account?.id,
      actorType: req.account ? 'ADMIN' : 'SYSTEM',
      actorId: req.account?.id ?? 'legacy-admin-key',
      action: 'billing.product.created',
      resource: `billing_product:${product.id}`,
      metadata: { name: product.name, mode: product.mode },
      ipAddress: extractIp(req),
    })
    return product
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product (and Stripe Product)' })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: FastifyRequest,
  ) {
    const product = await this.products.updateProduct(id, dto)
    await this.audit.log({
      accountId: req.account?.id,
      actorType: req.account ? 'ADMIN' : 'SYSTEM',
      actorId: req.account?.id ?? 'legacy-admin-key',
      action: 'billing.product.updated',
      resource: `billing_product:${id}`,
      metadata: dto as unknown as import('@prisma/client').Prisma.InputJsonValue,
      ipAddress: extractIp(req),
    })
    return product
  }

  @Post('prices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new price (and Stripe Price)' })
  async createPrice(@Body() dto: CreatePriceDto, @Req() req: FastifyRequest) {
    const price = await this.products.createPrice({
      productId: dto.productId,
      unitAmount: dto.unitAmount,
      currency: dto.currency,
      interval: (dto.interval ?? null) as 'month' | 'year' | null,
      tokensGranted: BigInt(dto.tokensGranted),
      metadata: dto.metadata,
    })
    await this.audit.log({
      accountId: req.account?.id,
      actorType: req.account ? 'ADMIN' : 'SYSTEM',
      actorId: req.account?.id ?? 'legacy-admin-key',
      action: 'billing.price.created',
      resource: `billing_price:${price.id}`,
      metadata: {
        productId: dto.productId,
        unitAmount: dto.unitAmount,
        interval: dto.interval ?? 'one-time',
      },
      ipAddress: extractIp(req),
    })
    return {
      id: price.id,
      stripePriceId: price.stripePriceId,
      currency: price.currency,
      unitAmount: price.unitAmount,
      interval: price.interval,
      tokensGranted: price.tokensGranted.toString(),
      isActive: price.isActive,
      createdAt: price.createdAt.toISOString(),
    }
  }

  @Delete('prices/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a price (Stripe + DB)' })
  async deactivatePrice(@Param('id') id: string, @Req() req: FastifyRequest) {
    const price = await this.products.deactivatePrice(id)
    await this.audit.log({
      accountId: req.account?.id,
      actorType: req.account ? 'ADMIN' : 'SYSTEM',
      actorId: req.account?.id ?? 'legacy-admin-key',
      action: 'billing.price.deactivated',
      resource: `billing_price:${id}`,
      ipAddress: extractIp(req),
    })
    return { id: price.id, isActive: price.isActive }
  }
}

function extractIp(req: FastifyRequest): string | undefined {
  const xff = req.headers['x-forwarded-for']
  return (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) || req.ip || undefined
}
