import { Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import type { Job } from 'bullmq'
import { PrismaService } from '../../../prisma/prisma.service'
import type { RecordUsageInput } from '../services/usage-recorder.service'
import { CostCalculatorService } from '../services/cost-calculator.service'
import { WalletService } from '../../wallet/wallet.service'
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service'

export const USAGE_RECORDING_QUEUE = 'usage-recording'

/**
 * BullMQ worker that consumes usage-recording jobs and INSERTs UsageEvent rows.
 *
 * M4: after persisting UsageEvent, settle the wallet hold for billing-enforced
 * accounts. Settle uses (input + output) tokens, refunds the difference vs hold.
 * On error responses, optionally refund the entire hold based on
 * Account.refundOnError.
 */
@Processor(USAGE_RECORDING_QUEUE)
export class UsageRecorderWorker extends WorkerHost {
  private readonly logger = new Logger(UsageRecorderWorker.name)

  constructor(
    private prisma: PrismaService,
    private costCalculator: CostCalculatorService,
    private wallet: WalletService,
    private featureFlags: FeatureFlagsService,
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
      this.logger.error(
        `Failed to persist UsageEvent (job ${job.id}, attempt ${job.attemptsMade}): ` +
          (err instanceof Error ? err.message : String(err)),
      )
      throw err
    }

    // M4: Settle / refund the wallet hold (only if a walletRequestId was set,
    // meaning gateway pre-check happened with billing.enforced=true).
    const meta = input.metadata as { walletRequestId?: string } | undefined | null
    const walletRequestId = meta?.walletRequestId
    if (walletRequestId) {
      try {
        await this.handleWalletSettlement(input, walletRequestId)
      } catch (err) {
        this.logger.error(
          `Wallet settlement failed for requestId=${walletRequestId}: ` +
            (err instanceof Error ? err.message : String(err)),
        )
        // Don't rethrow — UsageEvent already persisted, wallet drift is recoverable
        // by the daily reconciliation cron (M7).
      }
    }
  }

  private async handleWalletSettlement(
    input: RecordUsageInput,
    walletRequestId: string,
  ): Promise<void> {
    const isError = input.statusCode >= 400

    // Resolve refundOnError: per-account flag wins, falls back to Account column.
    let refundOnError = true
    try {
      const flag = await this.featureFlags.resolve('billing.refundOnError', input.accountId)
      if (flag.source !== 'fallback') {
        refundOnError = flag.enabled
      } else {
        const acct = await this.prisma.account.findUnique({
          where: { id: input.accountId },
          select: { refundOnError: true },
        })
        refundOnError = acct?.refundOnError ?? true
      }
    } catch {
      // Defaults to refunding on error (user-friendly).
    }

    // Decide which wallet path applies — at hold time we suffixed the requestId
    // with `:enduser` (end-user wallet), `:app` / `:account` (application
    // wallet flow), so we look up whichever exists and route accordingly.
    const endUserHold = await this.prisma.walletTransaction.findUnique({
      where: { requestId: `${walletRequestId}:enduser` },
      select: { id: true },
    })
    const isEndUserHold = !!endUserHold

    if (isError && refundOnError) {
      const meta = {
        statusCode: input.statusCode,
        errorCode: input.errorCode ?? 'unknown',
        provider: input.provider,
        model: input.model,
      }
      if (isEndUserHold) {
        await this.wallet.refundForEndUser(walletRequestId, 'PROVIDER_ERROR', meta)
      } else {
        await this.wallet.refundForApplication(walletRequestId, 'PROVIDER_ERROR', meta)
      }
      return
    }

    // Settle against actual (input + output) usage.
    const inputTokens = BigInt(input.usage?.inputTokens ?? 0)
    const outputTokens = BigInt(input.usage?.outputTokens ?? 0)
    const actualTokens = inputTokens + outputTokens
    const settleMeta = {
      provider: input.provider,
      model: input.model,
      statusCode: input.statusCode,
      errorCharged: isError && !refundOnError,
    }
    if (isEndUserHold) {
      await this.wallet.settleForEndUser(walletRequestId, actualTokens, settleMeta)
    } else {
      await this.wallet.settleForApplication(walletRequestId, actualTokens, settleMeta)
    }
  }
}

// =============================================================================
// Serialization — Dates / Buffers don't survive BullMQ's JSON roundtrip cleanly.
// =============================================================================

export type SerializedRecordUsageInput = Omit<RecordUsageInput, 'metadata'> & {
  metadata?: unknown
}

function deserialize(input: SerializedRecordUsageInput): RecordUsageInput {
  return input as RecordUsageInput
}
