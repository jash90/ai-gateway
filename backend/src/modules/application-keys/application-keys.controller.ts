import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { ApplicationKeysService } from './application-keys.service'
import {
  CreateApplicationKeyDto,
  ApplicationKeyCreatedDto,
  ApplicationKeyListResponseDto,
} from './dto/application-keys.dto'

@ApiTags('application-keys')
@ApiBearerAuth('bearer')
@Controller('v1/apps/:appId/keys')
@UseGuards(JwtAuthGuard)
export class ApplicationKeysController {
  constructor(private keys: ApplicationKeysService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'Keys list (no secrets).', type: ApplicationKeyListResponseDto })
  @ApiOperation({ summary: 'List keys for an application' })
  async list(@Param('appId') appId: string, @CurrentAccount() account: Account) {
    return this.keys.list(account.id, appId)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({
    status: 201,
    description: 'Key created. The `secret` field is shown ONLY in this response.',
    type: ApplicationKeyCreatedDto,
  })
  @ApiOperation({
    summary: 'Generate a new application key',
    description:
      'Returns the full secret ONCE. Store it securely; the API never returns it again.',
  })
  async create(
    @Param('appId') appId: string,
    @Body() dto: CreateApplicationKeyDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.keys.create(account.id, appId, dto, extractContext(req))
  }

  @Delete(':keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke a key',
    description: 'Idempotent. Sets revokedAt; key is rejected by the data plane immediately.',
  })
  @ApiResponse({ status: 204, description: 'Revoked (or already revoked).' })
  @ApiResponse({ status: 404, description: 'Key or application not found.' })
  async revoke(
    @Param('appId') appId: string,
    @Param('keyId') keyId: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.keys.revoke(account.id, appId, keyId, extractContext(req))
  }
}

function extractContext(req: FastifyRequest): { ip?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for']
  const ip =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) ||
    req.ip ||
    undefined
  const ua = req.headers['user-agent']
  return { ip, userAgent: typeof ua === 'string' ? ua : undefined }
}
