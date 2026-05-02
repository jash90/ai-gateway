import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AuditRetentionService } from './audit-retention.service'
import { AccountCoolingOffService } from './account-cooling-off.service'
import { AuthModule } from '../auth/auth.module'

/**
 * MaintenanceModule — periodic background jobs:
 *   - AuditRetentionService    @ 03:15 UTC daily
 *   - AccountCoolingOffService @ 04:00 UTC daily
 *
 * ScheduleModule.forRoot() must be imported here exactly once. Multiple
 * registrations cause duplicate cron firings.
 */
@Module({
  imports: [ScheduleModule.forRoot(), AuthModule],
  providers: [AuditRetentionService, AccountCoolingOffService],
  exports: [AuditRetentionService, AccountCoolingOffService],
})
export class MaintenanceModule {}
