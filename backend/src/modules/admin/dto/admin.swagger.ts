import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class SetPricingDto {
  @ApiProperty({ example: 'anthropic' }) provider: string
  @ApiProperty({ example: 'claude-sonnet-4-5' }) model: string
  @ApiProperty({ example: 'per_token' }) costType: string
  @ApiProperty({ example: 0.003 }) costPerUnit: number
  @ApiPropertyOptional({ example: 1000000 }) unitSize: number
}

export class AdminCustomerDto {
  @ApiProperty() id: string
  @ApiProperty() name: string
  @ApiProperty() email: string
  @ApiProperty({ example: 'free' }) tier: string
  @ApiProperty() isActive: boolean
  @ApiProperty({ example: 10000 }) balance: number
  @ApiProperty({ example: 5000 }) totalCreditsUsed: number
  @ApiProperty() createdAt: string
}

export class AdminCustomerListDto {
  @ApiProperty({ type: [AdminCustomerDto] }) data: AdminCustomerDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() limit: number
}

export class AdminAnalyticsDto {
  @ApiProperty() totalCustomers: number
  @ApiProperty() activeCustomers: number
  @ApiProperty() totalRequests24h: number
  @ApiProperty() revenue30d: number
}

export class AuditLogDto {
  @ApiProperty() id: string
  @ApiPropertyOptional() customerId: string
  @ApiProperty() actorType: string
  @ApiPropertyOptional() actorId: string
  @ApiProperty() action: string
  @ApiPropertyOptional() resource: string
  @ApiPropertyOptional({ type: "object", additionalProperties: true }) metadata: Record<string, unknown>
  @ApiPropertyOptional() ipAddress: string
  @ApiProperty() createdAt: string
}

export class AuditLogListDto {
  @ApiProperty({ type: [AuditLogDto] }) logs: AuditLogDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() limit: number
}
