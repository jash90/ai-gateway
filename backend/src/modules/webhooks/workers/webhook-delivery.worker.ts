import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { signWebhookPayload } from '../services/webhook-signer'

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-deliveries'

const HTTP_TIMEOUT_MS = 10_000

interface DeliveryJobData {
  webhookId: string
  url: string
  secret: string
  event: string
  payload: Record<string, unknown>
  issuedAt: number
}

/**
 * Webhook delivery worker. Consumes from `webhook-deliveries` queue.
 *
 * Per attempt:
 *   1. POST to webhook URL with HMAC signature header.
 *   2. Record WebhookDelivery row with statusCode + response body (truncated).
 *   3. 2xx → ack. Otherwise throw → BullMQ retries with exponential backoff.
 *
 * Final delivery row is upserted by job ID so retries replace previous attempts'
 * state. Customer's webhook can dedupe via X-Raccoon-Delivery header.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryWorker extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryWorker.name)

  constructor(private prisma: PrismaService) {
    super()
  }

  async process(job: Job<DeliveryJobData>): Promise<void> {
    const { webhookId, url, secret, event, payload, issuedAt } = job.data
    const rawBody = JSON.stringify({ event, issuedAt, data: payload })
    const { header } = signWebhookPayload(secret, rawBody, Math.floor(issuedAt / 1000))

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
    let statusCode: number | null = null
    let responseText: string | null = null
    let success = false

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Raccoon-Event': event,
          'X-Raccoon-Signature': header,
          'X-Raccoon-Delivery': String(job.id ?? ''),
          'User-Agent': 'Raccoon-Gateway-Webhook/1.0',
        },
        body: rawBody,
        signal: ctrl.signal,
      })
      statusCode = res.status
      responseText = (await res.text().catch(() => '')).slice(0, 1024)
      success = res.ok
    } catch (err) {
      responseText = err instanceof Error ? err.message.slice(0, 1024) : 'Network error'
    } finally {
      clearTimeout(timer)
    }

    // Persist (always — including failure attempts).
    await this.prisma.webhookDelivery
      .create({
        data: {
          webhookId,
          event,
          payload: payload as Prisma.InputJsonValue,
          statusCode,
          response: responseText,
          attempts: job.attemptsMade + 1,
          deliveredAt: success ? new Date() : null,
        },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to persist WebhookDelivery for ${webhookId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      )

    if (!success) {
      // Throw → BullMQ retries per the queue's retry policy (5 attempts).
      throw new Error(`Webhook delivery failed (status=${statusCode ?? 'network'})`)
    }
  }
}
