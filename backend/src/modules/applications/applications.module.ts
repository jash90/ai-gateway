import { Module } from '@nestjs/common'
import { ApplicationsController } from './applications.controller'
import { ApplicationsService } from './applications.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { WebhooksModule } from '../webhooks/webhooks.module'

@Module({
  imports: [AuthModule, AuditModule, WebhooksModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
