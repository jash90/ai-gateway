import { Injectable, ForbiddenException, Inject } from '@nestjs/common'
import type Redis from 'ioredis'
import type { ProviderType } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { EncryptionService } from '../../crypto/encryption.service'

/**
 * Resolves the plaintext BYOK key for a given (account, provider) pair.
 *
 * Caches the plaintext in Redis for 60 seconds to avoid argon2id-decrypt on
 * every chunk of a long stream. Cache key includes the provider; TTL is short
 * enough that revocation by deleting the row in DB takes effect within 1 min.
 *
 * Cache key shape:  `byok:{accountId}:{provider}`
 * Cache value:      the plaintext key (base64-encoded for binary safety)
 *
 * The Redis-cached plaintext is encrypted at the masterek level (TLS to Redis,
 * Redis AUTH); for higher-security envs, swap this for a memory-only LRU.
 */
@Injectable()
export class ByokKeyResolverService {
  private static readonly CACHE_TTL_SECONDS = 60
  private static readonly CACHE_PREFIX = 'byok'

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    @Inject('REDIS') private redis: Redis,
  ) {}

  async resolve(
    accountId: string,
    provider: ProviderType,
    requestCtx: { requestId?: string; model?: string },
  ): Promise<string> {
    const cacheKey = `${ByokKeyResolverService.CACHE_PREFIX}:${accountId}:${provider}`
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      return Buffer.from(cached, 'base64').toString('utf8')
    }

    const row = await this.prisma.userProviderKey.findUnique({
      where: { accountId_provider: { accountId, provider } },
    })

    if (!row) {
      throw new ForbiddenException({
        errorCode: 'PROVIDER_KEY_NOT_CONFIGURED',
        message:
          `No ${provider} key configured for this account. ` +
          `Add one in Settings → Provider Keys.`,
      })
    }

    const plaintext = await this.encryption.decrypt(row.encryptedKey, row.encryptionKeyId, {
      accountId,
      keyId: row.id,
      provider,
      requestId: requestCtx.requestId,
      model: requestCtx.model,
    })

    // Bump lastUsedAt for analytics (best-effort).
    void this.prisma.userProviderKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)

    await this.redis.set(
      cacheKey,
      Buffer.from(plaintext, 'utf8').toString('base64'),
      'EX',
      ByokKeyResolverService.CACHE_TTL_SECONDS,
    )

    return plaintext
  }

  /**
   * Invalidate cache when a user updates / deletes their provider key.
   * Called by ProviderKeysService.create/delete.
   */
  async invalidate(accountId: string, provider: ProviderType): Promise<void> {
    const cacheKey = `${ByokKeyResolverService.CACHE_PREFIX}:${accountId}:${provider}`
    await this.redis.del(cacheKey)
  }
}
