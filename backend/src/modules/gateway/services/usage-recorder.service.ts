import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'
import type { Prisma, ProviderType } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import type { UsageMetrics } from '../providers/base-provider'
import { USAGE_RECORDING_QUEUE } from '../workers/usage-recorder.worker'
import { CostCalculatorService } from './cost-calculator.service'

export interface RecordUsageInput {
  accountId: string
  applicationId: string
  applicationKeyId: string
  endUserId?: string | null
  provider: ProviderType
  model: string
  isStream: boolean
  statusCode: number
  errorCode: string | null
  finishReason: string | null
  requestId: string | null
  ttftMs: number | null
  latencyMs: number
  usage: UsageMetrics | null
  metadata?: Prisma.InputJsonValue
}

/**
 * Records UsageEvent rows.
 *
 * Sprint 2 final: enqueues to BullMQ `usage-recording` queue. The gateway
 * response is not blocked by Postgres write latency. Worker (UsageRecorderWorker)
 * consumes the queue and INSERTs.
 *
 * Fallback: if enqueue fails (Redis down), we INSERT synchronously so we don't
 * lose the event. Logs the fallback so ops can see degradation.
 *
 * Sprint 3: worker will also resolve ModelPricing and compute costUsd.
 */
@Injectable()
export class UsageRecorderService {
  private readonly logger = new Logger(UsageRecorderService.name)

  constructor(
    private prisma: PrismaService,
    private costCalculator: CostCalculatorService,
    @InjectQueue(USAGE_RECORDING_QUEUE) private queue: Queue,
  ) {}

  async record(input: RecordUsageInput): Promise<void> {
    try {
      await this.queue.add('record', input, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 24 * 60 * 60 },
      })
    } catch (err) {
      this.logger.warn(
        `Queue enqueue failed for UsageEvent (${input.provider}/${input.model}); ` +
          `falling back to sync INSERT: ${err instanceof Error ? err.message : String(err)}`,
      )
      await this.recordSync(input)
    }
  }

  /**
   * Synchronous fallback path. Also used by the worker (which calls
   * `prisma.usageEvent.create` directly — same shape).
   */
  private async recordSync(input: RecordUsageInput): Promise<void> {
    const costUsd = await this.costCalculator.compute(
      input.provider,
      input.model,
      input.usage,
    )
    try {
      await this.prisma.usageEvent.create({
        data: {
          accountId: input.accountId,
          applicationId: input.applicationId,
          applicationKeyId: input.applicationKeyId,
          endUserId: input.endUserId ?? null,
          provider: input.provider,
          model: input.model,
          isStream: input.isStream,
          statusCode: input.statusCode,
          errorCode: input.errorCode,
          finishReason: input.finishReason,
          requestId: input.requestId,
          ttftMs: input.ttftMs,
          latencyMs: input.latencyMs,
          inputTokens: input.usage?.inputTokens ?? 0,
          outputTokens: input.usage?.outputTokens ?? 0,
          cacheReadTokens: input.usage?.cacheReadTokens ?? 0,
          cacheCreationTokens: input.usage?.cacheCreationTokens ?? 0,
          costUsd,
          metadata: input.metadata,
        },
      })
    } catch (err) {
      this.logger.error(
        `Failed to persist UsageEvent for ${input.provider} ${input.model}: ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }
}
