import { Module } from '@nestjs/common'
import { EncryptionService } from './encryption.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
