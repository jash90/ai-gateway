import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateAlertDto {
  @ApiProperty({ enum: ['BALANCE_LOW', 'USAGE_THRESHOLD', 'DAILY_LIMIT'] }) type: string
  @ApiProperty({ example: 1000 }) threshold: number
  @ApiProperty({ enum: ['email', 'webhook', 'both'], example: 'email' }) channel: string
}

export class UpdateAlertDto {
  @ApiPropertyOptional() threshold: number
  @ApiPropertyOptional({ enum: ['email', 'webhook', 'both'] }) channel: string
  @ApiPropertyOptional() isActive: boolean
}

export class AlertRuleDto {
  @ApiProperty() id: string
  @ApiProperty() type: string
  @ApiProperty() threshold: number
  @ApiProperty() channel: string
  @ApiProperty() isActive: boolean
  @ApiPropertyOptional() lastTriggeredAt: string
  @ApiProperty() createdAt: string
}
