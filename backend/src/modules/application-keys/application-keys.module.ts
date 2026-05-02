import { Module } from '@nestjs/common'
import { ApplicationKeysController } from './application-keys.controller'
import { ApplicationKeysService } from './application-keys.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { WebhooksModule } from '../webhooks/webhooks.module'

@Module({
  imports: [AuthModule, AuditModule, WebhooksModule],
  controllers: [ApplicationKeysController],
  providers: [ApplicationKeysService],
  exports: [ApplicationKeysService],
})
export class ApplicationKeysModule {}
