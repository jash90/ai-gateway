import { Injectable, Logger } from '@nestjs/common'
import { Prisma, type AuditActorType } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export interface AuditLogPayload {
  /** The Account this event pertains to (null for system-level events). */
  accountId?: string | null
  actorType: AuditActorType
  actorId?: string | null
  /** Stable English action code (see schema.prisma `model AuditLog` for the canonical list). */
  action: string
  /** Optional resource identifier ("application:<uuid>", "key:<uuid>", ...). */
  resource?: string | null
  metadata?: Prisma.InputJsonValue
  ipAddress?: string
  userAgent?: string
}

/**
 * AuditLogService — thin wrapper around prisma.auditLog.create.
 *
 * Two flush modes:
 *
 *   - log()         : synchronous insert. Throws on DB failure. Use for
 *                     security-sensitive events (login, key creation, etc.)
 *                     where lost rows would matter.
 *
 *   - logBackground(): fire-and-forget via setImmediate. Errors are swallowed
 *                     into a Logger warn. Use for hot-path events that
 *                     happen per request (`provider_key.encrypted/decrypted`)
 *                     where dropping rows on DB outage is preferable to
 *                     blocking the request.
 *
 * In Sprint 2 the background flusher migrates to a BullMQ queue (`audit-log`)
 * for batching and survival across process restarts.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private prisma: PrismaService) {}

  async log(payload: AuditLogPayload): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        accountId: payload.accountId ?? null,
        actorType: payload.actorType,
        actorId: payload.actorId ?? null,
        action: payload.action,
        resource: payload.resource ?? null,
        metadata: payload.metadata ?? Prisma.JsonNull,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
      },
    })
  }

  logBackground(payload: AuditLogPayload): void {
    setImmediate(() => {
      this.log(payload).catch((err) => {
        this.logger.warn(
          `Background audit log failed for action=${payload.action}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      })
    })
  }

  async getLogs(filters: {
    accountId?: string
    action?: string
    from?: Date
    to?: Date
    page?: number
    limit?: number
  }) {
    const { page = 1, limit = 25 } = filters

    const where: Prisma.AuditLogWhereInput = {
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? { createdAt: { gte: filters.from, lte: filters.to } }
        : {}),
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ])

    return { logs, total, page, limit }
  }
}

