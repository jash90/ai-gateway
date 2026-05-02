import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * Resolves or creates an EndUser row for a given (applicationId, externalId)
 * pair. Used to attribute usage to a specific user of the customer's app.
 *
 * The customer passes `x-rcn-end-user: <opaque-id>` header on each gateway
 * request. We upsert an EndUser row keyed by that ID.
 *
 * Best-effort: if the upsert fails (race condition, FK violation), we return
 * null and the UsageEvent is recorded without endUserId. Attribution is a
 * nice-to-have, not a hard requirement.
 */
@Injectable()
export class EndUserResolverService {
  constructor(private prisma: PrismaService) {}

  async resolve(
    applicationId: string,
    externalId: string | null | undefined,
  ): Promise<string | null> {
    if (!externalId) return null
    const trimmed = externalId.trim()
    if (!trimmed) return null
    if (trimmed.length > 256) {
      // Reject obvious abuse — externalId should be a short opaque ID, not a payload.
      return null
    }

    try {
      const row = await this.prisma.endUser.upsert({
        where: { applicationId_externalId: { applicationId, externalId: trimmed } },
        create: { applicationId, externalId: trimmed },
        update: {}, // touch-only; updatedAt bumps automatically
        select: { id: true },
      })
      return row.id
    } catch {
      return null
    }
  }
}
