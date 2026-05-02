import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { AccountDeletionService } from '../auth/services/account-deletion.service'

const COOLING_OFF_DAYS = 30

/**
 * Cooling-off worker — promotes soft-deleted accounts to hard-deleted (GDPR
 * erasure) after 30 days. Runs daily at 04:00 UTC, after audit retention.
 *
 * Window:
 *   - Account.deletedAt < now - 30 days  AND
 *   - Account.email NOT LIKE 'anonymized+%@deleted.local'  (skip already-anonymized)
 *
 * Per row, calls AccountDeletionService.hardDelete(). If the user comes back
 * during cooling-off, they need a support intervention to restore (we don't
 * surface a self-serve "undelete" — too easy to accidentally undo a real GDPR
 * request).
 */
@Injectable()
export class AccountCoolingOffService {
  private readonly logger = new Logger(AccountCoolingOffService.name)

  constructor(
    private prisma: PrismaService,
    private deletionService: AccountDeletionService,
  ) {}

  @Cron('0 4 * * *', { name: 'account-cooling-off' })
  async sweep(): Promise<{ promoted: number }> {
    const cutoff = new Date(Date.now() - COOLING_OFF_DAYS * 24 * 60 * 60 * 1000)

    const candidates = await this.prisma.account.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
        // Skip already-anonymized rows.
        email: { not: { startsWith: 'anonymized+' } },
      },
      select: { id: true },
    })

    let promoted = 0
    for (const { id } of candidates) {
      try {
        await this.deletionService.hardDelete(id, {})
        promoted++
      } catch (err) {
        this.logger.error(
          `Failed to hard-delete account ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    if (promoted > 0) {
      this.logger.log(`Cooling-off sweep: promoted ${promoted} accounts to hard-delete`)
    }
    return { promoted }
  }
}
