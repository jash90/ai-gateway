import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import type { Application } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { WebhooksService } from '../webhooks/webhooks.service'
import type {
  CreateApplicationDto,
  UpdateApplicationDto,
  ApplicationSummary,
  ApplicationDetail,
} from './dto/applications.dto'

interface RequestContext {
  ip?: string
  userAgent?: string
}

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(accountId: string, includeInactive: boolean): Promise<ApplicationSummary[]> {
    const apps = await this.prisma.application.findMany({
      where: {
        accountId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'desc' },
    })
    return apps.map(toSummary)
  }

  async getById(accountId: string, id: string): Promise<ApplicationDetail> {
    const app = await this.prisma.application.findFirst({
      where: { id, accountId },
      include: {
        _count: {
          select: {
            keys: true,
          },
        },
      },
    })
    if (!app) {
      // 404 instead of 403 — don't leak that the app exists for someone else.
      throw new NotFoundException({
        errorCode: 'APPLICATION_NOT_FOUND',
        message: 'Application not found.',
      })
    }

    const [activeKeysCount, lastUsage] = await Promise.all([
      this.prisma.applicationKey.count({
        where: { applicationId: id, revokedAt: null },
      }),
      this.prisma.usageEvent.findFirst({
        where: { applicationId: id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    return {
      ...toSummary(app),
      keysCount: app._count.keys,
      activeKeysCount,
      lastUsageAt: lastUsage?.createdAt ?? null,
    }
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(
    accountId: string,
    dto: CreateApplicationDto,
    ctx: RequestContext,
  ): Promise<ApplicationSummary> {
    const app = await this.prisma.application.create({
      data: {
        accountId,
        name: dto.name,
        description: dto.description ?? null,
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'application.created',
      resource: `application:${app.id}`,
      metadata: { name: app.name },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    void this.webhooks.dispatch({
      accountId,
      event: 'application.created',
      payload: { applicationId: app.id, name: app.name, description: app.description },
    })

    return toSummary(app)
  }

  async update(
    accountId: string,
    id: string,
    dto: UpdateApplicationDto,
    ctx: RequestContext,
  ): Promise<ApplicationSummary> {
    const existing = await this.prisma.application.findFirst({
      where: { id, accountId },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'APPLICATION_NOT_FOUND',
        message: 'Application not found.',
      })
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'application.updated',
      resource: `application:${id}`,
      metadata: dto as Prisma.InputJsonValue,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return toSummary(updated)
  }

  async delete(accountId: string, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.application.findFirst({
      where: { id, accountId },
      select: { id: true, name: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'APPLICATION_NOT_FOUND',
        message: 'Application not found.',
      })
    }

    try {
      // Cascade deletes ApplicationKey rows (per schema). Restrict on UsageEvent
      // → Postgres throws FK violation if any usage rows exist.
      await this.prisma.application.delete({ where: { id } })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003' // FK constraint failed (Restrict on UsageEvent)
      ) {
        throw new ConflictException({
          errorCode: 'APPLICATION_HAS_USAGE',
          message:
            'Cannot delete this application — it has recorded usage events. ' +
            'Disable it instead (PATCH isActive=false).',
        })
      }
      throw err
    }

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'application.deleted',
      resource: `application:${id}`,
      metadata: { name: existing.name },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    void this.webhooks.dispatch({
      accountId,
      event: 'application.deleted',
      payload: { applicationId: id, name: existing.name },
    })
  }
}

// =============================================================================
// Helpers
// =============================================================================

function toSummary(app: Application): ApplicationSummary {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    isActive: app.isActive,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}
