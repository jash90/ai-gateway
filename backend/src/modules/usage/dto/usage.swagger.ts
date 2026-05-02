import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class UsageEventDto {
  @ApiProperty() id: string
  @ApiProperty() eventType: string
  @ApiProperty() featureId: string
  @ApiPropertyOptional() provider: string
  @ApiPropertyOptional() model: string
  @ApiProperty({ example: 100 }) inputTokens: number
  @ApiProperty({ example: 50 }) outputTokens: number
  @ApiProperty({ example: 15 }) creditsBurned: number
  @ApiPropertyOptional() costUsd: number
  @ApiPropertyOptional({ type: "object", additionalProperties: true }) metadata: Record<string, unknown>
  @ApiProperty() createdAt: string
}

export class UsageEventListDto {
  @ApiProperty({ type: [UsageEventDto] }) data: UsageEventDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() limit: number
}

export class IngestEventDto {
  @ApiProperty() eventType: string
  @ApiProperty() featureId: string
  @ApiPropertyOptional() provider: string
  @ApiPropertyOptional() model: string
  @ApiPropertyOptional({ example: 100 }) inputTokens: number
  @ApiPropertyOptional({ example: 50 }) outputTokens: number
  @ApiPropertyOptional() cacheReadTokens: number
  @ApiPropertyOptional() cacheCreationTokens: number
  @ApiPropertyOptional() creditsBurned: number
  @ApiPropertyOptional() costUsd: number
  @ApiPropertyOptional({ type: "object", additionalProperties: true }) metadata: Record<string, unknown>
  @ApiPropertyOptional() idempotencyKey: string
  @ApiPropertyOptional() userId: string
}

export class UsageByDayItemDto {
  @ApiProperty() date: string
  @ApiProperty() requests: number
  @ApiProperty() credits: number
}

export class UsageStatsDto {
  @ApiProperty() totalRequests: number
  @ApiProperty() totalInputTokens: number
  @ApiProperty() totalOutputTokens: number
  @ApiProperty() totalCreditsBurned: number
  @ApiProperty() byModel: Record<string, unknown>
  @ApiProperty({ type: [UsageByDayItemDto] }) byDay: UsageByDayItemDto[]
}
