import { Injectable, NotFoundException } from '@nestjs/common'
import * as crypto from 'crypto'
import type { ApplicationKey } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { PasswordService } from '../auth/services/password.service'
import { WebhooksService } from '../webhooks/webhooks.service'
import type {
  CreateApplicationKeyDto,
  ApplicationKeySummary,
  ApplicationKeyCreatedResponse,
} from './dto/application-keys.dto'

/** Used as the `keyPrefix` length. Must match what we slice from the secret. */
const KEY_PREFIX_LENGTH = 16

interface RequestContext {
  ip?: string
  userAgent?: string
}

@Injectable()
export class ApplicationKeysService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private passwordService: PasswordService,
    private webhooks: WebhooksService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async list(accountId: string, applicationId: string): Promise<ApplicationKeySummary[]> {
    await this.assertAppOwnership(accountId, applicationId)
    const keys = await this.prisma.applicationKey.findMany({
      where: { applicationId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    })
    return keys.map(toSummary)
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async create(
    accountId: string,
    applicationId: string,
    dto: CreateApplicationKeyDto,
    ctx: RequestContext,
  ): Promise<ApplicationKeyCreatedResponse> {
    await this.assertAppOwnership(accountId, applicationId)

    // Generate the secret. Format: sk-rcn-live-<32 random bytes base64url>
    // Total length ~55 chars. The first 16 chars (`sk-rcn-live-XXXX`) become
    // the indexed `keyPrefix` we use for fast lookup on incoming requests.
    const random = crypto.randomBytes(32).toString('base64url')
    const secret = `sk-rcn-live-${random}`
    const keyPrefix = secret.slice(0, KEY_PREFIX_LENGTH)
    const keyHash = await this.passwordService.hash(secret)

    const created = await this.prisma.applicationKey.create({
      data: {
        applicationId,
        keyPrefix,
        keyHash,
        label: dto.label ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'key.created',
      resource: `key:${created.id}`,
      metadata: {
        applicationId,
        keyPrefix,
        label: created.label,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    void this.webhooks.dispatch({
      accountId,
      event: 'key.created',
      payload: {
        applicationId,
        keyId: created.id,
        keyPrefix,
        label: created.label,
      },
    })

    return { ...toSummary(created), secret }
  }

  async revoke(
    accountId: string,
    applicationId: string,
    keyId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.assertAppOwnership(accountId, applicationId)

    const key = await this.prisma.applicationKey.findFirst({
      where: { id: keyId, applicationId },
      select: { id: true, keyPrefix: true, revokedAt: true },
    })
    if (!key) {
      throw new NotFoundException({
        errorCode: 'KEY_NOT_FOUND',
        message: 'Key not found.',
      })
    }
    if (key.revokedAt) {
      // Idempotent — revoking an already-revoked key is a no-op success.
      return
    }

    await this.prisma.applicationKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    })

    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'key.revoked',
      resource: `key:${keyId}`,
      metadata: { applicationId, keyPrefix: key.keyPrefix },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    void this.webhooks.dispatch({
      accountId,
      event: 'key.revoked',
      payload: {
        applicationId,
        keyId,
        keyPrefix: key.keyPrefix,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async assertAppOwnership(accountId: string, applicationId: string): Promise<void> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, accountId },
      select: { id: true },
    })
    if (!app) {
      throw new NotFoundException({
        errorCode: 'APPLICATION_NOT_FOUND',
        message: 'Application not found.',
      })
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function toSummary(key: ApplicationKey): ApplicationKeySummary {
  return {
    id: key.id,
    keyPrefix: key.keyPrefix,
    label: key.label,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  }
}
