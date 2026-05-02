import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

interface ListAccountsFilter {
  search?: string
  role?: 'USER' | 'ADMIN'
  includeDeleted?: boolean
}

/**
 * AdminService — multi-tenant view of every Account in the system.
 *
 * Auth: AdminGuard on the controller (JWT with role=ADMIN preferred,
 * X-Admin-Key fallback for scripts). Service itself doesn't enforce auth.
 */
@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
}
