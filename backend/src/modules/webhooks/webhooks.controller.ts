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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

const webhookReplayResponseSchema = z.object({ enqueued: z.literal(true) })
class WebhookReplayResponseDto extends createZodDto(webhookReplayResponseSchema) {}
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { WebhooksService } from './webhooks.service'
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookCreatedDto,
  WebhookListResponseDto,
  WebhookSummaryDto,
  WebhookDeliveryListResponseDto,
} from './dto/webhooks.dto'

@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@Controller('v1/webhooks')
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'List of webhooks.', type: WebhookListResponseDto })
  @ApiOperation({ summary: 'List configured webhooks' })
  async list(@CurrentAccount() account: Account) {
    return this.webhooks.list(account.id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({
    status: 201,
    description: 'Webhook created. The `secret` field is shown ONLY in this response.',
    type: WebhookCreatedDto,
  })
  @ApiOperation({
    summary: 'Create a webhook',
    description: 'Returns the HMAC signing secret ONCE. Store it; subsequent reads omit it.',
  })
  async create(
    @Body() dto: CreateWebhookDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.create(account.id, dto, extractContext(req))
  }

  @Patch(':id')
  @ZodResponse({ status: 200, description: 'Webhook updated.', type: WebhookSummaryDto })
  @ApiOperation({ summary: 'Update url / events / isActive' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.update(account.id, id, dto, extractContext(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook' })
  async delete(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.webhooks.delete(account.id, id, extractContext(req))
  }

  @Get(':id/deliveries')
  @ZodResponse({
    status: 200,
    description: 'Recent delivery attempts (newest first).',
    type: WebhookDeliveryListResponseDto,
  })
  @ApiOperation({ summary: 'List recent webhook deliveries (last 50 by default)' })
  async listDeliveries(
    @Param('id') id: string,
    @Query('limit') limit: string | undefined,
    @CurrentAccount() account: Account,
  ) {
    const lim = Math.max(1, Math.min(200, limit ? parseInt(limit, 10) : 50))
    return this.webhooks.listDeliveries(account.id, id, lim)
  }

  @Post(':id/deliveries/:deliveryId/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse({
    status: 202,
    description: 'Delivery enqueued for retry.',
    type: WebhookReplayResponseDto,
  })
  @ApiOperation({
    summary: 'Re-send a previous delivery',
    description:
      'Queues a fresh delivery attempt with the same payload + event. Useful when ' +
      'your endpoint was down and you want to manually replay missed events.',
  })
  async replayDelivery(
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.webhooks.replayDelivery(account.id, id, deliveryId, extractContext(req))
  }
}

function extractContext(req: FastifyRequest): { ip?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for']
  const ip =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) ||
    req.ip ||
    undefined
  const ua = req.headers['user-agent']
  return { ip, userAgent: typeof ua === 'string' ? ua : undefined }
}
