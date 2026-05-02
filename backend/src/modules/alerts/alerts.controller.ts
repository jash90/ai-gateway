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
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { AlertsService } from './alerts.service'
import {
  CreateAlertDto,
  UpdateAlertDto,
  AlertSummaryDto,
  AlertListResponseDto,
  DryRunRequestDto,
  DryRunResponseDto,
} from './dto/alerts.dto'

@ApiTags('alerts')
@ApiBearerAuth('bearer')
@Controller('v1/alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'List of alert rules.', type: AlertListResponseDto })
  @ApiOperation({ summary: 'List alert rules' })
  async list(@CurrentAccount() account: Account) {
    return this.alerts.list(account.id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({ status: 201, description: 'Alert rule created.', type: AlertSummaryDto })
  @ApiOperation({
    summary: 'Create an alert rule',
    description:
      'Threshold semantics depend on type:\n' +
      '- USAGE_THRESHOLD: cents (cost MTD)\n' +
      '- DAILY_LIMIT: cents (cost in last 24h)\n' +
      '- ERROR_RATE_HIGH: basis points (e.g. 500 = 5%)\n' +
      '- LATENCY_P95_HIGH: milliseconds',
  })
  async create(
    @Body() dto: CreateAlertDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.alerts.create(account.id, dto, extractContext(req))
  }

  @Patch(':id')
  @ZodResponse({ status: 200, description: 'Alert rule updated.', type: AlertSummaryDto })
  @ApiOperation({ summary: 'Update an alert rule' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAlertDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.alerts.update(account.id, id, dto, extractContext(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alert rule' })
  async delete(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.alerts.delete(account.id, id, extractContext(req))
  }

  @Post('dry-run')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: 200,
    description: 'Triggers + peak from the last 30 days under the proposed config.',
    type: DryRunResponseDto,
  })
  @ApiOperation({
    summary: 'Preview — "what would have fired with this rule?"',
    description:
      'Replays the proposed rule against the last 30 days of UsageEvent data. ' +
      'Returns triggers (with 6h cooldown applied) and the peak measured value. ' +
      'Useful for picking a sensible threshold before saving.',
  })
  async dryRun(
    @Body() dto: DryRunRequestDto,
    @CurrentAccount() account: Account,
  ) {
    return this.alerts.dryRun(account.id, {
      type: dto.type,
      threshold: dto.threshold,
      applicationId: dto.applicationId,
    })
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
