import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { FastifyRequest } from 'fastify'
import { AdminGuard } from '../../common/guards/admin.guard'
import { FeatureFlagsService } from './feature-flags.service'
import {
  FeatureFlagListDto,
  ListFeatureFlagsQueryDto,
  UpsertFeatureFlagDto,
} from './dto/feature-flags.dto'

@ApiTags('feature-flags')
@ApiBearerAuth('bearer')
@ApiSecurity('admin-key')
@Controller('v1/admin/feature-flags')
@UseGuards(AdminGuard)
export class FeatureFlagsController {
  constructor(private flags: FeatureFlagsService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'List feature flags.', type: FeatureFlagListDto })
  @ApiOperation({ summary: 'List feature flags (admin)' })
  async list(@Query() query: ListFeatureFlagsQueryDto) {
    const { flags, total } = await this.flags.list(query)
    return {
      flags: flags.map((f) => ({
        id: f.id,
        key: f.key,
        scope: f.scope as 'global' | 'account',
        accountId: f.accountId,
        enabled: f.enabled,
        payload: f.payload,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      total,
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert a feature flag (admin)' })
  async upsert(@Body() dto: UpsertFeatureFlagDto, @Req() req: FastifyRequest) {
    const actor = req.account
      ? { actorId: req.account.id, actorType: 'ADMIN' as const }
      : { actorId: 'legacy-admin-key', actorType: 'SYSTEM' as const }
    const flag = await this.flags.upsert(dto, actor, extractContext(req))
    return {
      id: flag.id,
      key: flag.key,
      scope: flag.scope,
      accountId: flag.accountId,
      enabled: flag.enabled,
      payload: flag.payload,
      createdAt: flag.createdAt.toISOString(),
      updatedAt: flag.updatedAt.toISOString(),
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a feature flag (admin)' })
  async delete(@Param('id') id: string, @Req() req: FastifyRequest): Promise<void> {
    const actor = req.account
      ? { actorId: req.account.id, actorType: 'ADMIN' as const }
      : { actorId: 'legacy-admin-key', actorType: 'ADMIN' as const }
    await this.flags.delete(id, actor, extractContext(req))
  }
}

function extractContext(req: FastifyRequest): { ipAddress?: string; userAgent?: string } {
  const xff = req.headers['x-forwarded-for']
  const ipAddress =
    (Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim()) || req.ip || undefined
  const ua = req.headers['user-agent']
  return { ipAddress, userAgent: typeof ua === 'string' ? ua : undefined }
}
