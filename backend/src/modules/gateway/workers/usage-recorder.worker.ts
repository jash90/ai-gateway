import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PrismaService } from '../../../prisma/prisma.service'
import type { RecordUsageInput } from '../services/usage-recorder.service'
import { CostCalculatorService } from '../services/cost-calculator.service'

export const USAGE_RECORDING_QUEUE = 'usage-recording'

/**
 * BullMQ worker that consumes usage-recording jobs and INSERTs UsageEvent rows.
 *
 * Why a queue: gateway response latency shouldn't include Postgres write time.
 * Crash recovery: jobs persist in Redis until acknowledged, so a process
 * restart between gateway response and DB write doesn't lose usage data.
 *
 * Payload shape: same as `RecordUsageInput` from UsageRecorderService, with
 * Date fields serialized to ISO strings (BullMQ JSON-roundtrips payloads).
 *
 * Cost computation (Sprint 3): the worker will lookup ModelPricing here and
 * write costUsd at INSERT time, avoiding a second pass.
 */
@Processor(USAGE_RECORDING_QUEUE)
export class UsageRecorderWorker extends WorkerHost {
  private readonly logger = new Logger(UsageRecorderWorker.name)

  constructor(
    private prisma: PrismaService,
    private costCalculator: CostCalculatorService,
  ) {
    super()
  }

  async process(job: Job<SerializedRecordUsageInput>): Promise<void> {
    const input = deserialize(job.data)
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
      // Throwing causes BullMQ to retry per the queue's retry policy.
      // For now we let the default 3-retry-with-exponential-backoff apply.
      this.logger.error(
        `Failed to persist UsageEvent (job ${job.id}, attempt ${job.attemptsMade}): ` +
          (err instanceof Error ? err.message : String(err)),
      )
      throw err
    }
  }
}

// =============================================================================
// Serialization — Dates / Buffers don't survive BullMQ's JSON roundtrip cleanly.
// The recorder service serializes Dates to ISO strings before enqueuing.
// =============================================================================

export type SerializedRecordUsageInput = Omit<RecordUsageInput, 'metadata'> & {
  metadata?: unknown
}

function deserialize(input: SerializedRecordUsageInput): RecordUsageInput {
  return input as RecordUsageInput
}
