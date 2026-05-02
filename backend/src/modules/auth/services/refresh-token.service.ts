import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'

/** 30 days in milliseconds. */
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface IssuedRefreshToken {
  /** The opaque token string sent to the client. NEVER logged. */
  token: string
  /** Epoch ms when this token expires. */
  expiresAt: number
}

export interface RefreshContext {
  ip?: string
  userAgent?: string
}

/**
 * RefreshTokenService — opaque token issuance, rotation, and reuse-detection.
 *
 * Storage: 32 random bytes per token. The plaintext is sent to the client and
 * NEVER stored. Only sha256(plaintext) is persisted as `tokenHash`.
 *
 * Rotation chain: every successful rotate() marks the old row revokedAt+replacedById
 * and inserts a new one. Re-using a row that's already been replaced is a breach
 * signal — the entire chain is revoked and the caller gets 401 REFRESH_TOKEN_REUSED.
 *
 * See decision D-003.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Issue a brand-new refresh token (fresh login). */
  async issue(accountId: string, ctx: RefreshContext): Promise<IssuedRefreshToken> {
    const token = this.generateToken()
    const tokenHash = this.hashToken(token)
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)

    await this.prisma.refreshToken.create({
      data: {
        accountId,
        tokenHash,
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
    })

    return { token, expiresAt: expiresAt.getTime() }
  }

  /**
   * Rotate a refresh token. Returns a new pair atomically OR throws on:
   *   - unknown token              → 401 INVALID_REFRESH_TOKEN
   *   - expired token              → 401 EXPIRED_REFRESH_TOKEN
   *   - revoked token (NOT replaced) → 401 INVALID_REFRESH_TOKEN
   *   - revoked-and-replaced token → BREACH: revoke entire chain, 401 REFRESH_TOKEN_REUSED
   */
  async rotate(
    plaintextToken: string,
    ctx: RefreshContext,
  ): Promise<{ newToken: IssuedRefreshToken; accountId: string }> {
    const tokenHash = this.hashToken(plaintextToken)
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    })

    if (!row) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid.',
      })
    }

    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException({
        errorCode: 'EXPIRED_REFRESH_TOKEN',
        message: 'Refresh token has expired.',
      })
    }

    if (row.revokedAt) {
      // Was the row REPLACED (legitimate rotation we already used) or just plain revoked?
      // If replaced, the caller has presented an old token AFTER we issued a new one =>
      // breach signal. Revoke the entire chain.
      if (row.replacedById) {
        await this.revokeChain(row.id, row.accountId)
        await this.audit.log({
          accountId: row.accountId,
          actorType: 'SYSTEM',
          action: 'account.refresh_token_reuse_detected',
          metadata: { tokenId: row.id, ip: ctx.ip, userAgent: ctx.userAgent },
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        })
        throw new UnauthorizedException({
          errorCode: 'REFRESH_TOKEN_REUSED',
          message: 'Refresh token reuse detected. All sessions revoked.',
        })
      }
      // Plain revoke (logout) — just reject.
      throw new UnauthorizedException({
        errorCode: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid.',
      })
    }

    // Happy path: mark old as replaced, issue new in a single transaction.
    const newToken = this.generateToken()
    const newHash = this.hashToken(newToken)
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)

    const newRow = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          accountId: row.accountId,
          tokenHash: newHash,
          expiresAt: newExpiresAt,
          userAgent: ctx.userAgent ?? null,
          ip: ctx.ip ?? null,
        },
      })
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), replacedById: created.id },
      })
      return created
    })

    return {
      newToken: { token: newToken, expiresAt: newRow.expiresAt.getTime() },
      accountId: row.accountId,
    }
  }

  /** Single-token revoke (logout this session). No-op if already revoked. */
  async revoke(plaintextToken: string): Promise<void> {
    const tokenHash = this.hashToken(plaintextToken)
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /** Mass-revoke for password change / soft delete / forced logout-all. */
  async revokeAllForAccount(accountId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  /**
   * Walk the rotation chain in both directions from a starting node and revoke
   * every token in the family. Used on reuse detection.
   *
   * Chain links: row.replacedById → next row, row.replaces (back-relation) → previous row.
   */
  private async revokeChain(seedId: string, accountId: string): Promise<void> {
    // Cheaper than walking pointers individually: revoke ALL active tokens for
    // this account. A breach event invalidates every session anyway — going
    // wider is the right choice. (For accounts with many concurrent sessions,
    // this is also faster than chain walking.)
    const result = await this.prisma.refreshToken.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    this.logger.warn(
      `Refresh token reuse detected for account ${accountId} (seed=${seedId}); revoked ${result.count} active tokens.`,
    )
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private generateToken(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  private hashToken(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex')
  }
}
