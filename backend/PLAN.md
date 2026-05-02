# AI Gateway — Backend Plan (Complete)

> **Stack**: NestJS 11 + Fastify + Prisma 6 + PostgreSQL + Redis + BullMQ + Zod
> **Status**: Partially started — 19 files created (882 linii), ~35 plików do napisania

---

## Existing Code Inventory

Poniżej mapa WSZYSTKICH istniejących plików z oceną czy i jak przechodzą do nowego planu.

### ✅ Reuse bez zmian (10 plików, 679 linii)

Te pliki są gotowe i nie wymagają żadnej modyfikacji.

| # | Plik | Linii | Co robi | Uwagi |
|---|------|------:|---------|-------|
| 1 | `src/config/config.ts` | 26 | Walidacja env (Zod) | Dodać RESEND_API_KEY, SMTP_* gdy email module gotowy |
| 2 | `src/prisma/prisma.service.ts` | 13 | Prisma client lifecycle | Gotowe |
| 3 | `src/common/types/types.ts` | 44 | Shared types (ProviderUsage, ProxyResult, CostBreakdown, CustomerContext) | Dodać typy webhook/entitlement/alert w osobnym pliku |
| 4 | `src/common/guards/api-key.guard.ts` | 42 | API key auth (SHA-256 hash, Bearer + X-API-Key) | Gotowe — używane przez wszystkie chronione endpointy |
| 5 | `src/common/decorators/auth.decorator.ts` | 7 | @Public(), @Admin() dekoratory | Gotowe |
| 6 | `src/common/filters/all-exceptions.filter.ts` | 30 | Global error handler (code + message) | Gotowe |
| 7 | `src/modules/auth/dto/auth.dto.ts` | 14 | registerSchema, rotateKeySchema (Zod) | Gotowe |
| 8 | `src/modules/auth/auth.module.ts` | 11 | Auth module wiring | Gotowe |
| 9 | `src/modules/billing/billing.module.ts` | 11 | Billing module wiring | Gotowe |
| 10 | `src/modules/proxy/providers/provider.interface.ts` | 26 | BaseProvider class + ProviderUsage interface | Gotowe |

### ✅ Reuse + Swagger dekoratory (4 pliki, 388 linii)

Działający kod biznesowy. Jedyna zmiana to dodanie `@ApiTags()`, `@ApiOperation()`, `@ApiResponse()` do controllerów żeby Orval wygenerował poprawne typy.

| # | Plik | Linii | Co robi | Zmiana |
|---|------|------:|---------|--------|
| 11 | `src/modules/auth/auth.service.ts` | 80 | register (API key + wallet 10k kr), rotateKey, getCustomer | Bez zmian |
| 12 | `src/modules/auth/auth.controller.ts` | 32 | POST register, POST rotate-key, GET me | + Swagger dekoratory |
| 13 | `src/modules/billing/billing.service.ts` | 220 | getBalance, burnCredits (atomowa transakcja), topUp, getPricing, resolvePricingFromDb | Bez zmian. burnCredits to serce systemu — atomowa transakcja: wallet update + CreditTransaction + UsageEvent |
| 14 | `src/modules/billing/billing.controller.ts` | 32 | GET balance, POST top-up, GET pricing | + Swagger dekoratory |
| 15 | `src/modules/billing/pricing.service.ts` | 91 | Hardcoded fallback pricing (13 Anthropic + 8 OpenAI modeli), calculateCost, usdToCredits | Bez zmian |

### 🔧 Update (3 pliki, 161 linii)

| # | Plik | Linii | Obecna zawartość | Co trzeba zrobić |
|---|------|------:|------------------|------------------|
| 16 | `src/main.ts` | 8 | Domyślny Express scaffold | Przepisać: FastifyAdapter + SwaggerModule + CORS + global filters |
| 17 | `src/app.module.ts` | 10 | Domyślny AppModule z AppController | Przepisać: wire 10+ modułów (Auth, Billing, Proxy, Usage, Admin, Entitlements, Webhooks, Alerts, Emails, Jobs, Audit, Health) |
| 18 | `prisma/schema.prisma` | 143 | Customer, User, CreditWallet, CreditTransaction, UsageEvent, ProviderCost, TransactionType enum | Dodać 5 nowych modeli (Entitlement, WebhookConfig, WebhookDelivery, AlertRule, AuditLog) + nowe relacje w Customer |

