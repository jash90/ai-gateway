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
import { ProviderKeysService } from './provider-keys.service'
import {
  CreateProviderKeyDto,
  ProviderKeySummaryDto,
  ProviderKeyListResponseDto,
  ProviderKeyTestResultDto,
} from './dto/provider-keys.dto'

@ApiTags('provider-keys')
@ApiBearerAuth('bearer')
@Controller('v1/provider-keys')
@UseGuards(JwtAuthGuard)
export class ProviderKeysController {
  constructor(private providerKeys: ProviderKeysService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'List of provider keys.', type: ProviderKeyListResponseDto })
  @ApiOperation({
    summary: 'List your BYOK provider keys',
    description: 'Returns metadata only — never the encrypted bytes or plaintext.',
  })
  async list(@CurrentAccount() account: Account) {
    return this.providerKeys.list(account.id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({ status: 201, description: 'Key stored (encrypted).', type: ProviderKeySummaryDto })
  @ApiOperation({
    summary: 'Add or replace a BYOK provider key',
    description:
      'One key per (account, provider). Adding a second OPENAI key for the same account replaces the previous one.',
  })
  @ApiResponse({ status: 400, description: 'Key format does not match the provider.' })
  async create(
    @Body() dto: CreateProviderKeyDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.providerKeys.create(account.id, dto, extractContext(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a provider key' })
  @ApiResponse({ status: 204, description: 'Key removed.' })
  @ApiResponse({ status: 404, description: 'Key not found.' })
  async delete(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.providerKeys.delete(account.id, id, extractContext(req))
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: 200, description: 'Test result (ok=true or errorCode).', type: ProviderKeyTestResultDto })
  @ApiOperation({
    summary: 'Test a provider key against the provider',
    description:
      "Decrypts the key and calls the provider's /models endpoint to verify it works. " +
      'Returns { ok, sampleModels?, errorCode? }. Updates lastUsedAt on success.',
  })
  @ApiResponse({ status: 404, description: 'Provider key not found.' })
  async test(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.providerKeys.test(account.id, id, extractContext(req))
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
