import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { WebhooksService } from '../webhooks/webhooks.service'
import { EmailsService } from '../emails/emails.service'

const COOLDOWN_HOURS = 6

/**
 * AlertsEvaluatorService — periodic background sweep that evaluates active
 * AlertRules against recent UsageEvent data and dispatches notifications via
 * email/webhook channels.
 *
 * Runs every 15 minutes. Evaluation windows per rule type:
 *   - USAGE_THRESHOLD  → cumulative cost in current calendar month
 *   - DAILY_LIMIT      → cumulative cost in last 24h
 *   - ERROR_RATE_HIGH  → error rate over last 1h (min 50 requests for stability)
 *   - LATENCY_P95_HIGH → p95 over last 1h (min 50 requests)
 *
 * Cooldown: a rule that fires won't fire again for 6h (lastTriggered guard).
 * Prevents spamming on persistent issues. User can mute by setting isActive=false.
 */
@Injectable()
export class AlertsEvaluatorService {
  private readonly logger = new Logger(AlertsEvaluatorService.name)

  constructor(
    private prisma: PrismaService,
    private webhooks: WebhooksService,
    private emails: EmailsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'alerts-evaluation' })
  async sweep(): Promise<{ evaluated: number; triggered: number }> {
    const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000)

    const rules = await this.prisma.alertRule.findMany({
      where: {
        isActive: true,
        OR: [{ lastTriggered: null }, { lastTriggered: { lt: cooldownCutoff } }],
      },
      include: { account: { select: { email: true } } },
    })

    let triggered = 0
    for (const rule of rules) {
      try {
        const fired = await this.evaluateRule(rule)
        if (fired) triggered++
      } catch (err) {
        this.logger.error(
          `Evaluator failed for rule ${rule.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    if (triggered > 0) {
      this.logger.log(`Alert sweep: evaluated ${rules.length}, triggered ${triggered}`)
    }
    return { evaluated: rules.length, triggered }
  }

  private async evaluateRule(rule: {
    id: string
    accountId: string
    type: string
    threshold: number
    applicationId: string | null
    channel: string
    account: { email: string }
  }): Promise<boolean> {
    const baseWhere: Prisma.UsageEventWhereInput = {
      accountId: rule.accountId,
      ...(rule.applicationId ? { applicationId: rule.applicationId } : {}),
    }

    let measured: number
    let measureUnit: string

    switch (rule.type) {
      case 'USAGE_THRESHOLD': {
        // Cost in current calendar month, in cents.
        const startOfMonth = new Date()
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        const agg = await this.prisma.usageEvent.aggregate({
          where: { ...baseWhere, createdAt: { gte: startOfMonth } },
          _sum: { costUsd: true },
        })
        measured = Math.round((Number(agg._sum.costUsd ?? 0)) * 100)
        measureUnit = 'cents (cost MTD)'
        break
      }
      case 'DAILY_LIMIT': {
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const agg = await this.prisma.usageEvent.aggregate({
          where: { ...baseWhere, createdAt: { gte: last24h } },
          _sum: { costUsd: true },
        })
        measured = Math.round((Number(agg._sum.costUsd ?? 0)) * 100)
        measureUnit = 'cents (cost 24h)'
        break
      }
      case 'ERROR_RATE_HIGH': {
        const last1h = new Date(Date.now() - 60 * 60 * 1000)
        const [total, errors] = await Promise.all([
          this.prisma.usageEvent.count({ where: { ...baseWhere, createdAt: { gte: last1h } } }),
          this.prisma.usageEvent.count({
            where: { ...baseWhere, createdAt: { gte: last1h }, statusCode: { gte: 400 } },
          }),
        ])
        if (total < 50) return false // not enough samples
        measured = Math.round((errors / total) * 10_000) // basis points
        measureUnit = 'bps (error rate 1h)'
        break
      }
      case 'LATENCY_P95_HIGH': {
        const last1h = new Date(Date.now() - 60 * 60 * 1000)
        const total = await this.prisma.usageEvent.count({
          where: { ...baseWhere, createdAt: { gte: last1h } },
        })
        if (total < 50) return false
        const result = await this.prisma.$queryRaw<Array<{ p95: number | null }>>`
          SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95
          FROM usage_events
          WHERE account_id = ${rule.accountId}
            AND created_at >= ${last1h}
            ${rule.applicationId
              ? Prisma.sql`AND application_id = ${rule.applicationId}`
              : Prisma.empty}
        `
        measured = Math.round(result[0]?.p95 ?? 0)
        measureUnit = 'ms (p95 latency 1h)'
        break
      }
      default:
        return false
    }

    if (measured < rule.threshold) return false

    // Fire — record + dispatch.
    await this.prisma.alertRule.update({
      where: { id: rule.id },
      data: { lastTriggered: new Date() },
    })

    const payload = {
      ruleId: rule.id,
      type: rule.type,
      threshold: rule.threshold,
      measured,
      measureUnit,
      applicationId: rule.applicationId,
      triggeredAt: new Date().toISOString(),
    }

    if (rule.channel === 'WEBHOOK' || rule.channel === 'BOTH') {
      await this.webhooks.dispatch({
        accountId: rule.accountId,
        event: 'alert.triggered',
        payload,
      })
    }
    if (rule.channel === 'EMAIL' || rule.channel === 'BOTH') {
      try {
        await this.emails.sendDirect(
          rule.account.email,
          `Alert wyzwolony: ${rule.type}`,
          renderAlertEmail(rule.type, rule.threshold, measured, measureUnit),
        )
      } catch {
        // email failure non-fatal
      }
    }

    return true
  }
}

function renderAlertEmail(
  type: string,
  threshold: number,
  measured: number,
  unit: string,
): string {
  return `<p>Alert <strong>${type}</strong> przekroczył próg <code>${threshold}</code>.</p>
<p>Pomiar: <strong>${measured}</strong> ${unit}</p>
<p>Sprawdź panel: <a href="https://api.raccoon.dev/dashboard/settings/alerts">Alerty</a></p>`
}
