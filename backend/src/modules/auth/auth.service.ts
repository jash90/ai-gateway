import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import type { Account } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EmailsService } from '../emails/emails.service'
import { PasswordService } from './services/password.service'
import { TokenService } from './services/token.service'
import { RefreshTokenService } from './services/refresh-token.service'
import type {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  LoginResponse,
  AccountSummary,
} from './dto/auth.dto'

interface RequestContext {
  ip?: string
  userAgent?: string
}

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const RESET_PASSWORD_TTL_MS = 60 * 60 * 1000 // 1h
const MAX_ACTIVE_RESET_TOKENS = 3

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly appUrl: string

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private emails: EmailsService,
    private passwordService: PasswordService,
    private tokenService: TokenService,
    private refreshTokenService: RefreshTokenService,
    config: ConfigService,
  ) {
    this.appUrl =
      config.get<string>('APP_URL') ?? 'http://localhost:5173'
  }

  // ---------------------------------------------------------------------------
  // Register + verify email
  // ---------------------------------------------------------------------------

  async register(dto: RegisterDto, ctx: RequestContext): Promise<{ accountId: string }> {
    const existing = await this.prisma.account.findUnique({
      where: { email: dto.email },
    })
    if (existing) {
      // ConflictException with stable error code — the frontend maps this to
      // localized copy. We do leak that the email exists; this is intentional
      // for UX (vs. login, where we don't leak).
      throw new ConflictException({
        errorCode: 'EMAIL_ALREADY_REGISTERED',
        message: 'This email address is already registered.',
      })
    }

    const passwordHash = await this.passwordService.hash(dto.password)
    const account = await this.prisma.account.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name?.trim() || null,
        role: 'USER',
        emailVerified: false,
      },
    })

    await this.issueAndSendVerifyEmail(account.id, account.email, account.name)

    await this.audit.log({
      accountId: account.id,
      actorType: 'ACCOUNT',
      actorId: account.id,
      action: 'account.registered',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return { accountId: account.id }
  }

  async verifyEmail(token: string, ctx: RequestContext): Promise<{ verified: true }> {
    const tokenHash = sha256(token)

    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash } })
    if (
      !row ||
      row.purpose !== 'VERIFY_EMAIL' ||
      row.usedAt ||
      row.expiresAt < new Date()
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Verification token is invalid or has expired.',
      })
    }

    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: row.accountId },
        data: { emailVerified: true },
      }),
      this.prisma.emailToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ])

    await this.audit.log({
      accountId: row.accountId,
      actorType: 'ACCOUNT',
      actorId: row.accountId,
      action: 'account.email_verified',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return { verified: true }
  }

  // ---------------------------------------------------------------------------
  // Login + logout
  // ---------------------------------------------------------------------------

  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginResponse> {
    const account = await this.prisma.account.findUnique({
      where: { email: dto.email },
    })

    // No-enumeration: every negative path returns the same generic error.
    // The reason is logged (audit metadata) for support but never returned.
    if (!account) {
      await this.logFailedLogin(null, dto.email, 'ACCOUNT_NOT_FOUND', ctx)
      throw genericInvalidCredentials()
    }

    if (account.deletedAt) {
      await this.logFailedLogin(account.id, dto.email, 'ACCOUNT_DELETED', ctx)
      throw genericInvalidCredentials()
    }

    if (!account.isActive) {
      await this.logFailedLogin(account.id, dto.email, 'ACCOUNT_DISABLED', ctx)
      throw genericInvalidCredentials()
    }

    const passwordOk = await this.passwordService.verify(account.passwordHash, dto.password)
    if (!passwordOk) {
      await this.logFailedLogin(account.id, dto.email, 'WRONG_PASSWORD', ctx)
      throw genericInvalidCredentials()
    }

    if (!account.emailVerified) {
      // Different code so the frontend can show "check your email" hint.
      await this.logFailedLogin(account.id, dto.email, 'EMAIL_NOT_VERIFIED', ctx)
      throw new UnauthorizedException({
        errorCode: 'EMAIL_NOT_VERIFIED',
        message: 'Email has not been verified.',
      })
    }

    return this.issueLoginResponse(account, ctx)
  }

  async logout(refreshToken: string, accountId: string, ctx: RequestContext): Promise<void> {
    await this.refreshTokenService.revoke(refreshToken)
    await this.audit.log({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId,
      action: 'account.logout',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<LoginResponse> {
    const { newToken, accountId } = await this.refreshTokenService.rotate(refreshToken, ctx)

    const account = await this.prisma.account.findUnique({ where: { id: accountId } })
    if (!account || account.deletedAt || !account.isActive) {
      // Account was hard-disabled between issue and refresh — revoke the new token too.
      await this.refreshTokenService.revoke(newToken.token)
      throw new UnauthorizedException({
        errorCode: 'ACCOUNT_UNAVAILABLE',
        message: 'Account is no longer available.',
      })
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: account.id,
      email: account.email,
      role: account.role,
    })

    return {
      accessToken: accessToken.token,
      expiresAt: accessToken.expiresAt,
      refreshToken: newToken.token,
      refreshExpiresAt: newToken.expiresAt,
      account: toAccountSummary(account),
    }
  }

  // ---------------------------------------------------------------------------
  // Forgot / reset password
  // ---------------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { email: dto.email },
    })

    // Anti-enumeration: ALWAYS return success regardless of whether the email
    // exists. Email send happens silently if account is found and active.
    if (!account || account.deletedAt || !account.isActive) {
      return
    }

    // Limit: max 3 active reset tokens per account. Issuing a 4th invalidates older.
    const activeCount = await this.prisma.emailToken.count({
      where: {
        accountId: account.id,
        purpose: 'RESET_PASSWORD',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
    if (activeCount >= MAX_ACTIVE_RESET_TOKENS) {
      await this.prisma.emailToken.updateMany({
        where: {
          accountId: account.id,
          purpose: 'RESET_PASSWORD',
          usedAt: null,
        },
        data: { usedAt: new Date() },
      })
    }

    const { token, expiresAt } = await this.issueEmailToken(account.id, 'RESET_PASSWORD', RESET_PASSWORD_TTL_MS)
    const resetUrl = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`

    await this.emails.sendResetPassword(account.email, resetUrl)
    await this.audit.log({
      accountId: account.id,
      actorType: 'ACCOUNT',
      actorId: account.id,
      action: 'account.password_reset_requested',
      metadata: { expiresAt: expiresAt.toISOString() },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext): Promise<void> {
    const tokenHash = sha256(dto.token)
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash } })
    if (
      !row ||
      row.purpose !== 'RESET_PASSWORD' ||
      row.usedAt ||
      row.expiresAt < new Date()
    ) {
      throw new BadRequestException({
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Reset token is invalid or has expired.',
      })
    }

    const newHash = await this.passwordService.hash(dto.newPassword)
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: row.accountId },
        data: { passwordHash: newHash },
      }),
      this.prisma.emailToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ])

    // Force-logout all other sessions for security.
    await this.refreshTokenService.revokeAllForAccount(row.accountId)

    await this.audit.log({
      accountId: row.accountId,
      actorType: 'ACCOUNT',
      actorId: row.accountId,
      action: 'account.password_changed',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build a LoginResponse for an active account that's already been authenticated. */
  private async issueLoginResponse(account: Account, ctx: RequestContext): Promise<LoginResponse> {
    const accessToken = this.tokenService.signAccessToken({
      sub: account.id,
      email: account.email,
      role: account.role,
    })
    const refreshToken = await this.refreshTokenService.issue(account.id, ctx)

    await this.audit.log({
      accountId: account.id,
      actorType: 'ACCOUNT',
      actorId: account.id,
      action: 'account.login',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return {
      accessToken: accessToken.token,
      expiresAt: accessToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshExpiresAt: refreshToken.expiresAt,
      account: toAccountSummary(account),
    }
  }

  private async issueAndSendVerifyEmail(
    accountId: string,
    email: string,
    name: string | null,
  ): Promise<void> {
    const { token } = await this.issueEmailToken(accountId, 'VERIFY_EMAIL', VERIFY_EMAIL_TTL_MS)
    const verifyUrl = `${this.appUrl}/verify-email?token=${encodeURIComponent(token)}`
    try {
      await this.emails.sendVerifyEmail(email, name, verifyUrl)
    } catch (err) {
      // Email failures should not fail registration. Log + audit, retry path
      // is the resend endpoint (out of Sprint 1 scope).
      this.logger.warn(
        `Failed to send verify email to ${email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  private async issueEmailToken(
    accountId: string,
    purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
    ttlMs: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = sha256(token)
    const expiresAt = new Date(Date.now() + ttlMs)
    await this.prisma.emailToken.create({
      data: { accountId, tokenHash, purpose, expiresAt },
    })
    return { token, expiresAt }
  }

  private async logFailedLogin(
    accountId: string | null,
    email: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<void> {
    this.audit.logBackground({
      accountId,
      actorType: 'ACCOUNT',
      actorId: accountId ?? null,
      action: 'account.login_failed',
      metadata: { email, reason },
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    })
  }
}

// =============================================================================
// Module-private helpers
// =============================================================================

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function genericInvalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    errorCode: 'INVALID_CREDENTIALS',
    message: 'Invalid email or password.',
  })
}

function toAccountSummary(account: Account): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    emailVerified: account.emailVerified,
  }
}
