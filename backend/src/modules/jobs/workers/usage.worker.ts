import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { PrismaService } from '../../../prisma/prisma.service'

@Processor('usage-processing')
export class UsageWorker extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super()
  }

  async process(job: Job<{ customerId: string; action: string; data?: Record<string, unknown> }>): Promise<void> {
    const { customerId, action, data } = job.data

    switch (action) {
      case 'aggregate-daily':
        await this.aggregateDailyUsage(customerId)
        break
      case 'check-thresholds':
        await this.checkUsageThresholds(customerId, data)
        break
      default:
        console.warn(`Unknown usage job action: ${action}`)
    }
  }

  private async aggregateDailyUsage(customerId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = await this.prisma.usageEvent.aggregate({
      where: {
        customerId,
        createdAt: { gte: today },
      },
      _sum: {
        creditsBurned: true,
        inputTokens: true,
        outputTokens: true,
      },
      _count: true,
    })

    // Store or log daily aggregation
    console.log(`[UsageWorker] Daily aggregation for ${customerId}:`, {
      creditsBurned: result._sum.creditsBurned ?? 0,
      inputTokens: result._sum.inputTokens ?? 0,
      outputTokens: result._sum.outputTokens ?? 0,
      totalRequests: result._count,
    })
  }

  private async checkUsageThresholds(customerId: string, data?: Record<string, unknown>) {
    // Placeholder: evaluate alert rules for usage thresholds
    // Full implementation in Phase 7 (Alerts module)
    console.log(`[UsageWorker] Threshold check for ${customerId}:`, data)
  }
}
