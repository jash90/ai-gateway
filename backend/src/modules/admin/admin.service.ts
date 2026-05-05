import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type Account } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { PasswordService } from '../auth/services/password.service'
import { AuditService } from '../audit/audit.service'

interface ListAccountsFilter {
  search?: string
  role?: 'USER' | 'ADMIN'
  includeDeleted?: boolean
}

interface AdminContext {
  actorId: string
  ipAddress?: string
  userAgent?: string
}

/**
 * AdminService — multi-tenant view + account CRUD for the gateway operator.
 *
 * Auth: AdminGuard on the controller (JWT with role=ADMIN preferred,
 * X-Admin-Key fallback for scripts). Service itself doesn't enforce auth.
 */
@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private passwordService: PasswordService,
    private audit: AuditService,
  ) {}

  async listAccounts(filter: ListAccountsFilter) {
    const where: Prisma.AccountWhereInput = {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.includeDeleted ? {} : { deletedAt: null }),
      ...(filter.search
        ? {
            OR: [
              { email: { contains: filter.search, mode: 'insensitive' } },
              { name: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    // Always use accountRaw so the explicit `deletedAt` clause above is the
    // only filter. The auto-filter on `this.account` would otherwise hide
    // deleted rows even when admins set `includeDeleted: true`.
    const accounts = await this.prisma.accountRaw.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            applications: true,
            providerKeys: true,
            usageEvents: true,
          },
        },
      },
    })

    if (accounts.length === 0) {
      return { accounts: [], total: 0 }
    }

    const accountIds = accounts.map((a) => a.id)

    // Active keys count and 30-day cost — separate queries to keep the main
    // findMany simple. Both indexed.
    const [activeKeyCounts, costRows] = await Promise.all([
      this.prisma.applicationKey.groupBy({
        by: ['applicationId'],
        where: {
          revokedAt: null,
          application: { accountId: { in: accountIds } },
        },
        _count: { _all: true },
      }),
      this.prisma.usageEvent.groupBy({
        by: ['accountId'],
        where: {
          accountId: { in: accountIds },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { costUsd: true },
      }),
    ])

    // Roll up active keys per account via Application → Account map.
    const apps = await this.prisma.application.findMany({
      where: { accountId: { in: accountIds } },
      select: { id: true, accountId: true },
    })
    const appToAccount = new Map(apps.map((a) => [a.id, a.accountId]))

    const activeKeysByAccount = new Map<string, number>()
    for (const row of activeKeyCounts) {
      const accId = appToAccount.get(row.applicationId)
      if (accId) {
        activeKeysByAccount.set(accId, (activeKeysByAccount.get(accId) ?? 0) + row._count._all)
      }
    }

    const costByAccount = new Map(
      costRows.map((r) => [r.accountId, r._sum.costUsd ? Number(r._sum.costUsd) : 0]),
    )

    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.name,
        role: a.role,
        emailVerified: a.emailVerified,
        isActive: a.isActive,
        deletedAt: a.deletedAt,
        createdAt: a.createdAt,
        applicationsCount: a._count.applications,
        activeKeysCount: activeKeysByAccount.get(a.id) ?? 0,
        providerKeysCount: a._count.providerKeys,
        usageEventsCount: a._count.usageEvents,
        totalCostUsdLast30d: costByAccount.get(a.id) ?? 0,
      })),
      total: accounts.length,
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations: create / update / soft-delete
  // ---------------------------------------------------------------------------

  async createAccount(
    input: {
      email: string
      password: string
      name?: string | null
      role: 'USER' | 'ADMIN'
      emailVerified: boolean
    },
    ctx: AdminContext,
  ): Promise<Account> {
    const existing = await this.prisma.accountRaw.findUnique({
      where: { email: input.email },
    })
    if (existing) {
      throw new ConflictException({
        errorCode: 'EMAIL_ALREADY_REGISTERED',
        message: 'This email address is already registered.',
      })
    }

    const passwordHash = await this.passwordService.hash(input.password)
    const account = await this.prisma.account.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name?.trim() || null,
        role: input.role,
        emailVerified: input.emailVerified,
      },
    })

    await this.audit.log({
      accountId: account.id,
      actorType: 'ADMIN',
      actorId: ctx.actorId,
      action: 'admin.account.created',
      resource: `account:${account.id}`,
      metadata: { email: input.email, role: input.role, emailVerified: input.emailVerified },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return account
  }

  async updateAccount(
    id: string,
    input: {
      name?: string | null
      role?: 'USER' | 'ADMIN'
      isActive?: boolean
      emailVerified?: boolean
      newPassword?: string
    },
    ctx: AdminContext,
  ): Promise<Account> {
    const existing = await this.prisma.accountRaw.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
    }
    if (existing.deletedAt) {
      throw new ConflictException({
        message: 'Account is soft-deleted; restore not implemented.',
        code: 'ACCOUNT_DELETED',
      })
    }

    const data: Prisma.AccountUpdateInput = {}
    const auditChanges: Record<string, string | number | boolean | null> = {}

    if (input.name !== undefined) {
      const next = input.name?.trim() || null
      data.name = next
      auditChanges.name = next
    }
    if (input.role !== undefined) {
      data.role = input.role
      auditChanges.role = input.role
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive
      auditChanges.isActive = input.isActive
    }
    if (input.emailVerified !== undefined) {
      data.emailVerified = input.emailVerified
      auditChanges.emailVerified = input.emailVerified
    }
    if (input.newPassword) {
      data.passwordHash = await this.passwordService.hash(input.newPassword)
      auditChanges.passwordReset = true
    }

    const account = await this.prisma.account.update({ where: { id }, data })

    // When suspending, revoke all refresh tokens so the user is forced out.
    if (input.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: { accountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      auditChanges.refreshTokensRevoked = true
    }

    await this.audit.log({
      accountId: id,
      actorType: 'ADMIN',
      actorId: ctx.actorId,
      action: 'admin.account.updated',
      resource: `account:${id}`,
      metadata: auditChanges,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return account
  }

  async softDeleteAccount(id: string, ctx: AdminContext): Promise<Account> {
    const existing = await this.prisma.accountRaw.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
    }
    if (existing.deletedAt) {
      return existing
    }
    if (existing.role === 'ADMIN' && existing.id === ctx.actorId) {
      throw new ConflictException({
        message: 'Admins cannot delete themselves.',
        code: 'CANNOT_DELETE_SELF',
      })
    }

    // Soft-delete pattern (matches AccountDeletionService convention):
    //   - rename email so the original is reusable
    //   - set deletedAt + isActive=false
    //   - revoke all refresh tokens + application keys
    const renamedEmail = `deleted+${id}@deleted.local`
    const [account] = await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id },
        data: {
          email: renamedEmail,
          isActive: false,
          deletedAt: new Date(),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { accountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.applicationKey.updateMany({
        where: { application: { accountId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])

    await this.audit.log({
      accountId: id,
      actorType: 'ADMIN',
      actorId: ctx.actorId,
      action: 'admin.account.soft_deleted',
      resource: `account:${id}`,
      metadata: { originalEmail: existing.email },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return account
  }

  /**
   * Hydrate a single Account into the same shape `listAccounts` returns —
   * used by the create/update endpoints so the controller can echo the row.
   */
  async hydrateAccountSummary(id: string) {
    const acc = await this.prisma.accountRaw.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            applications: true,
            providerKeys: true,
            usageEvents: true,
          },
        },
      },
    })
    if (!acc) {
      throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
    }

    const [activeKeys, costAgg] = await Promise.all([
      this.prisma.applicationKey.count({
        where: { revokedAt: null, application: { accountId: id } },
      }),
      this.prisma.usageEvent.aggregate({
        where: {
          accountId: id,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _sum: { costUsd: true },
      }),
    ])

    return {
      id: acc.id,
      email: acc.email,
      name: acc.name,
      role: acc.role,
      emailVerified: acc.emailVerified,
      isActive: acc.isActive,
      deletedAt: acc.deletedAt,
      createdAt: acc.createdAt,
      applicationsCount: acc._count.applications,
      activeKeysCount: activeKeys,
      providerKeysCount: acc._count.providerKeys,
      usageEventsCount: acc._count.usageEvents,
      totalCostUsdLast30d: costAgg._sum.costUsd ? Number(costAgg._sum.costUsd) : 0,
    }
  }
}