### 🗑 Delete scaffold (3 pliki, 42 linie)

| # | Plik | Powód usunięcia |
|---|------|-----------------|
| 19 | `src/app.controller.ts` | NestJS scaffold — `getHello()` |
| 20 | `src/app.service.ts` | NestJS scaffold — `getHello()` string |
| 21 | `src/app.controller.spec.ts` | NestJS scaffold — test `getHello()` |

### ❌ Nowe pliki do napisania (~35 plików)

Pełna lista w sekcjach poniżej.

---

---

## Architecture Overview

```
src/
├── main.ts
├── app.module.ts
├── config/
│   └── config.ts                            ✅ Done
├── prisma/
│   └── prisma.service.ts                    ✅ Done
├── common/
│   ├── types/types.ts                       ✅ Done
│   ├── guards/
│   │   ├── api-key.guard.ts                 ✅ Done
│   │   ├── admin.guard.ts                   ❌ TODO
│   │   └── throttle.guard.ts                ❌ TODO (per-customer rate limiting)
│   ├── decorators/auth.decorator.ts         ✅ Done
│   ├── filters/all-exceptions.filter.ts     ✅ Done
│   ├── interceptors/
│   │   └── logging.interceptor.ts           ❌ TODO
│   └── middleware/
│       └── request-logger.middleware.ts      ❌ TODO
├── modules/
│   ├── auth/                                ✅ Done
│   ├── billing/                             ✅ Done
│   ├── proxy/                               🔨 In progress
│   │   ├── proxy.module.ts                  ❌
│   │   ├── proxy.controller.ts              ❌
│   │   ├── proxy.service.ts                 ❌
│   │   └── providers/
│   │       ├── provider.interface.ts        ✅
│   │       ├── anthropic.provider.ts        ❌
│   │       └── openai.provider.ts           ❌
│   ├── usage/                               ❌
│   ├── admin/                               ❌
│   ├── entitlements/                        ❌ NEW — feature gating
│   ├── webhooks/                            ❌ NEW — outbound webhooks
│   ├── alerts/                              ❌ NEW — usage/balance alerts
│   ├── emails/                              ❌ NEW — email notifications
│   ├── jobs/                                ❌ NEW — BullMQ background workers
│   ├── audit/                               ❌ NEW — audit log
│   └── health/                              ❌ NEW — health check module
├── sdk/                                     ❌ NEW — TypeScript SDK (separate package)
└── prisma/
    └── migrations/
prisma/
├── schema.prisma                            ✅ (needs extension)
└── seed.ts                                  ❌
```

---

## Phase Priority

```
MVP (Phase 1-4) — core billing SaaS
  ✅ Auth, Billing, Proxy, Usage, Admin
  + Rate limiting, Health check, Background jobs

Phase 5 — Production readiness
  + SDK, Entitlements, Webhooks, Alerts, Email, Audit log

Phase 6 — Growth
  + Stripe payments, Invoices, Multi-currency, Team management
```

---

## NEW: Prisma Schema Extensions

### Entitlements

```prisma
model Entitlement {
  id          String   @id @default(uuid())
  customerId  String   @map("customer_id")
  featureId   String   @map("feature_id")     // "ai-chat", "image-gen", "model:claude-opus"
  limitType   String   @map("limit_type")     // HARD, SOFT, NONE
  limitValue  Int      @map("limit_value")     // credit amount
  period      String   @default("MONTHLY")     // DAILY, MONTHLY, TOTAL
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  customer    Customer @relation(fields: [customerId], references: [id])

  @@unique([customerId, featureId, period])
  @@map("entitlements")
}
```

### Webhooks

