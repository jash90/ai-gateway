import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { Account } from '@prisma/client'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { AnalyticsService } from './analytics.service'
import {
  OverviewQueryDto,
  BreakdownQueryDto,
  TimeseriesQueryDto,
  EventsQueryDto,
  OverviewResponseDto,
  BreakdownResponseDto,
  TimeseriesResponseDto,
  EventsResponseDto,
} from './dto/analytics.dto'

const DEFAULT_LIMIT = 50

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@Controller('v1/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('overview')
  @ZodResponse({ status: 200, description: 'Top-line metrics for the date range.', type: OverviewResponseDto })
  @ApiOperation({
    summary: 'Overview metrics',
    description: 'Total requests, tokens, cost, latency (avg + p95), error rate.',
  })
  async overview(@Query() query: OverviewQueryDto, @CurrentAccount() account: Account) {
    return this.analytics.overview(account.id, parseDateRange(query))
  }

  @Get('breakdown')
  @ZodResponse({ status: 200, description: 'Group-by aggregation.', type: BreakdownResponseDto })
  @ApiOperation({
    summary: 'Breakdown by dimension',
    description: 'Group usage by app / model / provider / endUser. Returns rows sorted by request count desc.',
  })
  async breakdown(@Query() query: BreakdownQueryDto, @CurrentAccount() account: Account) {
    return this.analytics.breakdown(account.id, parseDateRange(query), query.dimension)
  }

  @Get('timeseries')
  @ZodResponse({ status: 200, description: 'Bucketed time series.', type: TimeseriesResponseDto })
  @ApiOperation({
    summary: 'Time series for a metric',
    description: 'Buckets by hour or day. Metrics: requests / tokens / cost / latency_p95.',
  })
  async timeseries(@Query() query: TimeseriesQueryDto, @CurrentAccount() account: Account) {
    return this.analytics.timeseries(
      account.id,
      parseDateRange(query),
      query.metric,
      query.granularity,
    )
  }

  @Get('events')
  @ZodResponse({ status: 200, description: 'Cursor-paginated event feed.', type: EventsResponseDto })
  @ApiOperation({
    summary: 'Event feed with cursor pagination',
    description: 'Recent UsageEvent rows, newest first. Pass nextCursor as ?cursor= for next page.',
  })
  async events(@Query() query: EventsQueryDto, @CurrentAccount() account: Account) {
    return this.analytics.events(account.id, {
      ...parseDateRange(query),
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_LIMIT,
      provider: query.provider,
      status: query.status,
      model: query.model,
    })
  }
}

// =============================================================================
// Helpers
// =============================================================================

const DEFAULT_RANGE_DAYS = 30

function parseDateRange(query: { from?: string; to?: string; applicationId?: string }) {
  const to = query.to ? new Date(query.to) : new Date()
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000)
  return { from, to, applicationId: query.applicationId }
}
