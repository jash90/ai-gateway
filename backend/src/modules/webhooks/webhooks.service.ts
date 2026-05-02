import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { generateWebhookSecret } from './services/webhook-signer'
import { WEBHOOK_DELIVERY_QUEUE } from './workers/webhook-delivery.worker'
import type {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookEventType,
  WebhookSummaryDto,
} from './dto/webhooks.dto'

interface RequestContext {
  ip?: string
  userAgent?: string
}

interface DispatchInput {
  accountId: string
  event: WebhookEventType
  payload: Record<string, unknown>
}

/**
 * WebhooksService — CRUD for WebhookConfig + dispatch helper.
 *
 * Dispatch flow:
 *   1. `dispatch({ accountId, event, payload })` enqueues one job per matching
 *      active WebhookConfig (where event ∈ events[]).
 *   2. WebhookDeliveryWorker picks up the job, signs + POSTs, records the
 *      WebhookDelivery row with statusCode and response.
 *   3. On 5xx or network error: BullMQ retries up to 5x with exponential backoff.
 *
 * Other modules call dispatch() to fire events. Hooks are wired in:
 *   - ApplicationsService → application.created/deleted
 *   - ApplicationKeysService → key.created/revoked
 *   - GatewayService → usage.recorded, request.error
 *   - ProviderKeysService.test → provider_key.invalid (on failed test)
 *   - AlertsService → alert.triggered
 */
@Injectable()
export class WebhooksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private deliveryQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async list(accountId: string): Promise<WebhookSummaryDto[]> {
    const configs = await this.prisma.webhookConfig.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: {
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            event: true,
            statusCode: true,
            deliveredAt: true,
            createdAt: true,
          },
        },
      },
    })
    return configs.map((c) => ({
      id: c.id,
      url: c.url,
      events: c.events,
      isActive: c.isActive,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastDelivery: c.deliveries[0] ?? null,
    }))
  }

  async create(
    accountId: string,
    dto: CreateWebhookDto,
    ctx: RequestContext,
  ): Promise<WebhookSummaryDto & { secret: string }> {
    const secret = generateWebhookSecret()
    const created = await this.prisma.webhookConfig.create({
      data: {
        accountId,
        url: dto.url,
        secret,
        events: dto.events,
        isActive: dto.isActive ?? true,
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'webhook.created',
      resource: `webhook:${created.id}`,
      metadata: { url: created.url, events: created.events },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return {
      id: created.id,
      url: created.url,
      events: created.events,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      lastDelivery: null,
      secret,
    }
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateWebhookDto,
    ctx: RequestContext,
  ): Promise<WebhookSummaryDto> {
    const existing = await this.prisma.webhookConfig.findFirst({
      where: { id, accountId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not found.',
      })
    }

    const updated = await this.prisma.webhookConfig.update({
      where: { id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'webhook.updated',
      resource: `webhook:${id}`,
      metadata: dto as Prisma.InputJsonValue,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return {
      id: updated.id,
      url: updated.url,
      events: updated.events,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      lastDelivery: null,
    }
  }

  async delete(accountId: string, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.webhookConfig.findFirst({
      where: { id, accountId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not found.',
      })
    }
    await this.prisma.webhookConfig.delete({ where: { id } })
    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'webhook.deleted',
      resource: `webhook:${id}`,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }

  // ---------------------------------------------------------------------------
  // Delivery history + replay
  // ---------------------------------------------------------------------------

  async replayDelivery(
    accountId: string,
    webhookId: string,
    deliveryId: string,
    ctx: RequestContext,
  ): Promise<{ enqueued: true }> {
    const wh = await this.prisma.webhookConfig.findFirst({
      where: { id: webhookId, accountId },
      select: { id: true, url: true, secret: true, isActive: true },
    })
    if (!wh) {
      throw new NotFoundException({
        errorCode: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not found.',
      })
    }

    const original = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId },
    })
    if (!original) {
      throw new NotFoundException({
        errorCode: 'DELIVERY_NOT_FOUND',
        message: 'Delivery not found.',
      })
    }

    await this.deliveryQueue.add(
      'deliver',
      {
        webhookId: wh.id,
        url: wh.url,
        secret: wh.secret,
        event: original.event,
        payload: original.payload as Prisma.InputJsonValue,
        issuedAt: Date.now(),
      },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    )

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'webhook.delivery_replayed',
      resource: `webhook:${webhookId}`,
      metadata: { originalDeliveryId: deliveryId, event: original.event },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return { enqueued: true }
  }

  async listDeliveries(accountId: string, webhookId: string, limit = 50) {
    const wh = await this.prisma.webhookConfig.findFirst({
      where: { id: webhookId, accountId },
      select: { id: true },
    })
    if (!wh) {
      throw new NotFoundException({
        errorCode: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not found.',
      })
    }
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // ---------------------------------------------------------------------------
  // Dispatch (called by other modules)
  // ---------------------------------------------------------------------------

  async dispatch(input: DispatchInput): Promise<void> {
    const matching = await this.prisma.webhookConfig.findMany({
      where: {
        accountId: input.accountId,
        isActive: true,
        events: { has: input.event },
      },
      select: { id: true, url: true, secret: true },
    })

    if (matching.length === 0) return

    for (const wh of matching) {
      try {
        await this.deliveryQueue.add(
          'deliver',
          {
            webhookId: wh.id,
            url: wh.url,
            secret: wh.secret,
            event: input.event,
            payload: input.payload,
            issuedAt: Date.now(),
          },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: { age: 60 * 60, count: 1000 },
            removeOnFail: { age: 7 * 24 * 60 * 60 },
          },
        )
      } catch {
        // queue failure is non-fatal — webhooks are best-effort.
      }
    }
  }
}