```prisma
model WebhookConfig {
  id          String   @id @default(uuid())
  customerId  String   @map("customer_id")
  url         String
  secret      String                          // HMAC signing key
  events      String[]                        // ["usage.threshold", "balance.low", "proxy.error"]
  isActive    Boolean  @default(true) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")

  customer    Customer @relation(fields: [customerId], references: [id])

  @@map("webhook_configs")
}

model WebhookDelivery {
  id            String   @id @default(uuid())
  webhookId     String   @map("webhook_id")
  event         String
  payload       Json
  statusCode    Int?     @map("status_code")
  response      String?
  attempts      Int      @default(0)
  deliveredAt   DateTime? @map("delivered_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@map("webhook_deliveries")
}
```

### Alerts

```prisma
model AlertRule {
  id          String   @id @default(uuid())
  customerId  String   @map("customer_id")
  type        String                          // BALANCE_LOW, USAGE_THRESHOLD, DAILY_LIMIT
  threshold   Int                             // e.g. 20 (% or credits)
  channel     String   @default("email")     // email, webhook, both
  isActive    Boolean  @default(true) @map("is_active")
  lastTriggered DateTime? @map("last_triggered")
  createdAt   DateTime @default(now()) @map("created_at")

  customer    Customer @relation(fields: [customerId], references: [id])

  @@map("alert_rules")
}
```

### Audit Log

```prisma
model AuditLog {
  id          String   @id @default(uuid())
  customerId  String?  @map("customer_id")
  actorType   String   @map("actor_type")    // CUSTOMER, ADMIN, SYSTEM
  actorId     String?  @map("actor_id")
  action      String                          // API_KEY_ROTATED, CREDITS_BURNED, PRICING_UPDATED
  resource    String?                          // "proxy", "billing", "auth"
  metadata    Json?
  ipAddress   String?  @map("ip_address")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([customerId, createdAt])
  @@index([action])
  @@map("audit_logs")
}
```

### Rate Limit Tracking (Redis-backed, no Prisma model needed)

```prisma
// No DB model — use Redis directly
// Key: rate_limit:{customerId}:{endpoint}
// Value: request count (sliding window)
// TTL: window duration
```

### Updated Customer model

```prisma
model Customer {
  // ... existing fields ...
  tier         String   @default("free")      // free, pro, enterprise

  // NEW relations
  entitlements     Entitlement[]
  webhookConfigs   WebhookConfig[]
  alertRules       AlertRule[]
}
```

---

## NEW: Rate Limiting Module

### `src/common/guards/throttle.guard.ts`

**Purpose**: Per-customer rate limiting using Redis sliding window.

```ts
@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(private redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const customer = request.customer;
    if (!customer) return true; // Unauthenticated routes skip

    const key = `rate_limit:${customer.id}:${request.routerPath}`;
    const limit = this.getLimitForTier(customer.tier); // free=30, pro=300, enterprise=3000
    const window = 60; // seconds

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, window);
    }

    request.raw.setHeader('X-RateLimit-Limit', limit);
    request.raw.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      throw new TooManyRequestsException({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Przekroczono limit żądań. Spróbuj za chwilę.',
      });
    }
    return true;
  }

  private getLimitForTier(tier: string): number {
    return { free: 30, pro: 300, enterprise: 3000 }[tier] ?? 30;
  }
}
```

---

## NEW: Entitlements Module

### `src/modules/entitlements/entitlements.service.ts`

**Purpose**: Check if customer can access a feature before proxying.

```ts
@Injectable()
export class EntitlementsService {
  constructor(private prisma: PrismaService) {}

  async checkAccess(customerId: string, featureId: string): Promise<{
    allowed: boolean;
    reason?: string;
    suggestion?: string;
  }> {
    const entitlement = await this.prisma.entitlement.findUnique({
      where: { customerId_featureId_period: { customerId, featureId, period: 'MONTHLY' } },
    });

    if (!entitlement) {
      return { allowed: false, reason: 'Brak uprawnień', suggestion: 'Uaktualnij plan' };
    }

    if (entitlement.limitType === 'NONE') {
      return { allowed: true };
    }

    // Check usage this period
    const periodStart = this.getPeriodStart(entitlement.period);
    const usage = await this.prisma.usageEvent.aggregate({
      where: { customerId, featureId, createdAt: { gte: periodStart } },
      _sum: { creditsBurned: true },
    });

    const totalBurned = usage._sum.creditsBurned ?? 0;
    const remaining = entitlement.limitValue - totalBurned;

    if (remaining <= 0 && entitlement.limitType === 'HARD') {
      return { allowed: false, reason: 'Limit wyczerpany', suggestion: 'Doładuj kredyty lub uaktualnij plan' };
    }

    // SOFT: allow but warn
    return {
      allowed: true,
      ...(entitlement.limitType === 'SOFT' && remaining < entitlement.limitValue * 0.2
        ? { reason: `Zostało ${remaining} kredytów (${featureId})` }
        : {}),
    };
  }

  async setEntitlement(customerId: string, featureId: string, config: {
    limitType: string;
    limitValue: number;
    period: string;
  }) {
    return this.prisma.entitlement.upsert({
      where: { customerId_featureId_period: { customerId, featureId, period: config.period } },
      create: { customerId, featureId, ...config },
      update: { ...config },
    });
  }
}
```

