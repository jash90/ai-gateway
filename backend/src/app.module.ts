import { Module, Global } from '@nestjs/common'
import { APP_GUARD, APP_PIPE } from '@nestjs/core'
import Redis from 'ioredis'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ZodValidationPipe } from './common/pipes/zod.pipe'
import { AuthModule } from './modules/auth/auth.module'
import { HealthModule } from './modules/health/health.module'
import { EmailsModule } from './modules/emails/emails.module'
import { AuditModule } from './modules/audit/audit.module'
import { CryptoModule } from './modules/crypto/crypto.module'
import { ApplicationsModule } from './modules/applications/applications.module'
import { ApplicationKeysModule } from './modules/application-keys/application-keys.module'
import { ProviderKeysModule } from './modules/provider-keys/provider-keys.module'
import { GatewayModule } from './modules/gateway/gateway.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { MaintenanceModule } from './modules/maintenance/maintenance.module'
import { AdminModule } from './modules/admin/admin.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module'
import { AlertsModule } from './modules/alerts/alerts.module'
import { WalletModule } from './modules/wallet/wallet.module'
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module'
import { BillingModule } from './modules/billing/billing.module'
import { PrismaService } from './prisma/prisma.service'

function parseRedisUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
  }
}

// =============================================================================
// Modules disabled by BE-S1-002 (hard cutover) — to be rebuilt incrementally:
//
//   - BillingModule       — DROPPED (D-005 / no billing in MVP)
//   - EntitlementsModule  — DROPPED
//   - ProxyModule         — Sprint 2 (rebuilt as gateway/* with /v1/chat/completions)
//   - UsageModule         — Sprint 2 (rewired as UsageRecorder + analytics endpoints)



//   - JobsModule          — Sprint 2 (UsageRecorder + email queues stay; usage.worker rewritten)
//
// All four service files in those modules currently reference legacy Prisma
// models (Customer, CreditWallet, providerCost) and won't compile until refactored.
// =============================================================================

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global throttling baseline. Per-route overrides via @Throttle({...}).
    // Trusts X-Forwarded-For only inside getTracker (Fastify already merges).
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 1 minute
        limit: 60, // 60 req/min/IP
      },
    ]),
    BullModule.forRoot({
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    }),
    AuthModule,
    HealthModule,
    EmailsModule,
    AuditModule,
    CryptoModule,
    ApplicationsModule,
    ApplicationKeysModule,
    ProviderKeysModule,
    GatewayModule,
    AnalyticsModule,
    MaintenanceModule,
    AdminModule,
    WebhooksModule,
    AlertsModule,
    WalletModule,
    FeatureFlagsModule,
    BillingModule,
  ],
  providers: [
    PrismaService,
    // Global Zod validation — every controller method with a DTO that extends
    // `createZodDto(...)` gets validated automatically. See ./common/pipes/zod.pipe.ts.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Global rate-limiting. Baseline 60 req/min/IP; sensitive routes override
    // with @Throttle({...}) decorators (see auth.controller.ts).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: 'REDIS',
      useFactory: () => {
        const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
        return new Redis(url)
      },
    },
  ],
  exports: ['REDIS', PrismaService],
})
export class AppModule {}
