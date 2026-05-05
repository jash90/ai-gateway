import { Module } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { WalletModule } from '../wallet/wallet.module'

@Module({
  // AuditModule needed transitively for AdminGuard (which needs AuditService).
  // forwardRef(AuditModule) inside AuthModule isn't enough — AuditService must
  // also be visible from AdminModule's import scope.
  // WalletModule provides WalletService used by /admin/accounts/:id/wallet/grant.
  imports: [AuthModule, AuditModule, WalletModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
