import { Module } from '@nestjs/common'
import { ProviderKeysController } from './provider-keys.controller'
import { ProviderKeysService } from './provider-keys.service'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { CryptoModule } from '../crypto/crypto.module'
import { WebhooksModule } from '../webhooks/webhooks.module'

@Module({
  // Note: GatewayModule's ByokKeyResolverService caches plaintext for 60s.
  // After ProviderKey CRUD here, the gateway cache invalidates by TTL within 60s.
  // Explicit invalidation would require a forwardRef cycle — skipped for MVP.
  imports: [AuthModule, AuditModule, CryptoModule, WebhooksModule],
  controllers: [ProviderKeysController],
  providers: [ProviderKeysService],
  exports: [ProviderKeysService],
})
export class ProviderKeysModule {}
