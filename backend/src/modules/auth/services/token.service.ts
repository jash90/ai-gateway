import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as crypto from 'crypto'
import type { AccountRole } from '@prisma/client'

export interface AccessTokenPayload {
  /** Account ID — RFC 7519 `sub` claim. */
  sub: string
  email: string
  role: AccountRole
}

export interface SignedAccessToken {
  /** The JWT bearer token. */
  token: string
  /** Epoch ms when the token expires. Returned to clients to enable proactive refresh. */
  expiresAt: number
}

/**
 * Access token signing + verification. JWT is symmetric HS256, signed with
 * JWT_SECRET from env. Configured globally in AuthModule (15-min TTL,
 * issuer="raccoon", audience="raccoon-api").
 *
 * For refresh tokens see RefreshTokenService — those are opaque random strings,
 * not JWTs, because they need server-side revocation (rotation chain).
 */
@Injectable()
export class TokenService {
  /** Mirror of the JwtModule signOptions.expiresIn — used to compute expiresAt. */
  private static readonly ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000

  constructor(private jwtService: JwtService) {}

  signAccessToken(payload: AccessTokenPayload): SignedAccessToken {
    // jti = unique JWT ID per token. Two tokens issued in the same second with
    // identical claims would otherwise be byte-identical (iat in seconds).
    // Also useful as a key for future revocation lists.
    const jti = crypto.randomBytes(12).toString('base64url')
    const token = this.jwtService.sign({ ...payload, jti })
    const expiresAt = Date.now() + TokenService.ACCESS_TOKEN_TTL_MS
    return { token, expiresAt }
  }

  /**
   * Verify a JWT. Throws if signature/issuer/audience/expiry fail.
   * Returns the decoded payload with the `iat`, `exp`, etc. claims included.
   */
  verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
    return this.jwtService.verify<AccessTokenPayload & { iat: number; exp: number }>(token, {
      issuer: 'raccoon',
      audience: 'raccoon-api',
    })
  }
}
