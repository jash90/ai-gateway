import { Injectable } from '@nestjs/common'
import type { ProviderType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import type { UsageMetrics } from '../providers/base-provider'

/**
 * Computes USD cost for a UsageEvent by looking up active ModelPricing rows.
 *
 * Pricing model:
 *   - Per (provider, model, costType) lookup of the row whose validFrom is
 *     the latest <= now and validUntil is null or > now.
 *   - costType options: INPUT_TOKEN, OUTPUT_TOKEN, CACHE_READ_TOKEN, CACHE_WRITE_TOKEN
 *   - costPerUnit is in USD per `unitSize` tokens (default unitSize = 1_000_000)
 *
 * Performance:
 *   - In-memory cache keyed by (provider, model). 5-min TTL.
 *   - Hot path: this is called per UsageEvent INSERT (worker), so cache hits
 *     are critical. Cold lookup is one indexed Postgres query (~1-3ms).
 *
 * Cost calculation: O((tokens × costPerUnit) / unitSize) per cost type, summed.
 * Uses Prisma.Decimal to avoid float precision drift on large token counts.
 */

interface PricingMap {
  inputTokenCost?: number // USD per token
  outputTokenCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
}

const CACHE_TTL_MS = 5 * 60 * 1000

@Injectable()
export class CostCalculatorService {
  private cache = new Map<string, { pricing: PricingMap | null; expiresAt: number }>()

  constructor(private prisma: PrismaService) {}

  async compute(
    provider: ProviderType,
    model: string,
    usage: UsageMetrics | null,
  ): Promise<Prisma.Decimal | null> {
    if (!usage) return null

    const pricing = await this.getPricing(provider, model)
    if (!pricing) return null

    const totalCents =
      (pricing.inputTokenCost ?? 0) * usage.inputTokens +
      (pricing.outputTokenCost ?? 0) * usage.outputTokens +
      (pricing.cacheReadCost ?? 0) * usage.cacheReadTokens +
      (pricing.cacheWriteCost ?? 0) * usage.cacheCreationTokens

    if (totalCents === 0) return new Prisma.Decimal(0)

    // Round to 10 decimal places (matches schema @db.Decimal(20, 10)).
    return new Prisma.Decimal(totalCents.toFixed(10))
  }

  private async getPricing(
    provider: ProviderType,
    model: string,
  ): Promise<PricingMap | null> {
    const key = `${provider}:${model}`
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.pricing
    }

    const now = new Date()
    const rows = await this.prisma.modelPricing.findMany({
      where: {
        provider,
        model,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      orderBy: { validFrom: 'desc' },
    })

    if (rows.length === 0) {
      this.cache.set(key, { pricing: null, expiresAt: Date.now() + CACHE_TTL_MS })
      return null
    }

    // Pick the latest validFrom row per costType.
    const latestPerType = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!latestPerType.has(row.costType)) {
        latestPerType.set(row.costType, row)
      }
    }

    const pricing: PricingMap = {}
    for (const [costType, row] of latestPerType) {
      const perToken = Number(row.costPerUnit) / row.unitSize
      switch (costType) {
        case 'INPUT_TOKEN':
          pricing.inputTokenCost = perToken
          break
        case 'OUTPUT_TOKEN':
          pricing.outputTokenCost = perToken
          break
        case 'CACHE_READ_TOKEN':
          pricing.cacheReadCost = perToken
          break
        case 'CACHE_WRITE_TOKEN':
          pricing.cacheWriteCost = perToken
          break
      }
    }

    this.cache.set(key, { pricing, expiresAt: Date.now() + CACHE_TTL_MS })
    return pricing
  }

  /** For tests / admin pricing mutations — invalidate the entire cache. */
  invalidate(): void {
    this.cache.clear()
  }
}
