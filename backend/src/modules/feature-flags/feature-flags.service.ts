import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type FeatureFlag } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

interface CacheEntry {
  enabled: boolean
  payload: unknown | null
  expiresAt: number
}

/**
 * FeatureFlagsService — runtime toggle resolver (M1).
 *
 * Resolution order in `isEnabled(key, accountId?)`:
 *   1. Per-account override row (scope='account', accountId=<uuid>)
 *   2. Global row (scope='global', accountId=null)
 *   3. Env default (FEATURE_<KEY_UPPERCASE_WITH_UNDERSCORES>=true|false)
 *   4. Hardcoded fallback (false unless override passed)
 *
 * Cache: 60s in-memory keyed by `${key}::${accountId ?? 'global'}`. CRUD methods
 * invalidate keys synchronously; in M4+ a Redis pub/sub broadcast handles
 * multi-replica invalidation (mirror cost-calculator pattern).
 */
@Injectable()
export class FeatureFlagsService {
  private readonly cache = new Map<string, CacheEntry>()
  private static readonly TTL_MS = 60_000

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  /**
   * Returns whether the flag is enabled for the given accountId (or globally
   * if no accountId is passed).
   */
  async isEnabled(key: string, accountId?: string): Promise<boolean> {
    const value = await this.resolve(key, accountId)
    return value.enabled
  }

  /**
   * Returns both `enabled` and `payload` (e.g. threshold values, A/B variant).
   */
  async resolve(
    key: string,
    accountId?: string,
  ): Promise<{ enabled: boolean; payload: unknown | null; source: 'account' | 'global' | 'env' | 'fallback' }> {
    const cacheKey = `${key}::${accountId ?? 'global'}`
    const now = Date.now()
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return { enabled: cached.enabled, payload: cached.payload, source: 'account' }
    }

    // 1. per-account override
    if (accountId) {
      const acct = await this.prisma.featureFlag.findUnique({
        where: { key_accountId: { key, accountId } },
      })
      if (acct) {
        this.cache.set(cacheKey, { enabled: acct.enabled, payload: acct.payload, expiresAt: now + FeatureFlagsService.TTL_MS })
        return { enabled: acct.enabled, payload: acct.payload, source: 'account' }
      }
    }

    // 2. global row
    const global = await this.prisma.featureFlag.findFirst({
      where: { key, scope: 'global', accountId: null },
    })
    if (global) {
      this.cache.set(cacheKey, { enabled: global.enabled, payload: global.payload, expiresAt: now + FeatureFlagsService.TTL_MS })
      return { enabled: global.enabled, payload: global.payload, source: 'global' }
    }

    // 3. env default
    const envKey = `FEATURE_${key.toUpperCase().replace(/[.-]/g, '_')}`
    const envVal = this.config.get<string>(envKey)
    if (envVal !== undefined) {
      const enabled = envVal === 'true' || envVal === '1'
      this.cache.set(cacheKey, { enabled, payload: null, expiresAt: now + FeatureFlagsService.TTL_MS })
      return { enabled, payload: null, source: 'env' }
    }

    // 4. fallback
    this.cache.set(cacheKey, { enabled: false, payload: null, expiresAt: now + FeatureFlagsService.TTL_MS })
    return { enabled: false, payload: null, source: 'fallback' }
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  async list(filter: { scope?: 'global' | 'account'; accountId?: string; key?: string }): Promise<{ flags: FeatureFlag[]; total: number }> {
    const where = {
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
      ...(filter.key ? { key: filter.key } : {}),
    }
    const [flags, total] = await Promise.all([
      this.prisma.featureFlag.findMany({ where, orderBy: [{ key: 'asc' }, { scope: 'asc' }] }),
      this.prisma.featureFlag.count({ where }),
    ])
    return { flags, total }
  }

  async upsert(
    dto: { key: string; scope: 'global' | 'account'; accountId?: string | null; enabled: boolean; payload?: Record<string, unknown> | null },
    actor: { actorId: string; actorType: 'ADMIN' | 'SYSTEM' },
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<FeatureFlag> {
    const accountId = dto.scope === 'account' ? dto.accountId! : null
    const payload = dto.payload ? (dto.payload as Prisma.InputJsonValue) : Prisma.JsonNull

    // Prisma rejects null in compound-unique upsert (`where: { key_accountId: { ..., accountId: null } }`).
    // Manual upsert: find existing, then update or create.
    const existing = await this.prisma.featureFlag.findFirst({
      where: { key: dto.key, accountId },
    })
    const flag = existing
      ? await this.prisma.featureFlag.update({
          where: { id: existing.id },
          data: { enabled: dto.enabled, payload, scope: dto.scope },
        })
      : await this.prisma.featureFlag.create({
          data: {
            key: dto.key,
            scope: dto.scope,
            accountId,
            enabled: dto.enabled,
            payload,
          },
        })

    this.invalidate(dto.key, accountId)

    await this.audit.log({
      accountId: accountId ?? null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'feature_flag.upserted',
      resource: `feature_flag:${flag.id}`,
      metadata: { key: dto.key, scope: dto.scope, enabled: dto.enabled },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return flag
  }

  async delete(
    id: string,
    actor: { actorId: string; actorType: 'ADMIN' },
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { id } })
    if (!flag) return
    await this.prisma.featureFlag.delete({ where: { id } })
    this.invalidate(flag.key, flag.accountId)

    await this.audit.log({
      accountId: flag.accountId ?? null,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'feature_flag.deleted',
      resource: `feature_flag:${id}`,
      metadata: { key: flag.key, scope: flag.scope },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })
  }

  // ---------------------------------------------------------------------------
  // Cache invalidation (M4 will broadcast via Redis pub/sub)
  // ---------------------------------------------------------------------------

  private invalidate(key: string, accountId: string | null): void {
    if (accountId) {
      this.cache.delete(`${key}::${accountId}`)
    } else {
      // global toggle affects every cached scope for this key
      for (const k of this.cache.keys()) {
        if (k.startsWith(`${key}::`)) this.cache.delete(k)
      }
    }
  }
}
