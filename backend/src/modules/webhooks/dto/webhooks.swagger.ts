import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhook' }) url: string
  @ApiProperty({ example: ['balance.low', 'usage.threshold'], type: [String] }) events: string[]
}

export class WebhookConfigDto {
  @ApiProperty() id: string
  @ApiProperty() url: string
  @ApiProperty({ type: [String] }) events: string[]
  @ApiProperty() secret: string
  @ApiProperty() isActive: boolean
  @ApiProperty() createdAt: string
}

export class WebhookDeliveryDto {
  @ApiProperty() id: string
  @ApiProperty() webhookConfigId: string
  @ApiProperty() event: string
  @ApiPropertyOptional({ type: "object", additionalProperties: true }) payload: Record<string, unknown>
  @ApiPropertyOptional() statusCode: number
  @ApiPropertyOptional() response: string
  @ApiPropertyOptional() deliveredAt: string
  @ApiProperty() createdAt: string
}

export class WebhookDeliveryListDto {
  @ApiProperty({ type: [WebhookDeliveryDto] }) data: WebhookDeliveryDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() limit: number
}
