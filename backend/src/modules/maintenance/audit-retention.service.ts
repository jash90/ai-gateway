import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Audit retention worker — runs daily at 03:15 UTC.
 *
 * Two retention windows (per decision D-010):
 *   - 90 days for hot-path BYOK events (`provider_key.encrypted`,
 *     `provider_key.decrypted`) — these grow at request rate.
 *   - 2 years for everything else (security-sensitive: logins, key CRUD,
 *     password changes, admin actions).
 *
 * Uses BRIN index on audit_logs.created_at (added in
 * 20260501224315_add_brin_indexes migration) for the range scan.
 *
 * Idempotent — re-running is a no-op if nothing matches the cutoff.
 */
@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name)

  private static readonly HOT_PATH_ACTIONS = [
    'provider_key.encrypted',
    'provider_key.decrypted',
  ]
  private static readonly HOT_PATH_RETENTION_DAYS = 90
  private static readonly DEFAULT_RETENTION_DAYS = 2 * 365

  constructor(private prisma: PrismaService) {}

  // Runs once a day at 03:15 server-local time — quiet hours.
  @Cron('15 3 * * *', { name: 'audit-retention' })
  async sweep(): Promise<{ hotPathDeleted: number; defaultDeleted: number }> {
    const hotCutoff = new Date(
      Date.now() - AuditRetentionService.HOT_PATH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    const defaultCutoff = new Date(
      Date.now() - AuditRetentionService.DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )

    const hotPathDeleted = await this.prisma.auditLog
      .deleteMany({
        where: {
          createdAt: { lt: hotCutoff },
          action: { in: AuditRetentionService.HOT_PATH_ACTIONS },
        },
      })
      .then((r) => r.count)
      .catch((err) => {
        this.logger.error(`Hot-path retention sweep failed: ${formatErr(err)}`)
        return 0
      })

    const defaultDeleted = await this.prisma.auditLog
      .deleteMany({
        where: {
          createdAt: { lt: defaultCutoff },
          action: { notIn: AuditRetentionService.HOT_PATH_ACTIONS },
        },
      })
      .then((r) => r.count)
      .catch((err) => {
        this.logger.error(`Default retention sweep failed: ${formatErr(err)}`)
        return 0
      })

    if (hotPathDeleted > 0 || defaultDeleted > 0) {
      this.logger.log(
        `Audit retention sweep: deleted ${hotPathDeleted} hot-path + ${defaultDeleted} long-term rows`,
      )
    }
    return { hotPathDeleted, defaultDeleted }
  }
}

// Suppress the unused CronExpression import warning by re-exporting it for
// downstream maintenance services that want to use the named constants.
export { CronExpression as MaintenanceCron }

function formatErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