### `src/modules/entitlements/entitlements.controller.ts`

```
POST /v1/entitlements/check    → Check access (called by proxy before forwarding)
GET  /v1/entitlements          → List entitlements for customer
POST /v1/admin/entitlements    → Set entitlement (admin only)
```

### Integration with Proxy

In `proxy.service.ts`, before forwarding to provider:

```ts
// Check entitlement
const access = await this.entitlementsService.checkAccess(customerId, featureId);
if (!access.allowed) {
  throw new ForbiddenException({ code: 'ACCESS_DENIED', message: access.reason, suggestion: access.suggestion });
}
```

---

## NEW: Webhooks Module

### `src/modules/webhooks/webhooks.service.ts`

**Purpose**: Send outbound webhooks when events occur (low balance, usage threshold, proxy errors).

**Events emitted**:
```
balance.low         → Balance dropped below threshold
usage.threshold     → Usage hit X% of limit
credits.burned      → Credits deducted (optional, high volume)
api_key.rotated     → API key was rotated
subscription.changed → Tier changed
```

**Delivery logic**:
1. Find all active webhook configs for customer matching the event
2. Create `WebhookDelivery` record (pending)
3. Send HTTP POST with HMAC-signed payload
4. On failure: retry up to 3 times with exponential backoff (via BullMQ)
5. Update delivery record with status code + response

```ts
async emitEvent(customerId: string, event: string, payload: Record<string, unknown>) {
  const configs = await this.prisma.webhookConfig.findMany({
    where: { customerId, isActive: true, events: { has: event } },
  });

  for (const config of configs) {
    // Queue delivery via BullMQ
    await this.webhookQueue.add('deliver', {
      webhookId: config.id,
      url: config.url,
      secret: config.secret,
      event,
      payload,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
```

**Webhook payload format**:
```json
{
  "id": "evt_uuid",
  "type": "balance.low",
  "timestamp": "2026-05-01T12:00:00Z",
  "data": {
    "customerId": "...",
    "balance": 420,
    "threshold": 1000
  },
  "signature": "sha256=abc123..."
}
```

### `src/modules/webhooks/webhooks.controller.ts`

```
POST   /v1/webhooks             → Create webhook config
GET    /v1/webhooks             → List webhook configs
DELETE /v1/webhooks/:id         → Delete webhook config
GET    /v1/webhooks/:id/deliveries → Delivery history
POST   /v1/webhooks/:id/test    → Send test webhook
```

---

## NEW: Alerts Module

### `src/modules/alerts/alerts.service.ts`

**Purpose**: Evaluate alert rules after each billing event, trigger notifications.

**Triggers**:
- After `burnCredits()` → check `BALANCE_LOW` rules
- After `ingestEvent()` → check `USAGE_THRESHOLD` rules
- Cron (hourly) → check `DAILY_LIMIT` rules

```ts
async evaluateAlerts(customerId: string, event: 'burn' | 'ingest', context: {
  newBalance?: number;
  creditsBurned?: number;
}) {
  const rules = await this.prisma.alertRule.findMany({
    where: { customerId, isActive: true },
  });

  for (const rule of rules) {
    if (rule.type === 'BALANCE_LOW' && context.newBalance !== undefined) {
      if (context.newBalance <= rule.threshold) {
        // Debounce: don't re-trigger within 24h
        if (rule.lastTriggered && Date.now() - rule.lastTriggered.getTime() < 86_400_000) continue;

        await this.triggerAlert(rule, { balance: context.newBalance, threshold: rule.threshold });
        await this.prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggered: new Date() },
        });
      }
    }
  }
}
```

