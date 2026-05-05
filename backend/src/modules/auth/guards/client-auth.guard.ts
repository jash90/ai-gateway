import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { TokenService } from '../services/token.service'
import { PasswordService } from '../services/password.service'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * ClientAuthGuard — unified auth dla integratora.
 *
 * Akceptuje JEDEN z dwóch nagłówków:
 *   Authorization: Bearer eyJhb…              → JWT konta (panel UI)
 *   Authorization: Bearer sk-rcn-live-…       → klucz aplikacji (server-side
 *                                                integracja, brak login flow)
 *
 * W obu przypadkach po sukcesie request ma `req.account` (Account) ustawiony.
 * Gdy auth idzie kluczem aplikacji, dodatkowo ustawiamy `req.application` +
 * `req.applicationKey` (analogicznie do ApplicationKeyGuard).
 *
 * Cel: integrator nie potrzebuje logować się przez `/v1/auth/login` żeby
 * wywołać billing/wallet/catalog/checkout — wystarczy klucz aplikacji,
 * a auth context to konto będące właścicielem aplikacji.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(
    private tokenService: TokenService,
    private passwordService: PasswordService,
    private prisma: PrismaService,
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

    const credential = auth.slice('Bearer '.length).trim()

    // Dispatch po prefiksie — application keys mają stały prefix sk-rcn-live-
    if (credential.startsWith('sk-rcn-live-')) {
      await this.authWithApplicationKey(req, credential)
      return true
    }

    await this.authWithJwt(req, credential)
    return true
  }

  // ---------------------------------------------------------------------------
  // Application key path (mirror ApplicationKeyGuard)
  // ---------------------------------------------------------------------------

  private async authWithApplicationKey(
    req: FastifyRequest,
    secret: string,
  ): Promise<void> {
    if (secret.length < 16) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_KEY_FORMAT',
        message: 'Authorization is not a valid Raccoon application key.',
      })
    }

    const keyPrefix = secret.slice(0, 16)
    const row = await this.prisma.applicationKey.findUnique({
      where: { keyPrefix },
      include: { application: { include: { account: true } } },
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
      throw new UnauthorizedException({
        errorCode: 'INVALID_KEY',
        message: 'Application key is invalid.',
      })
    }

    // Best-effort lastUsedAt bump — nie blokujemy requesta gdy się wywali.
    void this.prisma.applicationKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        /* analytics signal, niekrytyczne */
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
  }

  // ---------------------------------------------------------------------------
  // JWT path (mirror JwtAuthGuard, ale bez @Public/@SkipSubscription handlingu —
  // ten guard jest opt-in per controller)
  // ---------------------------------------------------------------------------

  private async authWithJwt(req: FastifyRequest, token: string): Promise<void> {
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
  }
}
