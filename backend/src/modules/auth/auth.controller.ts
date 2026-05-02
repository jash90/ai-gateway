import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { AuthService } from './auth.service'
import { AccountDeletionService } from './services/account-deletion.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { CurrentAccount } from './decorators/current-account.decorator'
import {
  RegisterDto,
  LoginDto,
  RefreshDto,
  LogoutDto,
  VerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  RegisterResponseDto,
  LoginResponseDto,
  VerifyEmailResponseDto,
  MeResponseDto,
} from './dto/auth.dto'

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private deletion: AccountDeletionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Register + verify
  // ---------------------------------------------------------------------------

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({ status: 201, description: 'Account created. Email verification required before login.', type: RegisterResponseDto })
  @ApiOperation({ summary: 'Register a new Account', description: 'Creates an inactive Account and emails a verification link.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  async register(@Body() dto: RegisterDto, @Req() req: FastifyRequest) {
    return this.auth.register(dto, extractContext(req))
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: 200, description: 'Email verified.', type: VerifyEmailResponseDto })
  @ApiOperation({ summary: 'Verify email via token from email link' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired.' })
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: FastifyRequest) {
    return this.auth.verifyEmail(dto.token, extractContext(req))
  }

  // ---------------------------------------------------------------------------
  // Login + logout + refresh
  // ---------------------------------------------------------------------------

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: 200, description: 'Login successful.', type: LoginResponseDto })
  @ApiOperation({ summary: 'Log in with email + password', description: 'Returns access (15 min) and refresh (30 d) tokens.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or unverified email.' })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.auth.login(dto, extractContext(req))
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: 200, description: 'New token pair.', type: LoginResponseDto })
  @ApiOperation({ summary: 'Rotate refresh token + issue new access token' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, or reused.' })
  async refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest) {
    return this.auth.refresh(dto.refreshToken, extractContext(req))
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  async logout(
    @Body() dto: LogoutDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken, account.id, extractContext(req))
  }

  // ---------------------------------------------------------------------------
  // Forgot / reset
  // ---------------------------------------------------------------------------

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email', description: 'Always returns 200 (anti-enumeration).' })
  @ApiResponse({ status: 200, description: 'If the email is registered, a reset link was sent.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: FastifyRequest) {
    await this.auth.forgotPassword(dto, extractContext(req))
    return undefined
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiResponse({ status: 200, description: 'Password changed.' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired.' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: FastifyRequest) {
    await this.auth.resetPassword(dto, extractContext(req))
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Me
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Account deletion (GDPR)
  // ---------------------------------------------------------------------------

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Delete the current account',
    description:
      'Default mode (?mode=soft or omitted): marks the account deleted, renames email to ' +
      '`deleted+<id>@deleted.local`, revokes all keys + refresh tokens. The cooling-off ' +
      'worker promotes to hard delete after 30 days.\n\n' +
      '`?mode=hard` performs immediate GDPR erasure: anonymizes PII (email, name, app names, ' +
      'end-user externalIds), scrubs UsageEvent.metadata, deletes UserProviderKey/WebhookConfig/AlertRule. ' +
      'UsageEvent rows themselves stay (anonymized) for accounting integrity.',
  })
  @ApiResponse({ status: 204, description: 'Account deletion initiated.' })
  async deleteAccount(
    @Query('mode') mode: 'soft' | 'hard' | undefined,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    const ctx = extractContext(req)
    if (mode === 'hard') {
      await this.deletion.hardDelete(account.id, ctx)
    } else {
      await this.deletion.softDelete(account.id, ctx)
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ZodResponse({ status: 200, description: 'Account info.', type: MeResponseDto })
  @ApiOperation({ summary: 'Get the current authenticated Account' })
  async me(@CurrentAccount() account: Account) {
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      role: account.role,
      emailVerified: account.emailVerified,
      createdAt: account.createdAt,
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function extractContext(req: FastifyRequest): { ip?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for']
  const ip =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) ||
    req.ip ||
    undefined
  const userAgent = req.headers['user-agent']
  return {
    ip,
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
  }
}