### `src/modules/alerts/alerts.controller.ts`

```
POST   /v1/alerts              → Create alert rule
GET    /v1/alerts              → List alert rules
DELETE /v1/alerts/:id          → Delete alert rule
PATCH  /v1/alerts/:id          → Update alert rule
```

---

## NEW: Email Module

### `src/modules/emails/emails.service.ts`

**Purpose**: Send transactional emails via Resend (or SendGrid).

**Emails**:
```
welcome         → After registration (API key, quick start guide)
low_balance     → Balance below threshold (triggered by Alerts module)
invoice         → After credit purchase (triggered by Billing module)
api_key_rotated → Confirmation after key rotation
usage_report    → Weekly/monthly usage summary (cron job)
```

```ts
@Injectable()
export class EmailsService {
  private readonly resend: Resend;

  async sendWelcome(customer: { name: string; email: string }, apiKey: string) {
    await this.resend.emails.send({
      from: 'AI Gateway <noreply@aigateway.dev>',
      to: customer.email,
      subject: 'Witaj w AI Gateway — Twój klucz API',
      html: this.renderTemplate('welcome', { name: customer.name, apiKey }),
    });
  }

  async sendLowBalance(customer: { email: string }, balance: number) {
    await this.resend.emails.send({
      from: 'AI Gateway <noreply@aigateway.dev>',
      to: customer.email,
      subject: 'Niskie saldo — zostało ' + balance + ' kredytów',
      html: this.renderTemplate('low_balance', { balance }),
    });
  }
}
```

---

## NEW: Background Jobs Module (BullMQ)

### `src/modules/jobs/jobs.module.ts`

**Purpose**: Centralized BullMQ queues for async processing.

**Queues**:
```
webhook-deliveries  → Outbound webhook delivery (retries, DLQ)
usage-processing    → Async usage event processing (aggregate, alert evaluation)
email-sending       → Email delivery (async, retries)
report-generation   → Usage reports (daily/weekly cron)
```

```ts
// jobs.module.ts
@Module({
  providers: [
    {
      provide: 'WEBHOOK_QUEUE',
      useFactory: (redis: Redis) => new Queue('webhook-deliveries', { connection: redis }),
      inject: ['REDIS'],
    },
    {
      provide: 'USAGE_QUEUE',
      useFactory: (redis: Redis) => new Queue('usage-processing', { connection: redis }),
      inject: ['REDIS'],
    },
    {
      provide: 'EMAIL_QUEUE',
      useFactory: (redis: Redis) => new Queue('email-sending', { connection: redis }),
      inject: ['REDIS'],
    },
  ],
})
export class JobsModule {}
```

**Workers** (in `src/modules/jobs/workers/`):
- `webhook.worker.ts` — HTTP POST + HMAC + retries
- `usage.worker.ts` — Aggregate stats + evaluate alerts
- `email.worker.ts` — Send via Resend

---

## NEW: Audit Log Module

### `src/modules/audit/audit.service.ts`

```ts
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    customerId?: string;
    actorType: string;
    actorId?: string;
    action: string;
    resource?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    await this.prisma.auditLog.create({ data: params });
  }

  async getLogs(filters: {
    customerId?: string;
    action?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 25, ...where } = filters;
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          ...(where.customerId ? { customerId: where.customerId } : {}),
          ...(where.action ? { action: where.action } : {}),
          ...(where.from || where.to ? { createdAt: { gte: where.from, lte: where.to } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return { logs, total, page, limit };
  }
}
```

**Logged actions**:
```
AUTH_REGISTER        → Customer registered
API_KEY_ROTATED      → Key rotated
CREDITS_BURNED       → Credits deducted
CREDITS_TOPPED_UP    → Credits added
PROXY_REQUEST        → AI proxy call
PRICING_UPDATED      → Admin changed pricing
ENTITLEMENT_SET      → Admin set entitlement
WEBHOOK_CREATED      → Webhook config created
ALERT_TRIGGERED      → Alert rule fired
```

