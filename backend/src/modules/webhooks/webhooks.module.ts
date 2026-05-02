import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { WebhooksController } from './webhooks.controller'
import { WebhooksService } from './webhooks.service'
import { WebhookDeliveryWorker, WEBHOOK_DELIVERY_QUEUE } from './workers/webhook-delivery.worker'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [
    AuthModule,
    AuditModule,
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryWorker],
  exports: [WebhooksService],
})
export class WebhooksModule {}
