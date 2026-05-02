import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Account, Application, ApplicationKey } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { PasswordService } from '../services/password.service'

/**
 * Augment FastifyRequest with the resolved data-plane context.
 * Controllers read these via dedicated decorators (see ./current-application.decorator.ts).
 */
declare module 'fastify' {
  interface FastifyRequest {
    application?: Application
    applicationKey?: ApplicationKey
  }
}

/**
 * ApplicationKeyGuard — data plane authentication via `Authorization: Bearer sk-rcn-live-...`.
 *
 * Lookup strategy (single argon2id verify per request):
 *   1. Parse the secret from the header.
 *   2. Take the first 16 chars as `keyPrefix` and look up the row by indexed unique.
 *   3. Argon2id-verify the full secret against the hash.
 *   4. Reject if revokedAt / expiresAt / parent application disabled / account disabled.
 *
 * Attaches `request.account`, `request.application`, `request.applicationKey`.
 *
 * Side effect: bumps `lastUsedAt` (best-effort, fire-and-forget) for analytics.
 *
 * Cache: not in this guard — the gateway service caches the decrypted BYOK
 * keys downstream. The argon2id verify per request is acceptable cost
 * (~50-100ms) since chat completions are >500ms anyway.
 */
@Injectable()
export class ApplicationKeyGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private passwordService: PasswordService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    const auth = req.headers['authorization']

    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        errorCode: 'MISSING_AUTH_HEADER',
        message: 'Authorization Bearer is required.',
      })
    }

    const secret = auth.slice('Bearer '.length).trim()
    if (!secret.startsWith('sk-rcn-live-') || secret.length < 16) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_KEY_FORMAT',
        message: 'Authorization is not a valid Raccoon application key.',
      })
    }

    const keyPrefix = secret.slice(0, 16)

    const row = await this.prisma.applicationKey.findUnique({
      where: { keyPrefix },
      include: {
        application: {
          include: {
            account: true,
          },
        },
      },
    })

    if (!row) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_KEY',
        message: 'Application key is invalid.',
      })
    }

    if (row.revokedAt) {
      throw new UnauthorizedException({
        errorCode: 'KEY_REVOKED',
        message: 'Application key has been revoked.',
      })
    }

    if (row.expiresAt && row.expiresAt < new Date()) {
      throw new UnauthorizedException({
        errorCode: 'KEY_EXPIRED',
        message: 'Application key has expired.',
      })
    }

    if (!row.application.isActive) {
      throw new ForbiddenException({
        errorCode: 'APPLICATION_DISABLED',
        message: 'Parent application is disabled.',
      })
    }

    const account: Account = row.application.account
    if (!account.isActive || account.deletedAt) {
      throw new ForbiddenException({
        errorCode: 'ACCOUNT_UNAVAILABLE',
        message: 'Account is unavailable.',
      })
    }

    const ok = await this.passwordService.verify(row.keyHash, secret)
    if (!ok) {
      // Prefix collision is astronomically unlikely (2^96-bit space) but possible
      // in principle — argon2id verify is the actual auth check.
      throw new UnauthorizedException({
        errorCode: 'INVALID_KEY',
        message: 'Application key is invalid.',
      })
    }

    // Best-effort lastUsedAt bump. Don't block the request, don't throw on fail.
    void this.prisma.applicationKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // ignored — analytics signal, not auth-critical
      })

    req.account = account
    req.application = row.application
    req.applicationKey = {
      id: row.id,
      applicationId: row.applicationId,
      keyPrefix: row.keyPrefix,
      keyHash: row.keyHash,
      label: row.label,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }
    return true
  }
}
