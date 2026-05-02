import { Module } from '@nestjs/common'
import { ProxyController } from './proxy.controller'
import { ProxyService } from './proxy.service'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenAIProvider } from './providers/openai.provider'
import { BillingModule } from '../billing/billing.module'
import { EntitlementsModule } from '../entitlements/entitlements.module'
import { AuditModule } from '../audit/audit.module'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [BillingModule, EntitlementsModule, AuditModule, ConfigModule],
  controllers: [ProxyController],
  providers: [ProxyService, AnthropicProvider, OpenAIProvider],
})
export class ProxyModule {}
