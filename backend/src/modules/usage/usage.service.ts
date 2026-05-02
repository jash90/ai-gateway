import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class UsageService {
  constructor(private prisma: PrismaService) {}

  async ingestEvent(data: {
    customerId: string
    eventType: string
    featureId: string
    provider?: string
    model?: string
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    creditsBurned?: number
    costUsd?: number
    metadata?: Record<string, unknown>
    idempotencyKey?: string
    userId?: string
  }) {
    if (data.idempotencyKey) {
      const existing = await this.prisma.usageEvent.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      })
      if (existing) return existing
    }

    return this.prisma.usageEvent.create({
      data: {
        ...data,
        metadata: data.metadata ? (data.metadata as any) : undefined,
      },
    })
  }

  async getStats(customerId: string, from?: Date, to?: Date) {
    const where = {
      customerId,
      ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    }

    const [totalCredits, totalRequests, byProvider] = await Promise.all([
      this.prisma.usageEvent.aggregate({ where, _sum: { creditsBurned: true } }),
      this.prisma.usageEvent.count({ where }),
      this.prisma.usageEvent.groupBy({
        by: ['provider'],
        where,
        _sum: { creditsBurned: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
    ])

    return {
      totalCredits: totalCredits._sum.creditsBurned ?? 0,
      totalRequests,
      byProvider,
    }
  }

  async getEvents(customerId: string, page = 1, limit = 25) {
    const [events, total] = await Promise.all([
      this.prisma.usageEvent.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.usageEvent.count({ where: { customerId } }),
    ])

    return { events, total, page, limit }
  }
}
