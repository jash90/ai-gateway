import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { TokenService } from '../services/token.service'
import { PrismaService } from '../../../prisma/prisma.service'
import type { Account } from '@prisma/client'

/**
 * Augments FastifyRequest with the authenticated Account. Controllers read it
 * via the `@CurrentAccount()` decorator (see ./current-account.decorator.ts).
 */
declare module 'fastify' {
  interface FastifyRequest {
    account?: Account
  }
}

/**
 * JwtAuthGuard — control plane authentication.
 *
 * Verifies the Bearer JWT, fetches the Account from the DB, and attaches it to
 * the request. Rejects with 401 on:
 *   - missing / malformed Authorization header  → MISSING_AUTH_HEADER
 *   - invalid JWT (signature, issuer, audience) → INVALID_TOKEN
 *   - expired JWT                               → EXPIRED_TOKEN (special-cased so frontend can refresh)
 *   - account not found                         → INVALID_TOKEN
 *   - account.isActive = false                  → ACCOUNT_DISABLED
 *   - account.deletedAt != null                 → ACCOUNT_DELETED
 *   - account.emailVerified = false             → EMAIL_NOT_VERIFIED
 *
 * BE-S1-020: the deletedAt check is implemented here. Full soft-delete service
 * (rename email, revoke keys, etc.) lands in Sprint 4.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private tokenService: TokenService,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    const auth = req.headers['authorization']

    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        errorCode: 'MISSING_AUTH_HEADER',
        message: 'Authorization header is missing or malformed.',
      })
    }

    const token = auth.slice('Bearer '.length).trim()

    let payload: { sub: string }
    try {
      payload = this.tokenService.verifyAccessToken(token)
    } catch (err) {
      const isExpired =
        err instanceof Error && err.name === 'TokenExpiredError'
      throw new UnauthorizedException({
        errorCode: isExpired ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN',
        message: isExpired ? 'Access token expired.' : 'Access token is invalid.',
      })
    }

    // accountRaw: we want to see deleted rows so we can return the specific
    // ACCOUNT_DELETED error (better UX than the generic INVALID_TOKEN).
    const account = await this.prisma.accountRaw.findUnique({
      where: { id: payload.sub },
    })

    if (!account) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_TOKEN',
        message: 'Account no longer exists.',
      })
    }

    if (account.deletedAt) {
      throw new UnauthorizedException({
        errorCode: 'ACCOUNT_DELETED',
        message: 'This account has been deleted.',
      })
    }

    if (!account.isActive) {
      throw new UnauthorizedException({
        errorCode: 'ACCOUNT_DISABLED',
        message: 'This account is disabled.',
      })
    }

    if (!account.emailVerified) {
      throw new UnauthorizedException({
        errorCode: 'EMAIL_NOT_VERIFIED',
        message: 'Email has not been verified.',
      })
    }

    req.account = account
    return true
  }
}
