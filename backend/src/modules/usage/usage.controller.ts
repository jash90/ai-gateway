import { Controller, Post, Get, Body, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiBody } from '@nestjs/swagger'
import { UsageService } from './usage.service'
import { ApiKeyGuard } from '../../common/guards/api-key.guard'
import { z } from 'zod'
import { IngestEventDto, UsageStatsDto, UsageEventListDto } from './dto/usage.swagger'

const ingestSchema = z.object({
  eventType: z.string().min(1),
  featureId: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  creditsBurned: z.number().default(0),
  costUsd: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
  userId: z.string().optional(),
}).strict()

@ApiTags('Usage')
@Controller('v1/usage')
export class UsageController {
  constructor(private usageService: UsageService) {}

  @Post('ingest')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Ingest usage event' })
  @ApiBody({ type: IngestEventDto })
  @ApiResponse({ status: 201, description: 'Event recorded' })
  async ingest(@Body() body: unknown, @Req() req: any) {
    const input = ingestSchema.parse(body)
    return this.usageService.ingestEvent({
      customerId: req.customer.id,
      ...input,
    })
  }

  @Get('stats')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Usage statistics' })
  @ApiResponse({ status: 200, type: UsageStatsDto })
  async stats(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usageService.getStats(
      req.customer.id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    )
  }

  @Get('events')
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Usage events' })
  @ApiResponse({ status: 200, type: UsageEventListDto })
  async events(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usageService.getEvents(
      req.customer.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 25,
    )
  }
}
