import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { PrismaService } from '../../../prisma/prisma.service'

@Processor('webhook-deliveries')
export class WebhookWorker extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super()
  }

  async process(job: Job<{ webhookId: string; url: string; secret: string; event: string; payload: Record<string, unknown> }>): Promise<void> {
    const { webhookId, url, secret, event, payload } = job.data

    const body = JSON.stringify({
      id: `evt_${webhookId}_${Date.now()}`,
      type: event,
      timestamp: new Date().toISOString(),
      data: payload,
    })

    // HMAC-SHA256 signature
    const signature = await this.signPayload(body, secret)

    let statusCode: number | null = null
    let responseText: string | null = null

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': signature,
          'x-webhook-event': event,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })

      statusCode = response.status
      responseText = await response.text().catch(() => null)

      if (!response.ok) {
        throw new Error(`Webhook delivery failed: ${response.status}`)
      }

      // Record successful delivery
      await this.prisma.webhookDelivery.create({
        data: {
          webhookId,
          event,
          payload: body as any,
          statusCode,
          response: responseText,
          attempts: job.attemptsMade + 1,
          deliveredAt: new Date(),
        },
      })
    } catch (err: any) {
      // Record failed attempt
      await this.prisma.webhookDelivery.create({
        data: {
          webhookId,
          event,
          payload: body as any,
          statusCode,
          response: responseText ?? err.message,
          attempts: job.attemptsMade + 1,
        },
      })
      throw err // Re-throw for BullMQ retry
    }
  }

  private async signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `sha256=${hex}`
  }
}
