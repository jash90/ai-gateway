import { Injectable, Logger, Inject } from '@nestjs/common'
import type Redis from 'ioredis'
import type { ProviderType } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { ByokKeyResolverService } from './byok-key-resolver.service'

export interface ModelEntry {
  /** Vendor-prefixed model ID (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5"). */
  id: string
  /** Provider this model came from. */
  provider: ProviderType
  /** Provider's owner string (e.g. "openai" for GPT, "anthropic" for Claude). */
  ownedBy?: string | null
  /** Optional human-friendly display name. */
  displayName?: string | null
}

interface ProviderEndpoint {
  url: string
  auth: (key: string) => Record<string, string>
  parse: (body: unknown) => ModelEntry[]
}

const ENDPOINTS: Record<ProviderType, ProviderEndpoint> = {
  OPENAI: {
    url: 'https://api.openai.com/v1/models',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (body) => {
      const data = (body as { data?: Array<{ id: string; owned_by?: string }> })?.data ?? []
      return data.map((m) => ({
        id: `openai/${m.id}`,
        provider: 'OPENAI',
        ownedBy: m.owned_by ?? null,
      }))
    },
  },
  ANTHROPIC: {
    url: 'https://api.anthropic.com/v1/models',
    auth: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    parse: (body) => {
      const data = (body as { data?: Array<{ id: string; display_name?: string }> })?.data ?? []
      return data.map((m) => ({
        id: `anthropic/${m.id}`,
        provider: 'ANTHROPIC',
        ownedBy: 'anthropic',
        displayName: m.display_name ?? null,
      }))
    },
  },
  OPENROUTER: {
    url: 'https://openrouter.ai/api/v1/models',
    auth: (key) => ({ Authorization: `Bearer ${key}` }),
    parse: (body) => {
      // OpenRouter returns models in vendor/model format already.
      const data = (body as { data?: Array<{ id: string; name?: string }> })?.data ?? []
      return data.map((m) => ({
        id: `openrouter/${m.id}`,
        provider: 'OPENROUTER',
        displayName: m.name ?? null,
      }))
    },
  },
}

const FETCH_TIMEOUT_MS = 5_000
const CACHE_TTL_SECONDS = 300 // 5 min — model lists change rarely

/**
 * Aggregates models from all configured BYOK providers for an account.
 *
 * Caches per-account in Redis (5 min TTL) to avoid hitting upstream APIs on
 * every dashboard refresh. Cache invalidates implicitly on TTL — explicit
 * invalidation when user adds/deletes a BYOK key would require a hook
 * (deferred to Phase 4).
 */
@Injectable()
export class ModelsAggregatorService {
  private readonly logger = new Logger(ModelsAggregatorService.name)

  constructor(
    private prisma: PrismaService,
    private byokResolver: ByokKeyResolverService,
    @Inject('REDIS') private redis: Redis,
  ) {}

  async listForAccount(accountId: string): Promise<ModelEntry[]> {
    const cacheKey = `models:${accountId}`
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      try {
        return JSON.parse(cached) as ModelEntry[]
      } catch {
        // fall through to refetch
      }
    }

    const providerKeys = await this.prisma.userProviderKey.findMany({
      where: { accountId },
      select: { provider: true },
    })

    const results = await Promise.allSettled(
      providerKeys.map(({ provider }) => this.fetchProviderModels(accountId, provider)),
    )

    const all: ModelEntry[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') {
        all.push(...r.value)
      }
    }

    all.sort((a, b) => a.id.localeCompare(b.id))

    await this.redis.set(cacheKey, JSON.stringify(all), 'EX', CACHE_TTL_SECONDS)
    return all
  }

  private async fetchProviderModels(
    accountId: string,
    provider: ProviderType,
  ): Promise<ModelEntry[]> {
    const endpoint = ENDPOINTS[provider]
    let key: string
    try {
      key = await this.byokResolver.resolve(accountId, provider, {})
    } catch (err) {
      this.logger.warn(
        `Failed to resolve ${provider} key for ${accountId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return []
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(endpoint.url, {
        method: 'GET',
        headers: endpoint.auth(key),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        this.logger.warn(`${provider} /models returned ${res.status}`)
        return []
      }
      const body = await res.json()
      return endpoint.parse(body)
    } catch (err) {
      this.logger.warn(
        `${provider} /models fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return []
    } finally {
      clearTimeout(timer)
    }
  }
}
