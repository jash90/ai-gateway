import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'
import { AlertsEvaluatorService } from './alerts.evaluator.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { WebhooksModule } from '../webhooks/webhooks.module'
import { EmailsModule } from '../emails/emails.module'

/**
 * AlertsModule:
 *   - AlertsService            : CRUD for AlertRule
 *   - AlertsEvaluatorService   : @Cron('*\u200d/15 * * * *') sweep, dispatches via webhooks/emails
 *
 * ScheduleModule.forRoot is provided by MaintenanceModule (singleton). The
 * @Cron decorator on AlertsEvaluatorService will be picked up automatically.
 */
@Module({
  imports: [AuthModule, AuditModule, WebhooksModule, EmailsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsEvaluatorService],
  exports: [AlertsService],
})
export class AlertsModule {}
