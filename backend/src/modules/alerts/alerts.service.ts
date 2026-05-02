import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { CreateAlertDto, UpdateAlertDto, AlertSummaryDto } from './dto/alerts.dto'

/**
 * Dry-run preview — simulates how a rule would have fired against the last 30
 * days of historical data. Window granularity matches the rule type's natural
 * cadence: monthly cumulative for USAGE_THRESHOLD, 24h for DAILY_LIMIT, 1h for
 * ERROR_RATE_HIGH and LATENCY_P95_HIGH.
 *
 * Returns triggers as `{ at: ISO, measured: number }` so the UI can plot them.
 */
export interface DryRunInput {
  type: 'USAGE_THRESHOLD' | 'DAILY_LIMIT' | 'ERROR_RATE_HIGH' | 'LATENCY_P95_HIGH'
  threshold: number
  applicationId?: string | null
}

export interface DryRunResult {
  windowDays: number
  triggers: Array<{ at: string; measured: number }>
  /** Highest measured value in the window — helps user pick a sane threshold. */
  peak: { at: string; measured: number } | null
}

interface RequestContext {
  ip?: string
  userAgent?: string
}

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(accountId: string): Promise<AlertSummaryDto[]> {
    const rules = await this.prisma.alertRule.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    })
    return rules.map(toSummary)
  }

  async create(
    accountId: string,
    dto: CreateAlertDto,
    ctx: RequestContext,
  ): Promise<AlertSummaryDto> {
    // Validate optional applicationId belongs to this account.
    if (dto.applicationId) {
      const exists = await this.prisma.application.findFirst({
        where: { id: dto.applicationId, accountId },
        select: { id: true },
      })
      if (!exists) {
        throw new NotFoundException({
          errorCode: 'APPLICATION_NOT_FOUND',
          message: 'Application not found.',
        })
      }
    }

    const created = await this.prisma.alertRule.create({
      data: {
        accountId,
        type: dto.type,
        threshold: dto.threshold,
        applicationId: dto.applicationId ?? null,
        channel: dto.channel ?? 'EMAIL',
        isActive: dto.isActive ?? true,
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'alert.rule_created',
      resource: `alert:${created.id}`,
      metadata: {
        type: created.type,
        threshold: created.threshold,
        applicationId: created.applicationId,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return toSummary(created)
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateAlertDto,
    ctx: RequestContext,
  ): Promise<AlertSummaryDto> {
    const existing = await this.prisma.alertRule.findFirst({
      where: { id, accountId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'ALERT_NOT_FOUND',
        message: 'Alert rule not found.',
      })
    }

    if (dto.applicationId !== undefined && dto.applicationId !== null) {
      const appExists = await this.prisma.application.findFirst({
        where: { id: dto.applicationId, accountId },
        select: { id: true },
      })
      if (!appExists) {
        throw new NotFoundException({
          errorCode: 'APPLICATION_NOT_FOUND',
          message: 'Application not found.',
        })
      }
    }

    const updated = await this.prisma.alertRule.update({
      where: { id },
      data: {
        ...(dto.threshold !== undefined ? { threshold: dto.threshold } : {}),
        ...(dto.applicationId !== undefined ? { applicationId: dto.applicationId } : {}),
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'alert.rule_updated',
      resource: `alert:${id}`,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return toSummary(updated)
  }

  // ---------------------------------------------------------------------------
  // Dry-run / preview
  // ---------------------------------------------------------------------------

  async dryRun(accountId: string, input: DryRunInput): Promise<DryRunResult> {
    const windowDays = 30
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

    const appFilter = input.applicationId
      ? Prisma.sql`AND application_id = ${input.applicationId}::uuid`
      : Prisma.empty

    interface Bucket { bucket: Date; measured: number }
    let rows: Bucket[]

    switch (input.type) {
      case 'USAGE_THRESHOLD': {
        // Cumulative cost per day, in cents.
        rows = await this.prisma.$queryRaw<Bucket[]>`
          SELECT date_trunc('day', created_at) AS bucket,
                 (sum(coalesce(cost_usd, 0)) * 100)::float AS measured
          FROM usage_events
          WHERE account_id = ${accountId}::uuid
            AND created_at >= ${windowStart}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        // Convert to monthly cumulative.
        const cumByMonth = new Map<string, number>()
        rows = rows.map((r) => {
          const monthKey = `${r.bucket.getUTCFullYear()}-${r.bucket.getUTCMonth()}`
          const cum = (cumByMonth.get(monthKey) ?? 0) + r.measured
          cumByMonth.set(monthKey, cum)
          return { bucket: r.bucket, measured: cum }
        })
        break
      }
      case 'DAILY_LIMIT': {
        rows = await this.prisma.$queryRaw<Bucket[]>`
          SELECT date_trunc('day', created_at) AS bucket,
                 (sum(coalesce(cost_usd, 0)) * 100)::float AS measured
          FROM usage_events
          WHERE account_id = ${accountId}::uuid
            AND created_at >= ${windowStart}
            ${appFilter}
          GROUP BY 1 ORDER BY 1
        `
        break
      }
      case 'ERROR_RATE_HIGH': {
        // Hour-bucket error rate in basis points. Skip buckets with <50 reqs.
        rows = await this.prisma.$queryRaw<Bucket[]>`
          SELECT bucket, (errors / GREATEST(total, 1) * 10000)::float AS measured
          FROM (
            SELECT date_trunc('hour', created_at) AS bucket,
                   count(*)::float AS total,
                   count(*) FILTER (WHERE status_code >= 400)::float AS errors
            FROM usage_events
            WHERE account_id = ${accountId}::uuid
              AND created_at >= ${windowStart}
              ${appFilter}
            GROUP BY 1
            HAVING count(*) >= 50
          ) sub
          ORDER BY bucket
        `
        break
      }
      case 'LATENCY_P95_HIGH': {
        rows = await this.prisma.$queryRaw<Bucket[]>`
          SELECT bucket, p95::float AS measured
          FROM (
            SELECT date_trunc('hour', created_at) AS bucket,
                   count(*) AS total,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
            FROM usage_events
            WHERE account_id = ${accountId}::uuid
              AND created_at >= ${windowStart}
              ${appFilter}
            GROUP BY 1
            HAVING count(*) >= 50
          ) sub
          ORDER BY bucket
        `
        break
      }
    }

    // Apply 6h cooldown between triggers (matches evaluator behavior).
    const cooldownMs = 6 * 60 * 60 * 1000
    const triggers: Array<{ at: string; measured: number }> = []
    let lastTrigger = 0
    let peak: { at: string; measured: number } | null = null

    for (const row of rows) {
      const measured = Math.round(row.measured)
      const t = row.bucket.getTime()
      if (!peak || measured > peak.measured) {
        peak = { at: row.bucket.toISOString(), measured }
      }
      if (measured >= input.threshold && t - lastTrigger >= cooldownMs) {
        triggers.push({ at: row.bucket.toISOString(), measured })
        lastTrigger = t
      }
    }

    return { windowDays, triggers, peak }
  }

  async delete(accountId: string, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.alertRule.findFirst({
      where: { id, accountId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'ALERT_NOT_FOUND',
        message: 'Alert rule not found.',
      })
    }
    await this.prisma.alertRule.delete({ where: { id } })
    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'alert.rule_deleted',
      resource: `alert:${id}`,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }
}

function toSummary(rule: {
  id: string
  type: string
  threshold: number
  applicationId: string | null
  channel: string
  isActive: boolean
  lastTriggered: Date | null
  createdAt: Date
  updatedAt: Date
}): AlertSummaryDto {
  return {
    id: rule.id,
    type: rule.type as AlertSummaryDto['type'],
    threshold: rule.threshold,
    applicationId: rule.applicationId,
    channel: rule.channel as AlertSummaryDto['channel'],
    isActive: rule.isActive,
    lastTriggered: rule.lastTriggered,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }
}
