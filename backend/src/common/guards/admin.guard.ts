import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { FastifyRequest } from 'fastify'
import { TokenService } from '../../modules/auth/services/token.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../modules/audit/audit.service'

/**
 * AdminGuard — two strategies, in order:
 *
 *   1. **Preferred:** JWT Bearer with `account.role === 'ADMIN'`.
 *      Same flow as JwtAuthGuard, with the extra role check.
 *
 *   2. **Fallback:** `X-Admin-Key` header matching env `ADMIN_API_KEY`.
 *      For scripts/CI that can't easily mint JWTs. Every use is audited
 *      under `admin.legacy_key_used` so we can spot abuse / phase it out.
 *
 * If both are present, JWT wins (legacy fallback never runs).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private tokenService: TokenService,
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()

    const auth = req.headers['authorization']
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return this.checkJwt(auth.slice('Bearer '.length).trim(), req)
    }

    const adminKey = req.headers['x-admin-key']
    if (adminKey) {
      return this.checkLegacyKey(typeof adminKey === 'string' ? adminKey : adminKey[0], req)
    }

    throw new UnauthorizedException({
      errorCode: 'MISSING_ADMIN_AUTH',
      message: 'Provide either an Authorization Bearer JWT (role=ADMIN) or X-Admin-Key.',
    })
  }

  private async checkJwt(token: string, req: FastifyRequest): Promise<boolean> {
    let payload: { sub: string }
    try {
      payload = this.tokenService.verifyAccessToken(token)
    } catch (err) {
      const isExpired = err instanceof Error && err.name === 'TokenExpiredError'
      throw new UnauthorizedException({
        errorCode: isExpired ? 'EXPIRED_TOKEN' : 'INVALID_TOKEN',
        message: isExpired ? 'Access token expired.' : 'Access token is invalid.',
      })
    }

    const account = await this.prisma.account.findUnique({ where: { id: payload.sub } })
    if (!account || account.deletedAt || !account.isActive) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_TOKEN',
        message: 'Account is unavailable.',
      })
    }

    if (account.role !== 'ADMIN') {
      throw new ForbiddenException({
        errorCode: 'NOT_AN_ADMIN',
        message: 'This endpoint requires an admin account.',
      })
    }

    req.account = account
    return true
  }

  private async checkLegacyKey(key: string, req: FastifyRequest): Promise<boolean> {
    const expected = this.config.get<string>('ADMIN_API_KEY')
    if (!expected || key !== expected) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_ADMIN_KEY',
        message: 'Invalid admin key.',
      })
    }

    // Audit every legacy-key use so we can spot patterns and eventually deprecate.
    this.audit.logBackground({
      actorType: 'SYSTEM',
      action: 'admin.legacy_key_used',
      ipAddress: extractIp(req),
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? (req.headers['user-agent'] as string)
          : undefined,
      metadata: {
        path: req.url,
        method: req.method,
      },
    })

    return true
  }
}

function extractIp(req: FastifyRequest): string | undefined {
  const xff = req.headers['x-forwarded-for']
  return (
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) ||
    req.ip ||
    undefined
  )
}
