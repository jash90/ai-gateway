import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AdminService } from './admin.service'
import {
  AdminAccountListResponseDto,
  AdminCreateAccountDto,
  AdminListAccountsQueryDto,
  AdminMutationResponseDto,
  AdminUpdateAccountDto,
} from './dto/admin-accounts.dto'
import { AdminGrantTokensDto } from '../wallet/dto/wallet.dto'
import { WalletService } from '../wallet/wallet.service'

@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiSecurity('admin-key')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private admin: AdminService,
    private wallet: WalletService,
  ) {}

  @Get('accounts')
  @ZodResponse({
    status: 200,
    description: 'All accounts with summary metrics.',
    type: AdminAccountListResponseDto,
  })
  @ApiOperation({
    summary: 'List all accounts',
    description:
      'Multi-tenant view: every Account in the system, with applications, keys, and 30-day cost.',
  })
  async listAccounts(@Query() query: AdminListAccountsQueryDto) {
    return this.admin.listAccounts({
      search: query.search,
      role: query.role,
      includeDeleted: query.includeDeleted === 'true',
    })
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({
    status: 201,
    description: 'Newly created account (already email-verified by default).',
    type: AdminMutationResponseDto,
  })
  @ApiOperation({
    summary: 'Create a new account (admin)',
    description:
      'Provisions a fresh Account with the given email, password, role and optional name. ' +
      'Defaults to emailVerified=true so the user can log in immediately — admin is responsible ' +
      'for communicating the password OOB. Conflicts on duplicate email.',
  })
  async createAccount(@Body() dto: AdminCreateAccountDto, @Req() req: FastifyRequest) {
    const ctx = adminCtx(req)
    const account = await this.admin.createAccount(
      {
        email: dto.email,
        password: dto.password,
        name: dto.name ?? null,
        role: dto.role,
        emailVerified: dto.emailVerified,
      },
      ctx,
    )
    return { account: await this.admin.hydrateAccountSummary(account.id) }
  }

  @Patch('accounts/:id')
  @ZodResponse({
    status: 200,
    description: 'Updated account row.',
    type: AdminMutationResponseDto,
  })
  @ApiOperation({
    summary: 'Update account (role, name, suspend, reset password)',
    description:
      'Patch fields on an existing account. Setting `isActive: false` revokes all refresh ' +
      'tokens immediately, forcing the user out. Setting `newPassword` re-hashes the password. ' +
      'At least one field must be provided.',
  })
  async updateAccount(
    @Param('id') id: string,
    @Body() dto: AdminUpdateAccountDto,
    @Req() req: FastifyRequest,
  ) {
    const account = await this.admin.updateAccount(
      id,
      {
        name: dto.name,
        role: dto.role,
        isActive: dto.isActive,
        emailVerified: dto.emailVerified,
        newPassword: dto.newPassword,
      },
      adminCtx(req),
    )
    return { account: await this.admin.hydrateAccountSummary(account.id) }
  }

  @Delete('accounts/:id')
  @ZodResponse({
    status: 200,
    description: 'Account marked as soft-deleted.',
    type: AdminMutationResponseDto,
  })
  @ApiOperation({
    summary: 'Soft-delete account',
    description:
      'Sets deletedAt + isActive=false, renames email to deleted+<id>@deleted.local so the ' +
      'address can be reused, revokes all refresh tokens and application keys. The account row ' +
      'and its usage history stay for audit. Refuses to delete self.',
  })
  async softDeleteAccount(@Param('id') id: string, @Req() req: FastifyRequest) {
    const account = await this.admin.softDeleteAccount(id, adminCtx(req))
    return { account: await this.admin.hydrateAccountSummary(account.id) }
  }

  @Post('accounts/:id/wallet/grant')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Grant tokens to an account (admin)',
    description:
      'Adds the given amount of LLM tokens to the target Account.tokenBalance. Logged in audit + emits ADJUST WalletTransaction.',
  })
  async grantTokens(
    @Param('id') accountId: string,
    @Body() dto: AdminGrantTokensDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = req.account
      ? { actorId: req.account.id, actorType: 'ADMIN' as const }
      : { actorId: 'legacy-admin-key', actorType: 'ADMIN' as const }

    const tx = await this.wallet.adminGrant(
      accountId,
      BigInt(dto.amount),
      dto.reason,
      actor,
      extractContext(req),
      {
        applicationId: dto.applicationId ?? null,
        endUserId: dto.endUserId ?? null,
      },
    )

    return {
      id: tx.id,
      type: tx.type,
      amount: tx.amount.toString(),
      balanceAfter: tx.balanceAfter.toString(),
      createdAt: tx.createdAt.toISOString(),
    }
  }
}

function extractContext(req: FastifyRequest): { ipAddress?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for']
  const ipAddress =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) || req.ip || undefined
  const ua = req.headers['user-agent']
  return { ipAddress, userAgent: typeof ua === 'string' ? ua : undefined }
}

function adminCtx(req: FastifyRequest): {
  actorId: string
  ipAddress?: string
  userAgent?: string
} {
  const actorId = req.account?.id ?? 'legacy-admin-key'
  return { actorId, ...extractContext(req) }
}
