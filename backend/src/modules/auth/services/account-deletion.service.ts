import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'

interface RequestContext {
  ip?: string
  userAgent?: string
}

/**
 * Soft + hard delete for Accounts.
 *
 * Two modes:
 *   - softDelete()  : mark deletedAt, rename email, revoke ApplicationKeys + RefreshTokens.
 *                     Keeps PII for 30 days (cooling-off — user can restore via support).
 *                     Default exit path for `DELETE /v1/auth/account`.
 *
 *   - hardDelete()  : GDPR erasure. Anonymize PII (email/name/passwordHash → null/sentinel),
 *                     scrub UsageEvent.metadata, delete UserProviderKey/WebhookConfig/AlertRule.
 *                     KEEPS UsageEvent rows (account_id stays) for accounting integrity.
 *                     Triggered by AccountCoolingOffWorker after 30 days OR explicit `?mode=hard`.
 *
 * Restrict FK guard: usage_events block raw `prisma.account.delete()`. We never call that —
 * hard-delete only nullifies PII; the row stays.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Soft delete
  // ---------------------------------------------------------------------------

  async softDelete(accountId: string, ctx: RequestContext): Promise<void> {
    // accountRaw bypasses the soft-delete filter so we can find an already-
    // soft-deleted row (re-deletion is a no-op; hard-delete needs the row).
    const account = await this.prisma.accountRaw.findUnique({ where: { id: accountId } })
    if (!account || account.deletedAt) {
      // Idempotent: already deleted = no-op.
      return
    }

    const now = new Date()
    // Rename email so the address can be reused for fresh registration.
    // Format keeps the original ID searchable for support.
    const renamedEmail = `deleted+${account.id}@deleted.local`

    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: accountId },
        data: { deletedAt: now, email: renamedEmail, isActive: false },
      }),
      // Revoke all application keys atomically.
      this.prisma.applicationKey.updateMany({
        where: {
          revokedAt: null,
          application: { accountId },
        },
        data: { revokedAt: now },
      }),
      // Revoke all refresh tokens (RefreshToken cascades on hard-delete, but
      // soft-delete needs explicit revocation).
      this.prisma.refreshToken.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ])

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'account.soft_deleted',
      metadata: {
        originalEmail: account.email,
        coolingOffEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    this.logger.log(`Soft-deleted account ${accountId} (cooling off until +30d)`)
  }

  // ---------------------------------------------------------------------------
  // Hard delete (GDPR erasure)
  // ---------------------------------------------------------------------------

  async hardDelete(accountId: string, ctx: RequestContext): Promise<void> {
    // accountRaw bypasses the soft-delete filter so we can find an already-
    // soft-deleted row (re-deletion is a no-op; hard-delete needs the row).
    const account = await this.prisma.accountRaw.findUnique({ where: { id: accountId } })
    if (!account) return

    const now = new Date()

    // Run anonymization in one transaction. UsageEvent rows stay (Restrict FK)
    // but lose PII via metadata scrub. We deliberately don't anonymize
    // `account_id` itself — accounting aggregates need stable grouping.
    await this.prisma.$transaction(async (tx) => {
      // 1. Drop tables that cascade or contain plaintext secrets.
      await tx.userProviderKey.deleteMany({ where: { accountId } })
      await tx.webhookConfig.deleteMany({ where: { accountId } })
      await tx.alertRule.deleteMany({ where: { accountId } })
      // RefreshToken + EmailToken cascade automatically when we update Account.

      // 2. Scrub PII from UsageEvent.metadata. Keep stable row IDs + numeric data.
      await tx.usageEvent.updateMany({
        where: { accountId },
        data: { metadata: Prisma.JsonNull, requestId: null },
      })

      // 3. Anonymize Application names (could leak business intent).
      const apps = await tx.application.findMany({
        where: { accountId },
        select: { id: true },
      })
      for (const app of apps) {
        await tx.application.update({
          where: { id: app.id },
          data: { name: `deleted-app-${app.id.slice(0, 8)}`, description: null },
        })
      }

      // 4. Scrub EndUser.externalId (it might be a real user identifier).
      // applicationId is preserved; FK on UsageEvent stays valid.
      const endUsers = await tx.endUser.findMany({
        where: { application: { accountId } },
        select: { id: true },
      })
      for (const eu of endUsers) {
        await tx.endUser.update({
          where: { id: eu.id },
          data: { externalId: `anon-${eu.id.slice(0, 8)}`, metadata: Prisma.JsonNull },
        })
      }

      // 5. Anonymize Account itself. Email becomes a sentinel using the ID
      // so we can't reverse-lookup but support can still trace.
      await tx.account.update({
        where: { id: accountId },
        data: {
          email: `anonymized+${accountId}@deleted.local`,
          name: null,
          // passwordHash: replace with random unmatched string (not empty — argon2 verify
          // would silently succeed on bad input).
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$ANONYMIZED$ANONYMIZED',
          isActive: false,
          deletedAt: account.deletedAt ?? now,
        },
      })
    })

    await this.audit.log({
      accountId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'account.hard_deleted',
      metadata: {
        // Original email NOT logged — it's PII we just removed.
        originalDeletedAt: account.deletedAt?.toISOString() ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    this.logger.warn(`GDPR hard-delete completed for account ${accountId}`)
  }
}
