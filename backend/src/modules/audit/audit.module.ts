import { Module, forwardRef } from '@nestjs/common'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  // forwardRef breaks the cycle: AuthModule → AuditModule (for AuditService),
  // AuditModule → AuthModule (for AdminGuard used in AuditController).
  imports: [forwardRef(() => AuthModule)],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
