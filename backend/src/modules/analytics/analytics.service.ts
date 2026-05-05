import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export interface DateRange {
  from: Date
  to: Date
  applicationId?: string
}

interface EventsFilter extends DateRange {
  cursor?: string
  limit: number
  provider?: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  status?: 'success' | 'client_error' | 'server_error'
  model?: string
}

/**
 * Read-side queries for the analytics endpoints. All queries scope by
 * `accountId` (extracted from JWT in the controller) so cross-account leaks
 * are impossible by construction.
 *
 * Performance notes:
 *   - Hot indices on usage_events: (account_id, created_at DESC),
 *     (application_id, created_at DESC), (application_id, model, created_at DESC).
 *   - p95 latency uses Postgres percentile_cont via $queryRaw — Prisma doesn't
 *     expose it natively.
 *   - Time-series buckets use date_trunc('hour', ...) via $queryRaw.
 *   - Cursor pagination encodes (createdAt, id) — opaque to clients.
 */
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Overview — top-line numbers
  // ---------------------------------------------------------------------------

  async overview(accountId: string, range: DateRange) {
    const where: Prisma.UsageEventWhereInput = {
      accountId,
      createdAt: { gte: range.from, lte: range.to },
      ...(range.applicationId ? { applicationId: range.applicationId } : {}),
    }

    const [agg, errorCount, totalCount] = await Promise.all([
      this.prisma.usageEvent.aggregate({
        where,
        _sum: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          costUsd: true,
        },
        _avg: { latencyMs: true },
        _count: { _all: true },
      }),
      this.prisma.usageEvent.count({ where: { ...where, statusCode: { gte: 400 } } }),
      this.prisma.usageEvent.count({ where }),
    ])

    const p95 = await this.computeP95Latency(accountId, range)

    const totalRequests = agg._count._all
    return {
      totalRequests,
      totalInputTokens: agg._sum.inputTokens ?? 0,
      totalOutputTokens: agg._sum.outputTokens ?? 0,
      totalCacheReadTokens: agg._sum.cacheReadTokens ?? 0,
      totalCostUsd: agg._sum.costUsd ? Number(agg._sum.costUsd) : 0,
      avgLatencyMs: agg._avg.latencyMs ?? 0,
      p95LatencyMs: p95,
      errorRate: totalCount > 0 ? errorCount / totalCount : 0,
      errorCount,
      fromIso: range.from.toISOString(),
      toIso: range.to.toISOString(),
    }
  }

  private async computeP95Latency(accountId: string, range: DateRange): Promise<number> {
    // NOTE: usage_events.account_id / application_id are TEXT columns
    // (not Postgres uuid) — Prisma binds string params as text, so no
    // explicit ::uuid cast (it would fail with "operator does not exist:
    // text = uuid" on Postgres ≥ 14).
    const result = await this.prisma.$queryRaw<Array<{ p95: number | null }>>`
      SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95
      FROM usage_events
      WHERE account_id = ${accountId}
        AND created_at >= ${range.from}
        AND created_at <= ${range.to}
        ${range.applicationId
          ? Prisma.sql`AND application_id = ${range.applicationId}`
          : Prisma.empty}
    `
    return result[0]?.p95 ?? 0
  }

  // ---------------------------------------------------------------------------
  // Breakdown — group-by dimension
  // ---------------------------------------------------------------------------

  async breakdown(
    accountId: string,
    range: DateRange,
    dimension: 'app' | 'model' | 'provider' | 'endUser',
  ) {
    const where: Prisma.UsageEventWhereInput = {
      accountId,
      createdAt: { gte: range.from, lte: range.to },
      ...(range.applicationId ? { applicationId: range.applicationId } : {}),
    }

    const groupKey =
      dimension === 'app' ? 'applicationId'
      : dimension === 'model' ? 'model'
      : dimension === 'provider' ? 'provider'
      : 'endUserId'

    const rows = await this.prisma.usageEvent.groupBy({
      by: [groupKey],
      where,
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      _count: { _all: true },
    })

    const errorRows = await this.prisma.usageEvent.groupBy({
      by: [groupKey],
      where: { ...where, statusCode: { gte: 400 } },
      _count: { _all: true },
    })
    const errorByKey = new Map<string | null, number>()
    for (const r of errorRows) {
      errorByKey.set((r as Record<string, unknown>)[groupKey] as string | null, r._count._all)
    }

    // Resolve labels for app + endUser dimensions (prisma doesn't include FKs in groupBy).
    const labelMap = await this.resolveLabels(dimension, accountId, rows.map((r) => (r as Record<string, unknown>)[groupKey] as string | null))

    return {
      dimension,
      rows: rows
        .map((r) => {
          const key = (r as Record<string, unknown>)[groupKey] as string | null
          const keyStr = key ?? '(null)'
          return {
            key: keyStr,
            label: labelMap.get(key) ?? keyStr,
            requests: r._count._all,
            inputTokens: r._sum.inputTokens ?? 0,
            outputTokens: r._sum.outputTokens ?? 0,
            costUsd: r._sum.costUsd ? Number(r._sum.costUsd) : 0,
            errorCount: errorByKey.get(key) ?? 0,
          }
        })
        .sort((a, b) => b.requests - a.requests),
    }
  }

  private async resolveLabels(
    dimension: 'app' | 'model' | 'provider' | 'endUser',
    accountId: string,
    keys: Array<string | null>,
  ): Promise<Map<string | null, string>> {
    const map = new Map<string | null, string>()
    if (dimension === 'app') {
      const ids = keys.filter((k): k is string => !!k)
      if (ids.length === 0) return map
      const apps = await this.prisma.application.findMany({
        where: { accountId, id: { in: ids } },
        select: { id: true, name: true },
      })
      for (const a of apps) map.set(a.id, a.name)
    } else if (dimension === 'endUser') {
      const ids = keys.filter((k): k is string => !!k)
      if (ids.length === 0) return map
      const eus = await this.prisma.endUser.findMany({
        where: { id: { in: ids } },
        select: { id: true, externalId: true },
      })
      for (const eu of eus) map.set(eu.id, eu.externalId)
    }
    return map
  }

  // ---------------------------------------------------------------------------
  // Time series — bucketed by hour or day
  // ---------------------------------------------------------------------------

  async timeseries(
    accountId: string,
    range: DateRange,
    metric: 'requests' | 'tokens' | 'cost' | 'latency_p95',
    granularity: 'hour' | 'day',
  ) {
    const truncFn = granularity === 'hour' ? 'hour' : 'day'

    // See note in computeP95Latency — account_id / application_id are TEXT, no ::uuid cast.
    const appFilter = range.applicationId
      ? Prisma.sql`AND application_id = ${range.applicationId}`
      : Prisma.empty

    let rows: Array<{ bucket: Date; value: number | null }>
    switch (metric) {
      case 'requests':
        rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
          SELECT date_trunc(${truncFn}, created_at) AS bucket, count(*)::float AS value
          FROM usage_events
          WHERE account_id = ${accountId}
            AND created_at >= ${range.from} AND created_at <= ${range.to}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        break
      case 'tokens':
        rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
          SELECT date_trunc(${truncFn}, created_at) AS bucket,
                 (sum(input_tokens) + sum(output_tokens))::float AS value
          FROM usage_events
          WHERE account_id = ${accountId}
            AND created_at >= ${range.from} AND created_at <= ${range.to}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        break
      case 'cost':
        rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
          SELECT date_trunc(${truncFn}, created_at) AS bucket,
                 coalesce(sum(cost_usd), 0)::float AS value
          FROM usage_events
          WHERE account_id = ${accountId}
            AND created_at >= ${range.from} AND created_at <= ${range.to}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        break
      case 'latency_p95':
        rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
          SELECT date_trunc(${truncFn}, created_at) AS bucket,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS value
          FROM usage_events
          WHERE account_id = ${accountId}
            AND created_at >= ${range.from} AND created_at <= ${range.to}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        break
    }

    return {
      metric,
      granularity,
      points: rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        value: r.value ?? 0,
      })),
    }
  }

  // ---------------------------------------------------------------------------
  // Events feed — cursor-paginated
  // ---------------------------------------------------------------------------

  async events(accountId: string, filter: EventsFilter) {
    const where: Prisma.UsageEventWhereInput = {
      accountId,
      createdAt: { gte: filter.from, lte: filter.to },
      ...(filter.applicationId ? { applicationId: filter.applicationId } : {}),
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.model ? { model: filter.model } : {}),
    }

    if (filter.status === 'success') where.statusCode = { lt: 400 }
    else if (filter.status === 'client_error') where.statusCode = { gte: 400, lt: 500 }
    else if (filter.status === 'server_error') where.statusCode = { gte: 500 }

    if (filter.cursor) {
      const [iso, id] = filter.cursor.split('__')
      const cursorDate = new Date(iso)
      if (!Number.isNaN(cursorDate.getTime())) {
        where.OR = [
          { createdAt: { lt: cursorDate } },
          { createdAt: cursorDate, id: { lt: id } },
        ]
      }
    }

    const events = await this.prisma.usageEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1, // +1 to know if there's a next page
    })

    const hasMore = events.length > filter.limit
    const slice = hasMore ? events.slice(0, filter.limit) : events
    const last = slice[slice.length - 1]
    const nextCursor =
      hasMore && last
        ? `${last.createdAt.toISOString()}__${last.id}`
        : null

    return {
      events: slice.map((e) => ({
        id: e.id,
        applicationId: e.applicationId,
        applicationKeyId: e.applicationKeyId,
        endUserId: e.endUserId,
        provider: e.provider,
        model: e.model,
        isStream: e.isStream,
        statusCode: e.statusCode,
        errorCode: e.errorCode,
        finishReason: e.finishReason,
        requestId: e.requestId,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheCreationTokens: e.cacheCreationTokens,
        costUsd: e.costUsd ? Number(e.costUsd) : null,
        ttftMs: e.ttftMs,
        latencyMs: e.latencyMs,
        createdAt: e.createdAt,
      })),
      nextCursor,
    }
  }
}