---

## NEW: Health Check Module

### `src/modules/health/health.controller.ts`

```ts
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @Inject('REDIS') private redis: Redis,
  ) {}

  @Get()
  async check() {
    const [db, cache] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    return {
      status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: db.status === 'fulfilled' ? 'ok' : 'error',
        redis: cache.status === 'fulfilled' ? 'ok' : 'error',
      },
      uptime: process.uptime(),
    };
  }
}
```

---

## NEW: TypeScript SDK

### `packages/sdk/` — separate npm package

```ts
// packages/sdk/src/index.ts
export class AIGatewayClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.aigateway.dev/v1';
  }

  // Proxy
  async chat(params: ChatParams): Promise<ChatResponse> { ... }
  async chatStream(params: ChatParams): AsyncIterable<ChatChunk> { ... }

  // Usage tracking (for non-proxy usage)
  async trackUsage(event: UsageEvent): Promise<void> { ... }

  // Balance
  async getBalance(): Promise<BalanceInfo> { ... }

  // Entitlements
  async checkAccess(featureId: string): Promise<AccessCheck> { ... }
}
```

**Install**: `npm install @ai-gateway/sdk`

**Usage**:
```ts
import { AIGatewayClient } from '@ai-gateway/sdk'

const client = new AIGatewayClient({ apiKey: 'om_live_xxx' })

// Proxy with automatic billing
const response = await client.chat({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 1024,
})

console.log(response.usage)    // { inputTokens: 12, outputTokens: 45, cost: 0.0042 }
console.log(response.content)  // "Hello! How can I help?"

// Stream
for await (const chunk of client.chatStream({ ... })) {
  process.stdout.write(chunk.text)
}

// Track your own usage (without proxy)
await client.trackUsage({
  provider: 'openai',
  model: 'gpt-4o',
  inputTokens: 1000,
  outputTokens: 500,
})
```

---

## Complete API Summary

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/auth/register` | Public | Register → API key + 10k credits |
| POST | `/v1/auth/rotate-key` | API Key | Rotate API key |
| GET | `/v1/auth/me` | API Key | Get customer info |

### Billing
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/billing/balance` | API Key | Wallet balance |
| POST | `/v1/billing/top-up` | API Key | Add credits (manual) |
| GET | `/v1/billing/pricing` | Public | View pricing table |
| GET | `/v1/billing/transactions` | API Key | Transaction history |

### Proxy
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/proxy/anthropic/messages` | API Key | Proxy → Anthropic + meter |
| POST | `/v1/proxy/openai/chat/completions` | API Key | Proxy → OpenAI + meter |
| POST | `/v1/proxy/chat` | API Key | Auto-detect + meter |

### Usage
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/usage/ingest` | API Key | Ingest usage event |
| GET | `/v1/usage/stats` | API Key | Usage analytics |
| GET | `/v1/usage/events` | API Key | Paginated event history |

### Entitlements
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/entitlements/check` | API Key | Check feature access |
| GET | `/v1/entitlements` | API Key | List entitlements |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/webhooks` | API Key | Create webhook |
| GET | `/v1/webhooks` | API Key | List webhooks |
| DELETE | `/v1/webhooks/:id` | API Key | Delete webhook |
| GET | `/v1/webhooks/:id/deliveries` | API Key | Delivery history |
| POST | `/v1/webhooks/:id/test` | API Key | Send test webhook |

### Alerts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/alerts` | API Key | Create alert rule |
| GET | `/v1/alerts` | API Key | List alert rules |
| PATCH | `/v1/alerts/:id` | API Key | Update alert rule |
| DELETE | `/v1/alerts/:id` | API Key | Delete alert rule |

