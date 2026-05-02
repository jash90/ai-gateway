import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import type { ProviderType, UserProviderKey } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EncryptionService } from '../crypto/encryption.service'
import { WebhooksService } from '../webhooks/webhooks.service'
import type {
  CreateProviderKeyDto,
  ProviderKeySummary,
  ProviderKeyTestResult,
} from './dto/provider-keys.dto'

interface RequestContext {
  ip?: string
  userAgent?: string
}

const PROVIDER_TEST_ENDPOINTS: Record<ProviderType, { url: string; auth: (key: string) => Record<string, string> }> = {
  OPENAI: {
    url: 'https://api.openai.com/v1/models',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  ANTHROPIC: {
    url: 'https://api.anthropic.com/v1/models',
    auth: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  OPENROUTER: {
    url: 'https://openrouter.ai/api/v1/models',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
  },
}

const TEST_TIMEOUT_MS = 5_000

@Injectable()
export class ProviderKeysService {
  private readonly logger = new Logger(ProviderKeysService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private encryption: EncryptionService,
    private webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(accountId: string): Promise<ProviderKeySummary[]> {
    const rows = await this.prisma.userProviderKey.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(toSummary)
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(
    accountId: string,
    dto: CreateProviderKeyDto,
    ctx: RequestContext,
  ): Promise<ProviderKeySummary> {
    // Encrypt FIRST, then upsert. If encrypt fails, no DB row created.
    const { ciphertext, encryptionKeyId } = await this.encryption.encrypt(dto.key, {
      accountId,
      provider: dto.provider,
    })

    // Unique on (accountId, provider) → upsert overwrites existing key for that provider.
    // This is the MVP behavior; later we may allow multiple keys per provider (dev/prod).
    const row = await this.prisma.userProviderKey.upsert({
      where: { accountId_provider: { accountId, provider: dto.provider } },
      create: {
        accountId,
        provider: dto.provider,
        encryptedKey: ciphertext,
        encryptionKeyId,
        label: dto.label ?? null,
      },
      update: {
        encryptedKey: ciphertext,
        encryptionKeyId,
        label: dto.label ?? null,
        // lastUsedAt intentionally NOT reset — it tracks usage, not key changes.
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'provider_key.created',
      resource: `provider_key:${row.id}`,
      metadata: { provider: row.provider, label: row.label },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return toSummary(row)
  }

  async delete(accountId: string, id: string, ctx: RequestContext): Promise<void> {
    const existing = await this.prisma.userProviderKey.findFirst({
      where: { id, accountId },
      select: { id: true, provider: true },
    })
    if (!existing) {
      throw new NotFoundException({
        errorCode: 'PROVIDER_KEY_NOT_FOUND',
        message: 'Provider key not found.',
      })
    }

    await this.prisma.userProviderKey.delete({ where: { id } })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'provider_key.deleted',
      resource: `provider_key:${id}`,
      metadata: { provider: existing.provider },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }

  // ---------------------------------------------------------------------------
  // Test (BE-S1-019)
  // ---------------------------------------------------------------------------

  async test(
    accountId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<ProviderKeyTestResult> {
    const row = await this.prisma.userProviderKey.findFirst({
      where: { id, accountId },
    })
    if (!row) {
      throw new NotFoundException({
        errorCode: 'PROVIDER_KEY_NOT_FOUND',
        message: 'Provider key not found.',
      })
    }

    const plaintext = await this.encryption.decrypt(row.encryptedKey, row.encryptionKeyId, {
      accountId,
      keyId: row.id,
      provider: row.provider,
    })

    const config = PROVIDER_TEST_ENDPOINTS[row.provider]
    const result = await this.callProviderModelsEndpoint(config.url, config.auth(plaintext))

    if (result.ok) {
      // Update lastUsedAt — successful test counts as a touch.
      await this.prisma.userProviderKey.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      })
      this.audit.logBackground({
        accountId,
        actorType: 'ACCOUNT',
        actorId: accountId,
        action: 'provider_key.test_succeeded',
        resource: `provider_key:${id}`,
        metadata: { provider: row.provider, modelCount: result.sampleModels?.length ?? 0 },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      })
    } else {
      this.audit.logBackground({
        accountId,
        actorType: 'ACCOUNT',
        actorId: accountId,
        action: 'provider_key.test_failed',
        resource: `provider_key:${id}`,
        metadata: {
          provider: row.provider,
          errorCode: result.errorCode,
          upstreamStatus: result.upstreamStatus,
          message: result.message,
        },
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      })

      // Notify customers when their BYOK key fails. Common cause: provider rotated
      // the key on their dashboard and forgot to update Raccoon.
      if (result.errorCode === 'INVALID_KEY') {
        void this.webhooks.dispatch({
          accountId,
          event: 'provider_key.invalid',
          payload: {
            providerKeyId: id,
            provider: row.provider,
            label: row.label,
            upstreamStatus: result.upstreamStatus ?? null,
          },
        })
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async callProviderModelsEndpoint(
    url: string,
    headers: Record<string, string>,
  ): Promise<ProviderKeyTestResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { ok: false, errorCode: 'INVALID_KEY', upstreamStatus: response.status }
        }
        if (response.status === 429) {
          return { ok: false, errorCode: 'RATE_LIMITED', upstreamStatus: response.status }
        }
        return { ok: false, errorCode: 'UNKNOWN', upstreamStatus: response.status }
      }

      const body = (await response.json()) as { data?: Array<{ id: string }> }
      const sampleModels = (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string')
        .sort()
        .slice(0, 10)
      return { ok: true, sampleModels, upstreamStatus: response.status }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      const rawMessage = err instanceof Error ? err.message : String(err)
      const message = rawMessage.slice(0, 200)
      this.logger.warn(
        `Provider test failed: url=${url} reason=${aborted ? 'TIMEOUT' : 'NETWORK'} message=${rawMessage}`,
      )
      return {
        ok: false,
        errorCode: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        message,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function toSummary(row: UserProviderKey): ProviderKeySummary {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
