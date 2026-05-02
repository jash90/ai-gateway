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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { ApplicationsService } from './applications.service'
import {
  CreateApplicationDto,
  UpdateApplicationDto,
  ListApplicationsQueryDto,
  ApplicationSummaryDto,
  ApplicationDetailDto,
  ApplicationListResponseDto,
  parseIncludeInactive,
} from './dto/applications.dto'

@ApiTags('applications')
@ApiBearerAuth('bearer')
@Controller('v1/apps')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private apps: ApplicationsService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'List of applications.', type: ApplicationListResponseDto })
  @ApiOperation({ summary: "List the current account's applications" })
  async list(
    @Query() query: ListApplicationsQueryDto,
    @CurrentAccount() account: Account,
  ) {
    return this.apps.list(account.id, parseIncludeInactive(query.includeInactive))
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse({ status: 201, description: 'Application created.', type: ApplicationSummaryDto })
  @ApiOperation({ summary: 'Create a new application' })
  async create(
    @Body() dto: CreateApplicationDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.apps.create(account.id, dto, extractContext(req))
  }

  @Get(':id')
  @ZodResponse({ status: 200, description: 'Application detail.', type: ApplicationDetailDto })
  @ApiOperation({ summary: 'Get application detail with key counts and last usage' })
  @ApiResponse({ status: 404, description: 'Not found (or owned by another account).' })
  async getById(@Param('id') id: string, @CurrentAccount() account: Account) {
    return this.apps.getById(account.id, id)
  }

  @Patch(':id')
  @ZodResponse({ status: 200, description: 'Application updated.', type: ApplicationSummaryDto })
  @ApiOperation({ summary: 'Update application name / description / active state' })
  @ApiResponse({ status: 404, description: 'Not found.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ) {
    return this.apps.update(account.id, id, dto, extractContext(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an application (only if no usage rows)' })
  @ApiResponse({ status: 204, description: 'Application deleted.' })
  @ApiResponse({ status: 404, description: 'Not found.' })
  @ApiResponse({ status: 409, description: 'Application has usage rows; disable instead.' })
  async delete(
    @Param('id') id: string,
    @CurrentAccount() account: Account,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.apps.delete(account.id, id, extractContext(req))
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