### Admin
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/admin/pricing` | Admin | Set provider cost |
| DELETE | `/v1/admin/pricing/:id` | Admin | Delete pricing |
| GET | `/v1/admin/customers` | Admin | List customers |
| GET | `/v1/admin/analytics` | Admin | System analytics |
| POST | `/v1/admin/entitlements` | Admin | Set entitlement |
| GET | `/v1/admin/audit-logs` | Admin | Audit log |

### System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Health check |
| GET | `/docs` | Public | Swagger UI |
| GET | `/docs-json` | Public | OpenAPI spec (for Orval) |

---

## Execution Phases (Updated)

### Phase 1 — Core Infrastructure
1. Update `main.ts` → Fastify + Swagger + CORS
2. Update `app.module.ts` → wire all modules
3. Delete scaffold files
4. `health/` module — health check endpoint
5. `throttle.guard.ts` — per-customer rate limiting (Redis)

### Phase 2 — Proxy (core feature)
6. `anthropic.provider.ts` — Anthropic proxy + cache tokens + streaming SSE
7. `openai.provider.ts` — OpenAI proxy + cached tokens + streaming SSE
8. `proxy.service.ts` — orchestrate + entitlements check + meter
9. `proxy.controller.ts` — HTTP endpoints (Fastify streaming)
10. `proxy.module.ts`

### Phase 3 — Usage & Admin
11. `usage.service.ts` + `usage.controller.ts` + `usage.module.ts`
12. `admin.service.ts` + `admin.controller.ts` + `admin.module.ts`
13. `prisma/seed.ts` — seed pricing data

### Phase 4 — Background Jobs
14. `jobs.module.ts` — BullMQ queues + Redis connection
15. `webhook.worker.ts` — outbound webhook delivery
16. `usage.worker.ts` — async usage aggregation
17. `email.worker.ts` — async email delivery

### Phase 5 — Entitlements
18. Extend Prisma schema (Entitlement model)
19. `entitlements.service.ts` — access checks
20. `entitlements.controller.ts`
21. Wire into `proxy.service.ts` — check before forwarding

### Phase 6 — Webhooks
22. Extend Prisma schema (WebhookConfig, WebhookDelivery)
23. `webhooks.service.ts` — emit events, HMAC signing
24. `webhooks.controller.ts` — CRUD + test + delivery history

### Phase 7 — Alerts & Email
25. Extend Prisma schema (AlertRule)
26. `alerts.service.ts` — evaluate rules after billing events
27. `alerts.controller.ts` — CRUD
28. `emails.service.ts` — Resend integration
29. Wire: billing → alerts → email + webhooks

### Phase 8 — Audit Log
30. Extend Prisma schema (AuditLog)
31. `audit.service.ts` — log actions
32. Wire into: auth, billing, proxy, admin controllers

### Phase 9 — TypeScript SDK
33. `packages/sdk/` — client class, types, streaming
34. `packages/sdk/` — tests, README, npm publish config

### Phase 10 — Swagger & Polish
35. Add `@ApiTags`, `@ApiOperation`, `@ApiResponse` to ALL endpoints
36. Verify `/docs-json` returns complete OpenAPI spec
37. Docker Compose for local dev (PostgreSQL + Redis)
38. `.env.example` updated with all new env vars

---

## Key Design Decisions

1. **Ex-post billing**: Deduct AFTER provider responds. Pre-check only verifies minimum balance.
2. **Hardcoded pricing fallback**: DB entries take precedence, hardcoded tables as safety net.
3. **Cache tokens**: Anthropic `cache_read` + `cache_creation`, OpenAI `cached_tokens` only.
4. **Credits**: `1000 credits = $1 USD`. Integers for precision.
5. **Idempotency**: `idempotencyKey` on UsageEvent, CreditTransaction, webhook deliveries.
6. **Fastify**: ~2x throughput, native streaming for SSE proxy.
7. **Redis**: Rate limiting + BullMQ queues + caching. Single Redis instance for all.
8. **BullMQ**: Async webhook delivery, email sending, usage aggregation. Retries + DLQ.
9. **HMAC webhooks**: SHA-256 signature on every outbound webhook payload.
10. **Alert debouncing**: Same alert won't re-trigger within 24h.
11. **Audit log**: Append-only, no deletes. Admin can read, not modify.
12. **SDK**: Zero-dep TypeScript client. Streaming via async iterables.
13. **Rate limits per tier**: free=30/min, pro=300/min, enterprise=3000/min.
14. **Entitlements**: HARD (block) vs SOFT (warn) vs NONE (unlimited). Per feature + period.
