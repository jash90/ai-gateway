# BYOK + Stripe Billing + Multi-Application Analytics — Plan

> **Skrót**: gateway przejmuje model **BYOK** (user dostarcza klucze OpenAI / Anthropic / OpenRouter), pozwala mu utworzyć **wiele aplikacji** (każda z własnym gateway-key), bilingowane przez **Stripe** (plany subskrypcyjne + pakiety tokenów + metered overage), z analityką **per aplikacja + per end-user + per model/provider**.

---

## 1. Context

### Stan obecny
- `Customer` rejestruje się emailem → jeden klucz `om_live_xxx` + 10k kredytów (`auth.service.register()`).
- Proxy (`/v1/proxy/...`) używa **kluczy serwerowych** z env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
- `proxy.service.ts:45`: `resolvedProvider.proxy(body, '', ...)` — drugi argument (klucz) jest pusty, providery biorą z env.
- `billing.burnCredits()` zdejmuje kredyty z `CreditWallet` po cenniku w `pricing.service.ts` (1000 kredytów = $1).
- Brak modelu OpenRouter, brak multi-application, brak Stripe, brak osobnego konta vs end-user.

### Stan docelowy
1. **Account** rejestruje się email + hasło → JWT do dashboardu.
2. **Provider keys** Accounta: dodaje swoje klucze OpenAI/Anthropic/OpenRouter (zaszyfrowane AES-256-GCM, walidowane test-callem).
3. **Application** — Account tworzy 1+ aplikacji (np. "Mobilka", "Web admin", "Side project"). Każda aplikacja:
   - ma własne **gateway API keys** (n keys per app, label, lastUsed).
   - identyfikuje się przy każdym proxy-callu.
   - ma własną statystykę.
4. **End-user attribution** — aplikacja klienta przy każdym proxy-callu może wysłać `X-End-User-Id: <externalId>` (np. uuid usera w aplikacji klienta) → analityka per end-user.
5. **Stripe billing**:
   - **Subskrypcje** (Free / Starter / Pro / Enterprise) z miesięcznym limitem tokenów.
   - **Token packages** (jednorazowe doładowania, np. 100k / 500k / 2M tokenów — nie wygasają z końcem miesiąca).
   - **Metered overage** — po wyczerpaniu limitu w planie, Stripe metered billing nalicza overage.
   - **Customer portal** Stripe do zarządzania subą przez użytkownika.
6. **Analityka**: dashboard pokazuje agregaty/timeseries per aplikacja, per end-user, per model, per provider.

---

## 2. Open Questions (proszę o decyzje)

1. **Co liczymy jako "token" w pakiecie 10k/50k/100k?**
   - (a) **Suma `inputTokens + outputTokens`** ze wszystkich proxy-calli (LLM tokens 1:1) — najczystsze, koreluje z kosztem AI.
   - (b) Liczba requestów (10k = 10 tys. wywołań).
   - (c) "Gateway credits" jak teraz (kalkulowane z kosztu USD × markup).
   - 👉 **Sugestia: (a)**, ale przykładowe pakiety realistyczne to raczej **100k / 1M / 10M tokenów**, nie 10k. Czy zostawiamy nazwy (10k/50k/100k) czy zmieniamy na sensowniejsze?

2. **Provider keys na poziomie Account czy Application?**
   - (a) **Account-level** (jeden zestaw na konto, dzielony przez wszystkie apki) — proste, mniej do zarządzania.
   - (b) **Application-level** (każda apka swoje klucze) — większa izolacja (np. dev vs prod app), feature premium.
   - (c) Hybryda: Account ma defaulty, App może je nadpisać.
   - 👉 **Sugestia: (a)** w v1, (c) w przyszłości.

3. **Plany subskrypcyjne + pakiety jednocześnie?**
   - (a) **Tylko subskrypcje** (miesięczne, reset co miesiąc).
   - (b) **Tylko pakiety** (jednorazowe, bez resetu, jak Anthropic/OpenAI).
   - (c) **Oba** — sub daje monthly cap, pakiet to jednorazowy boost (nie wygasa).
   - 👉 **Sugestia: (c)** — pokrywa najwięcej przypadków.

4. **Co po wyczerpaniu limitu w planie?**
   - (a) **Hard stop** — proxy zwraca 402 PAYMENT_REQUIRED, użytkownik musi kupić pakiet lub upgradować plan.
   - (b) **Soft cap + metered overage** — Stripe `meter_event` nalicza nadwyżkę.
   - (c) Per-plan: free=hard, paid=soft.
   - 👉 **Sugestia: (c)**.

5. **Free tier startowy?**
   - 👉 **Sugestia: 10k tokenów/mc na free planie** (test gateway za darmo, potem upgrade).

6. **Co z istniejącym modułem `billing` (kredyty)?**
   - (a) Usuwamy całkowicie, zastępujemy `TokenBalance`/Stripe.
   - (b) Zostawiamy `UsageEvent` (do analityki, bez `creditsBurned`), usuwamy `CreditWallet`/`CreditTransaction`.
   - (c) Migrujemy: 10k credits → 10k token quota.
   - 👉 **Sugestia: (b)**, plus prosta migracja danych jeśli są w produkcji.

7. **Provider model selector dla pakietów?** Czy 1 token Sonnet = 1 token Opus = 1 token Haiku? Realnie modele różnią się ceną o rząd wielkości.
   - (a) **Wszystkie tokeny równe** — proste, ale nieuczciwe (Opus 25× droższy od Sonnet, ale liczy się tak samo z perspektywy gateway).
   - (b) **Ważone "credits"** — 1 credit = $0.001, każdy model konwertowany po pricing table.
   - 👉 **Sugestia: (b)** — to praktycznie obecny system kredytów, zachowujemy nazwę "tokens" w UI ale licznikiem są equivalent-tokens (np. "Anthropic Sonnet 4.5 in" — 1 LLM token = 1 gateway token; Opus = ~5×). Albo zmieniamy nazwę na "credits"/"units". **Decyzja produktowa.**

8. **Stripe — zostajemy przy klasycznym `Checkout + Customer Portal` czy embedded Stripe Elements?** Sugestia: **Checkout + Portal** (mniej kodu UI, mniej PCI, wystarczy do v1).

9. **Webhook URL Stripe** — czy backend ma publiczny endpoint na webhooks?
   - 👉 Tak: `POST /v1/billing/stripe/webhook`, weryfikacja `Stripe-Signature` headerem.

10. **Rate limit na proxy** — w obecnym planie miał być per-customer (free=30/min, pro=300/min). Zostawiamy ten model na poziomie Account, czy ograniczamy per-Application?
   - 👉 **Sugestia: per Account** w v1.

---

## 3. Approach

1. **Schema overhaul** — wprowadzić jasną hierarchię:
   - `Account` (zastępuje `Customer`) — z hasłem, JWT auth.
   - `Application` — n per Account.
   - `GatewayApiKey` — n per Application (zastępuje `Customer.apiKeyHash`).
   - `UserProviderKey` — n per Account (1 per provider w v1).
   - `EndUser` (zostawić nazwę `User` z `externalId`) — n per Application.
   - `UsageEvent` — relacje do `Account`, `Application`, `EndUser`.
   - `Subscription`, `TokenPackage`, `TokenLedger` — Stripe entities + balance.
   - Usunięte/deprecated: `CreditWallet`, `CreditTransaction` (zastąpione `TokenLedger`).

2. **Auth** — JWT do dashboardu (`/v1/auth/login|register|me`), GatewayKey do proxy (refactor `ApiKeyGuard`).

3. **Provider Keys CRUD** + szyfrowanie AES-256-GCM (`PROVIDER_KEY_ENCRYPTION_KEY` z env) + walidacja test-callem.

4. **Applications CRUD** + Gateway Keys CRUD per app.

5. **Proxy refactor** — pobiera klucz providera z `UserProviderKey` Account-a (zamiast env), identyfikuje aplikację po gateway-key, end-usera z headera `X-End-User-Id`. Brak `burnCredits` — zamiast tego `consumeQuota(accountId, tokens)` z `TokenLedger`.

6. **OpenRouter provider** — nowy plik, OpenAI-compatible.

7. **Stripe integration**:
   - `StripeService` — klient SDK, idempotency.
   - `BillingService.createCheckoutSession()` — sub lub pakiet.
   - `BillingService.createPortalSession()` — link do customer portal.
   - `StripeWebhookController` — `invoice.paid`, `customer.subscription.updated`, `checkout.session.completed`.
   - Po zakończonej płatności → `TokenLedger.credit(accountId, tokens, source='subscription'|'package')`.
   - Reset miesięczny — cron → expire'uje subskrypcyjne tokens, naliczają się nowe z aktywnej subskrypcji.

8. **Quota system** (`TokenLedger`):
   - Każde proxy-call → `consumeQuota(accountId, equivalentTokens)`.
   - Najpierw zużywa **subskrypcyjne** (wygasają z końcem okresu), potem **pakietowe** (nie wygasają).
   - Po wyczerpaniu: jeśli plan ma `overage=true` → zapisuje overage events, raportuje do Stripe Meter API; jeśli `overage=false` → 402 PAYMENT_REQUIRED.

9. **Analytics module** — agregaty z `UsageEvent`:
   - timeseries (`bucket=hour|day|week|month`)
   - filters (`from, to, applicationId, endUserId, provider, model`)
   - top-N (apps, end-users, models)

10. **Examples doc** (`backend/EXAMPLES.md`) — pełen flow z curl/JS/Python.

---

## 4. Files to modify / create

### Schema & migracja
- `backend/prisma/schema.prisma` — wymiana `Customer` → `Account`, dodać `Application`, `UserProviderKey`, `GatewayApiKey`, `Subscription`, `TokenPackage`, `TokenLedger`, `StripeEvent`. Update relacji w `UsageEvent`. **Patrz sekcja 5**.
- `backend/prisma/migrations/<ts>_byok_stripe/migration.sql` — idempotentna.
- `backend/prisma/seed.ts` — seedować plany w DB (Free, Starter, Pro) + provider pricing (jest już).

### Auth
- `backend/src/modules/auth/dto/auth.dto.ts` — `registerSchema` (email, password ≥ 8 znaków, name), `loginSchema`.
- `backend/src/modules/auth/auth.service.ts` — bcrypt, JWT signing (`@nestjs/jwt`).
- `backend/src/modules/auth/auth.controller.ts` — `POST /register`, `POST /login`, `GET /me`.
- `backend/src/common/guards/jwt.guard.ts` — **NOWY** dla endpointów dashboardu.
- `backend/src/common/guards/api-key.guard.ts` — refactor: czyta z `GatewayApiKey`, ustawia `req.account`, `req.application`, `req.gatewayKey`.

### Provider Keys (NEW)
- `backend/src/modules/provider-keys/provider-keys.module.ts`
- `backend/src/modules/provider-keys/provider-keys.service.ts` — `upsert`, `list` (bez raw), `delete`, `test`, `getDecrypted` (internal).
- `backend/src/modules/provider-keys/provider-keys.controller.ts` — `GET/POST /v1/me/provider-keys`, `DELETE /v1/me/provider-keys/:provider`, `POST /v1/me/provider-keys/:provider/test`.
- `backend/src/modules/provider-keys/crypto.util.ts` — AES-256-GCM helpers.
- `backend/src/modules/provider-keys/dto/provider-keys.dto.ts`.

### Applications (NEW)
- `backend/src/modules/applications/applications.module.ts`
- `backend/src/modules/applications/applications.service.ts` — `create({ name, description })`, `list`, `get`, `update`, `delete`.
- `backend/src/modules/applications/applications.controller.ts` — `GET/POST /v1/me/applications`, `GET/PATCH/DELETE /v1/me/applications/:id`.

### Gateway Keys (NEW)
- `backend/src/modules/gateway-keys/gateway-keys.module.ts`
- `backend/src/modules/gateway-keys/gateway-keys.service.ts` — `create(applicationId, label) → { id, label, key }`, `list(applicationId)`, `revoke(id)`.
- `backend/src/modules/gateway-keys/gateway-keys.controller.ts` — `GET/POST /v1/me/applications/:appId/keys`, `DELETE /v1/me/applications/:appId/keys/:keyId`.

### Proxy refactor
- `backend/src/modules/proxy/providers/anthropic.provider.ts` — czytaj `apiKey` z argumentu (już w sygnaturze, tylko przestać ignorować).
- `backend/src/modules/proxy/providers/openai.provider.ts` — analogicznie.
- `backend/src/modules/proxy/providers/openrouter.provider.ts` — **NOWY**, base URL `https://openrouter.ai/api/v1`, OpenAI-compatible.
- `backend/src/modules/proxy/proxy.service.ts`:
  - injecty: `ProviderKeysService`, `BillingService` (nowe).
  - flow: pobierz klucz user-providera → jeśli brak → `400 PROVIDER_KEY_MISSING`.
  - przed proxy-call: `billing.checkQuota(accountId)` (tylko sprawdzenie, nie konsumpcja).
  - po proxy-call: `billing.consumeQuota(accountId, applicationId, endUserId, equivalentTokens, costUsd)`.
  - zapis `UsageEvent` z `applicationId`, `gatewayKeyId`, `endUserId`.
  - usunąć `entitlements.checkAccess` (lub uprościć).
- `backend/src/modules/proxy/proxy.controller.ts` — dodać `POST /v1/proxy/openrouter/chat/completions`, dodać extraction `endUserId` z headera `X-End-User-Id`.
- `backend/src/modules/proxy/proxy.module.ts` — wire OpenRouter, import `ProviderKeysModule`.

### Billing (Stripe) — przepisanie
- `backend/src/modules/billing/billing.module.ts` — wire Stripe.
- `backend/src/modules/billing/stripe.service.ts` — **NOWY**, klient `Stripe` SDK (`@types/stripe`), helpers do checkout/portal.
- `backend/src/modules/billing/billing.service.ts` — przepisać:
  - `createCheckoutSession(accountId, type: 'subscription'|'package', priceId)`.
  - `createPortalSession(accountId)`.
  - `getSubscription(accountId)` — current plan + period + cap.
  - `getTokenBalance(accountId)` — sub remaining + package balance.
  - `consumeQuota(...)` — atomowa transakcja: dekrement w `TokenLedger`, optional Stripe Meter API call dla overage.
  - `checkQuota(accountId)` — sprawdza czy ma czym zapłacić.
- `backend/src/modules/billing/stripe-webhook.controller.ts` — **NOWY**, `POST /v1/billing/stripe/webhook` (Public), weryfikacja sygnatury, idempotency przez `StripeEvent.id` w DB, dispatcher na `invoice.paid`/`subscription.updated`/`checkout.session.completed`/`customer.subscription.deleted`.
- `backend/src/modules/billing/billing.controller.ts` — przepisać:
  - `POST /v1/billing/checkout` (subscription|package).
  - `POST /v1/billing/portal`.
  - `GET /v1/billing/subscription`.
  - `GET /v1/billing/balance`.
  - `GET /v1/billing/transactions`.
  - `GET /v1/billing/plans` (Public — listing dostępnych planów + cen z Stripe lub hardcoded).
- Usunąć stare: `topUp` (zastąpiony Checkout/Webhook).

### Usage / Analytics
- `backend/src/modules/usage/usage.service.ts` — `ingest`, `getStats(filters)`, `getEvents(filters)` — dodać `applicationId`, `endUserId` do filtrów.
- `backend/src/modules/usage/usage.controller.ts` — endpointy below.
- `backend/src/modules/analytics/` — **NOWY moduł** dla bardziej zaawansowanych zapytań:
  - `analytics.service.ts` — `overview`, `byApplication`, `byEndUser`, `byProvider`, `byModel`, `timeseries`, `topApps`, `topUsers`.
  - `analytics.controller.ts` — endpointy `/v1/analytics/*` (JWT-protected).

### Env
- `backend/.env.example`:
  - **Usuń**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
  - **Dodaj**:
    ```
    JWT_SECRET=
    JWT_EXPIRES_IN=7d
    PROVIDER_KEY_ENCRYPTION_KEY= # 64 hex chars (32 bytes)
    STRIPE_SECRET_KEY=
    STRIPE_WEBHOOK_SECRET=
    STRIPE_PUBLISHABLE_KEY=     # for frontend
    STRIPE_PORTAL_RETURN_URL=
    STRIPE_CHECKOUT_SUCCESS_URL=
    STRIPE_CHECKOUT_CANCEL_URL=
    ```

### Docs
- `backend/EXAMPLES.md` — **NOWY**, pełen flow (sekcja 8).

---

## 5. Schema (Prisma)

```prisma
// ----- Identity -----
model Account {
  id              String   @id @default(uuid())
  email           String   @unique
  name            String
  passwordHash    String   @map("password_hash")
  isActive        Boolean  @default(true) @map("is_active")
  stripeCustomerId String? @unique @map("stripe_customer_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  applications     Application[]
  providerKeys     UserProviderKey[]
  subscriptions    Subscription[]
  tokenPackages    TokenPackage[]
  tokenLedger      TokenLedger[]
  usageEvents      UsageEvent[]

  @@map("accounts")
}

model UserProviderKey {
  id            String    @id @default(uuid())
  accountId     String    @map("account_id")
  provider      String    // "openai" | "anthropic" | "openrouter"
  ciphertext    String
  iv            String
  authTag       String    @map("auth_tag")
  last4         String
  verifiedAt    DateTime? @map("verified_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  account       Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([accountId, provider])
  @@map("user_provider_keys")
}

model Application {
  id           String   @id @default(uuid())
  accountId    String   @map("account_id")
  name         String   // "Mobile app", "Web admin"
  description  String?
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  account      Account        @relation(fields: [accountId], references: [id], onDelete: Cascade)
  gatewayKeys  GatewayApiKey[]
  endUsers     EndUser[]
  usageEvents  UsageEvent[]

  @@index([accountId])
  @@map("applications")
}

model GatewayApiKey {
  id            String    @id @default(uuid())
  applicationId String    @map("application_id")
  label         String    // "Production", "Local dev", "CI"
  keyHash       String    @unique @map("key_hash")
  keyPrefix     String    @map("key_prefix")  // first 12 chars for UI
  lastUsedAt    DateTime? @map("last_used_at")
  revokedAt     DateTime? @map("revoked_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  application   Application  @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  usageEvents   UsageEvent[]

  @@index([applicationId])
  @@map("gateway_api_keys")
}

model EndUser {
  id            String    @id @default(uuid())
  applicationId String    @map("application_id")
  externalId    String    @map("external_id")  // ID z aplikacji klienta
  email         String?
  name          String?
  metadata      Json?
  createdAt     DateTime  @default(now()) @map("created_at")
  lastSeenAt    DateTime? @map("last_seen_at")

  application   Application  @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  usageEvents   UsageEvent[]

  @@unique([applicationId, externalId])
  @@map("end_users")
}

// ----- Usage -----
model UsageEvent {
  id                  String   @id @default(uuid())
  accountId           String   @map("account_id")
  applicationId       String?  @map("application_id")
  gatewayKeyId        String?  @map("gateway_key_id")
  endUserId           String?  @map("end_user_id")
  eventType           String   @map("event_type")  // TOKEN_USAGE
  provider            String?  // OPENAI | ANTHROPIC | OPENROUTER
  model               String?
  inputTokens         Int      @default(0) @map("input_tokens")
  outputTokens        Int      @default(0) @map("output_tokens")
  cacheReadTokens     Int      @default(0) @map("cache_read_tokens")
  cacheCreationTokens Int      @default(0) @map("cache_creation_tokens")
  equivalentTokens    Int      @default(0) @map("equivalent_tokens")  // gateway-equivalent (po wadze modelu)
  costUsd             Decimal? @map("cost_usd") @db.Decimal(20, 10)
  metadata            Json?
  idempotencyKey      String?  @unique @map("idempotency_key")
  timestamp           DateTime @default(now())

  account             Account       @relation(fields: [accountId], references: [id])
  application         Application?  @relation(fields: [applicationId], references: [id])
  gatewayKey          GatewayApiKey? @relation(fields: [gatewayKeyId], references: [id])
  endUser             EndUser?      @relation(fields: [endUserId], references: [id])

  @@index([accountId, timestamp])
  @@index([applicationId, timestamp])
  @@index([endUserId, timestamp])
  @@index([provider, model])
  @@map("usage_events")
}

// ----- Billing -----
model Plan {
  id              String   @id @default(uuid())
  slug            String   @unique  // "free", "starter", "pro", "enterprise"
  name            String
  monthlyTokenCap BigInt   @map("monthly_token_cap")  // 0 = unlimited
  priceUsd        Decimal  @map("price_usd") @db.Decimal(10, 2)
  stripePriceId   String?  @map("stripe_price_id")
  allowOverage    Boolean  @default(false) @map("allow_overage")
  isActive        Boolean  @default(true) @map("is_active")
  metadata        Json?

  subscriptions   Subscription[]

  @@map("plans")
}

model PackageOffer {
  id                String   @id @default(uuid())
  slug              String   @unique  // "pkg-100k", "pkg-1m", "pkg-10m"
  name              String
  tokens            BigInt
  priceUsd          Decimal  @map("price_usd") @db.Decimal(10, 2)
  stripePriceId     String?  @map("stripe_price_id")
  isActive          Boolean  @default(true) @map("is_active")

  packages          TokenPackage[]

  @@map("package_offers")
}

model Subscription {
  id                   String    @id @default(uuid())
  accountId            String    @map("account_id")
  planId               String    @map("plan_id")
  stripeSubscriptionId String?   @unique @map("stripe_subscription_id")
  status               String                           // active | past_due | canceled | trialing
  currentPeriodStart   DateTime  @map("current_period_start")
  currentPeriodEnd     DateTime  @map("current_period_end")
  cancelAtPeriodEnd    Boolean   @default(false) @map("cancel_at_period_end")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  account              Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  plan                 Plan      @relation(fields: [planId], references: [id])

  @@index([accountId])
  @@map("subscriptions")
}

model TokenPackage {
  id                  String    @id @default(uuid())
  accountId           String    @map("account_id")
  offerId             String    @map("offer_id")
  tokensPurchased     BigInt    @map("tokens_purchased")
  tokensRemaining     BigInt    @map("tokens_remaining")
  stripeInvoiceId     String?   @unique @map("stripe_invoice_id")
  purchasedAt         DateTime  @default(now()) @map("purchased_at")

  account             Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  offer               PackageOffer  @relation(fields: [offerId], references: [id])

  @@index([accountId])
  @@map("token_packages")
}

// Append-only ledger of all token consume/credit operations.
model TokenLedger {
  id              String   @id @default(uuid())
  accountId       String   @map("account_id")
  type            String   // CONSUME | CREDIT_SUBSCRIPTION | CREDIT_PACKAGE | EXPIRE_SUBSCRIPTION | OVERAGE
  amount          BigInt   // negative for CONSUME/EXPIRE, positive for CREDIT
  source          String?  // subscription:<id> | package:<id> | usage_event:<id>
  balanceAfter    BigInt   @map("balance_after")  // total available after operation
  metadata        Json?
  idempotencyKey  String?  @unique @map("idempotency_key")
  createdAt       DateTime @default(now()) @map("created_at")

  account         Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, createdAt])
  @@map("token_ledger")
}

model StripeEvent {
  id          String   @id           // Stripe event ID (idempotency)
  type        String
  payload     Json
  processedAt DateTime? @map("processed_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([type])
  @@map("stripe_events")
}
```

> Modele do **usunięcia** (po migracji): `Customer`, `User` (zastąpione `Account` + `EndUser`), `CreditWallet`, `CreditTransaction`, `Entitlement` (uprościmy logikę przez Plan), `AlertRule` (zostawiamy jeśli pyt. 6 = b).

---

## 6. Endpoints — pełna lista

### Auth (Public/JWT)
| Method | Path | Auth | Opis |
|---|---|---|---|
| POST | `/v1/auth/register` | Public | `{ email, password, name }` → `{ account, accessToken }` |
| POST | `/v1/auth/login` | Public | `{ email, password }` → `{ accessToken }` |
| GET | `/v1/auth/me` | JWT | Aktualny account |

### Provider Keys (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/me/provider-keys` | Lista (provider, last4, verifiedAt) |
| POST | `/v1/me/provider-keys` | `{ provider, apiKey }` — zapis + walidacja |
| DELETE | `/v1/me/provider-keys/:provider` | Usuń |
| POST | `/v1/me/provider-keys/:provider/test` | Test klucza |

### Applications (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/me/applications` | Lista |
| POST | `/v1/me/applications` | `{ name, description }` |
| GET | `/v1/me/applications/:id` | Szczegóły + stats |
| PATCH | `/v1/me/applications/:id` | Update |
| DELETE | `/v1/me/applications/:id` | Soft-delete (revoke wszystkie keys) |

### Gateway Keys (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/me/applications/:appId/keys` | Lista (label, prefix, lastUsedAt) |
| POST | `/v1/me/applications/:appId/keys` | `{ label }` → `{ id, label, key }` (raw **tylko raz**) |
| DELETE | `/v1/me/applications/:appId/keys/:keyId` | Revoke |

### Proxy (Gateway Key)
| Method | Path | Opis |
|---|---|---|
| POST | `/v1/proxy/anthropic/messages` | Proxy Anthropic z user-keyem |
| POST | `/v1/proxy/openai/chat/completions` | Proxy OpenAI |
| POST | `/v1/proxy/openrouter/chat/completions` | Proxy OpenRouter |
| POST | `/v1/proxy/chat` | Auto-detect z `provider`/`model` |

Headery na proxy:
- `Authorization: Bearer om_live_xxx` (gateway key)
- `X-End-User-Id: <externalId>` (opcjonalnie, dla analityki)
- `X-Idempotency-Key: <uuid>` (opcjonalnie)

### Billing (JWT, kilka Public)
| Method | Path | Auth | Opis |
|---|---|---|---|
| GET | `/v1/billing/plans` | Public | Lista planów subskrypcyjnych |
| GET | `/v1/billing/packages` | Public | Lista pakietów tokenów |
| POST | `/v1/billing/checkout` | JWT | `{ type: 'subscription'\|'package', priceId }` → `{ checkoutUrl }` |
| POST | `/v1/billing/portal` | JWT | `{ returnUrl? }` → `{ portalUrl }` |
| GET | `/v1/billing/subscription` | JWT | Aktualna sub + period + cap |
| GET | `/v1/billing/balance` | JWT | `{ subscriptionRemaining, packageRemaining, total, periodEnd }` |
| GET | `/v1/billing/transactions` | JWT | Historia z TokenLedger |
| POST | `/v1/billing/stripe/webhook` | Public (sig-verified) | Stripe webhook receiver |

### Usage (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/usage/events` | Paginowane events z filtrami |
| GET | `/v1/usage/stats` | Agregaty (current period) |

### Analytics (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/analytics/overview?from&to` | Total tokens / cost / requests |
| GET | `/v1/analytics/by-application?from&to` | Top aplikacji |
| GET | `/v1/analytics/by-end-user?applicationId&from&to` | Top end-userów |
| GET | `/v1/analytics/by-provider?from&to` | Per provider |
| GET | `/v1/analytics/by-model?from&to` | Per model |
| GET | `/v1/analytics/timeseries?bucket=day&from&to&applicationId?` | Wykres czasowy |

### End Users (JWT)
| Method | Path | Opis |
|---|---|---|
| GET | `/v1/me/applications/:appId/end-users` | Lista końcowych userów aplikacji |
| GET | `/v1/me/applications/:appId/end-users/:externalId` | Szczegóły + ich usage |

---

## 7. Reuse z istniejącego kodu

- `crypto.randomBytes` + sha256 hash — **reuse** z `auth.service.ts:21-22` i `api-key.guard.ts:35-37`.
- `KEY_PREFIX = 'om_live_'` — reuse w `GatewayApiKey`.
- `ApiKeyGuard.extractApiKey()` (Bearer + X-API-Key) — reuse, zmiana lookupa.
- `BaseProvider.proxy(body, apiKey, isStreaming)` — reuse, sygnatura już prawidłowa.
- `pricing.service.ts` (resolvePricing, calculateCost, usdToCredits) — **reuse** do liczenia `equivalentTokens`/`costUsd`.
- `UsageEvent` model — **reuse** z dodanymi relacjami.
- `AuditService` — reuse, dodać akcje: `PROVIDER_KEY_*`, `APP_*`, `GATEWAY_KEY_*`, `SUBSCRIPTION_*`, `PACKAGE_PURCHASED`, `LOGIN_*`.
- Zod + `@nestjs/swagger` DTO classes — reuse z `auth.dto.ts` i `auth.swagger.ts`.

---

## 8. EXAMPLES.md — opis pod podpięcie do serwisu

### A. Rejestracja konta + login
```bash
# 1. Register
curl -X POST https://api.gateway.dev/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"jan@example.com","password":"S3cret-pass","name":"Jan"}'
# → { "account": {...}, "accessToken": "eyJ..." }

# 2. Login (jeśli już ma konto)
curl -X POST https://api.gateway.dev/v1/auth/login \
  -d '{"email":"jan@example.com","password":"S3cret-pass"}'
```

### B. Dodanie kluczy providerów
```bash
TOKEN="eyJ..."
for provider in openai anthropic openrouter; do
  curl -X POST https://api.gateway.dev/v1/me/provider-keys \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"provider\":\"$provider\",\"apiKey\":\"<paste-key>\"}"
done
```

### C. Utworzenie aplikacji + gateway key
```bash
# Stwórz aplikację
APP=$(curl -X POST https://api.gateway.dev/v1/me/applications \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Mobile app","description":"Aplikacja iOS"}' | jq -r .id)

# Wygeneruj klucz
curl -X POST "https://api.gateway.dev/v1/me/applications/$APP/keys" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"label":"iOS production"}'
# → { "id":"...", "label":"iOS production", "key":"om_live_xxx..." }
# ⚠ Klucz zwracany TYLKO RAZ. Zapisz go w secret manager.
```

### D. Wykup subskrypcji / pakietu (Stripe Checkout)
```bash
# Lista dostępnych planów (Public)
curl https://api.gateway.dev/v1/billing/plans

# Start Stripe Checkout dla suba
curl -X POST https://api.gateway.dev/v1/billing/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"subscription","priceId":"price_starter_monthly"}'
# → { "checkoutUrl":"https://checkout.stripe.com/c/pay/cs_..." }
# Przekieruj usera do checkoutUrl. Po zapłacie Stripe webhook aktywuje sub.

# Zakup pakietu (jednorazowy)
curl -X POST https://api.gateway.dev/v1/billing/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"package","priceId":"price_pkg_1m_tokens"}'
```

### E. Customer Portal (zarządzanie subą przez usera)
```bash
curl -X POST https://api.gateway.dev/v1/billing/portal \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"returnUrl":"https://app.gateway.dev/settings/billing"}'
# → { "portalUrl":"https://billing.stripe.com/p/session/..." }
# Otwórz w nowej karcie. User może: zmienić plan, anulować, pobrać faktury, zaktualizować kartę.
```

### F. Użycie z aplikacji klienta — curl
```bash
GATEWAY_KEY="om_live_xxx..."

# Anthropic
curl https://api.gateway.dev/v1/proxy/anthropic/messages \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "X-End-User-Id: user_42" \
  -H 'Content-Type: application/json' \
  -d '{
    "model":"claude-sonnet-4-5",
    "max_tokens":1024,
    "messages":[{"role":"user","content":"Hi"}]
  }'

# OpenAI (kompatybilny endpoint)
curl https://api.gateway.dev/v1/proxy/openai/chat/completions \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "X-End-User-Id: user_42" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'

# OpenRouter
curl https://api.gateway.dev/v1/proxy/openrouter/chat/completions \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -d '{"model":"anthropic/claude-3.5-sonnet","messages":[{"role":"user","content":"Hi"}]}'
```

### G. Użycie z OpenAI SDK (Node)
```ts
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.GATEWAY_KEY,
  baseURL: 'https://api.gateway.dev/v1/proxy/openai',
  defaultHeaders: { 'X-End-User-Id': 'user_42' },
})

const r = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### H. Użycie z Anthropic SDK (Python)
```python
from anthropic import Anthropic
client = Anthropic(
    api_key=os.environ["GATEWAY_KEY"],
    base_url="https://api.gateway.dev/v1/proxy/anthropic",
    default_headers={"X-End-User-Id": "user_42"},
)
msg = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hi"}],
)
```

### I. Sprawdzenie balance / okresu
```bash
curl https://api.gateway.dev/v1/billing/balance -H "Authorization: Bearer $TOKEN"
# → { "subscriptionRemaining": 87340, "packageRemaining": 1500000, "total": 1587340, "periodEnd": "2026-06-01T..." }
```

### J. Analityka per aplikacja / per end-user
```bash
# Top aplikacji w bieżącym miesiącu
curl "https://api.gateway.dev/v1/analytics/by-application?from=2026-05-01&to=2026-05-31" \
  -H "Authorization: Bearer $TOKEN"

# Top end-userów aplikacji X
curl "https://api.gateway.dev/v1/analytics/by-end-user?applicationId=$APP&from=2026-05-01&to=2026-05-31" \
  -H "Authorization: Bearer $TOKEN"

# Wykres czasowy
curl "https://api.gateway.dev/v1/analytics/timeseries?bucket=day&from=2026-05-01&to=2026-05-31" \
  -H "Authorization: Bearer $TOKEN"
```

### K. Stripe Webhook (gateway nasłuchuje)
Skonfiguruj w Stripe Dashboard → Developers → Webhooks:
- URL: `https://api.gateway.dev/v1/billing/stripe/webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Skopiuj `STRIPE_WEBHOOK_SECRET` do env.

---

## 9. Flow PRZED → PO — krok po kroku

### 9.1 Onboarding nowego klienta

**PRZED (obecny stan):**
```
1. POST /v1/auth/register { name, email }
   → backend tworzy Customer
   → generuje om_live_xxx (jeden, jedyny)
   → tworzy CreditWallet z balance=10000
   → zwraca { id, name, email, apiKey }

2. KONIEC. User dostaje 10k darmowych kredytów i może od razu wołać:
   POST /v1/proxy/anthropic/messages -H 'Authorization: Bearer om_live_xxx'

3. Gateway forwarduje request do Anthropic używając ANTHROPIC_API_KEY
   z env serwera (operator gatewaya płaci Anthropicowi).

4. Po response: billing.burnCredits() liczy koszt po pricing table
   i odejmuje od CreditWallet.balance.
```

**PO (BYOK + Stripe + Multi-App):**
```
1. POST /v1/auth/register { email, password, name }
   → backend tworzy Account (z bcrypt-owanym passwordHash)
   → tworzy stripeCustomerId (Stripe.customers.create)
   → przypisuje domyślny Plan 'free' (10k tokens/mc, allowOverage=false)
   → zwraca { account, accessToken (JWT) }

2. POST /v1/auth/login { email, password }      ← przy kolejnych sesjach
   → walidacja bcrypt, zwraca { accessToken }

3. User loguje się w dashboardzie (frontend trzyma JWT).

4. POST /v1/me/provider-keys { provider: 'openai',     apiKey: 'sk-proj-...' }
   POST /v1/me/provider-keys { provider: 'anthropic',  apiKey: 'sk-ant-...' }
   POST /v1/me/provider-keys { provider: 'openrouter', apiKey: 'sk-or-v1-...' }
   → backend AES-256-GCM-encrypt → zapis UserProviderKey + last4 do podglądu
   → asynchronicznie test-call (np. GET /v1/models) → ustawia verifiedAt
   → jeśli błąd: zapis OK ale verifiedAt=null + UI pokazuje warning

5. POST /v1/me/applications { name: 'Mobile app', description: '...' }
   → backend tworzy Application (przypisaną do Account)
   → zwraca { id, name, ... }

6. POST /v1/me/applications/:appId/keys { label: 'iOS production' }
   → backend generuje om_live_xxx, hashuje, zapisuje GatewayApiKey
   → zwraca { id, label, key: 'om_live_xxx...' }   ← raw KLUCZ TYLKO RAZ
   → user zapisuje klucz w secret manager swojej apki

7. KONIEC ONBOARDINGU. User ma działający gateway na 10k tokenów/mc free.
```

---

### 9.2 Pojedynczy proxy-call — co się dzieje

**PRZED:**
```
Klient apki wysyła:
  POST /v1/proxy/anthropic/messages
  Authorization: Bearer om_live_xxx
  Body: { model: 'claude-sonnet-4-5', messages: [...] }

→ ApiKeyGuard: hash key → znajdź Customer → req.customer = customer
→ ProxyService.proxy():
   1. EntitlementsService.checkAccess(customerId, 'api-proxy') → check limity
   2. resolvedProvider = AnthropicProvider
   3. resolvedProvider.proxy(body, '', isStream)
      → fetch('https://api.anthropic.com/...', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY })
   4. Po response (jeśli OK):
      - audit.log({ action: 'PROXY_REQUEST' })
      - billing.burnCredits(customerId, provider, model, tokens...)
        → resolve pricing → calculateCost → usdToCredits
        → atomic: dekrement CreditWallet.balance, insert CreditTransaction (BURN), insert UsageEvent
        → alerts.evaluateAlerts (BALANCE_LOW)
        → webhooks.emitEvent('credits.burned')
   5. zwraca odpowiedź Anthropic do klienta
```

**PO:**
```
Klient apki wysyła:
  POST /v1/proxy/anthropic/messages
  Authorization: Bearer om_live_xxx           ← gateway key (z konkretnej Application)
  X-End-User-Id: user_42                       ← OPCJONALNIE: ID końcowego usera w apce klienta
  X-Idempotency-Key: <uuid>                    ← OPCJONALNIE
  Body: { model: 'claude-sonnet-4-5', messages: [...] }

→ ApiKeyGuard:
   - hash key → znajdź GatewayApiKey (joinuje Application + Account)
   - sprawdź revokedAt=null, Application.isActive, Account.isActive
   - update GatewayApiKey.lastUsedAt = now
   - req.account, req.application, req.gatewayKey = ...

→ ProxyService.proxy():
   1. resolveProvider('ANTHROPIC', model) → AnthropicProvider

   2. providerKey = await ProviderKeysService.getDecrypted(
         req.account.id, 'anthropic'
      )
      ↑ pobiera UserProviderKey, AES-256-GCM-decrypt, zwraca raw
      jeśli brak klucza → throw 400 PROVIDER_KEY_MISSING
         { code: 'PROVIDER_KEY_MISSING',
           message: 'Add your Anthropic API key in dashboard settings' }

   3. await BillingService.checkQuota(req.account.id)
      ↑ liczy: subscriptionRemaining + packageRemaining
      jeśli total <= 0 AND plan.allowOverage=false:
        throw 402 PAYMENT_REQUIRED
          { code: 'QUOTA_EXCEEDED',
            message: 'Monthly token limit reached',
            suggestion: 'Upgrade plan or buy a token package' }
      jeśli total <= 0 AND plan.allowOverage=true: kontynuuj (overage)

   4. endUserId = upsert EndUser (applicationId, externalId=req.headers['x-end-user-id'])
      → update lastSeenAt
      (jeśli brak headera: endUserId = null)

   5. result = await AnthropicProvider.proxy(body, providerKey, isStreaming)
      → fetch('https://api.anthropic.com/v1/messages',
               headers: { 'x-api-key': providerKey })   ← KLUCZ USERA, nie env!
      → przekazuje response (lub pipe SSE jeśli streaming)

   6. po response (jeśli result.status < 400):
      - costUsd = calculateCost(tokens, pricing)        ← z pricing.service.ts
      - equivalentTokens = inputTokens + outputTokens   ← albo wg pyt. 1 (decyzja produktowa)

      - await BillingService.consumeQuota({
          accountId, applicationId, gatewayKeyId, endUserId,
          equivalentTokens, costUsd, idempotencyKey
        })
        atomic transaction:
          a) znajdź aktywną Subscription, dekrementuj subscriptionRemaining
          b) jeśli >0 reszty: dekrementuj najstarszy TokenPackage.tokensRemaining (FIFO)
          c) jeśli wciąż reszta i allowOverage=true:
               - zapisz nadwyżkę jako TokenLedger { type:'OVERAGE' }
               - async: stripe.billing.meterEvents.create({
                   event_name: 'gateway_token_overage',
                   payload: { stripe_customer_id, value: overageTokens }
                 })
          d) zapis TokenLedger { type:'CONSUME', amount: -equivalentTokens, balanceAfter, source:'usage_event:<id>' }
          e) zapis UsageEvent {
               accountId, applicationId, gatewayKeyId, endUserId,
               provider: 'ANTHROPIC', model,
               inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
               equivalentTokens, costUsd,
               idempotencyKey, timestamp: now
             }

      - audit.log({ action:'PROXY_REQUEST', resource:'proxy',
                    metadata: { applicationId, model, equivalentTokens } })

   7. zwraca response Anthropic do klienta apki

   ↑ jeśli result.status >= 400 (np. 401 z Anthropic — invalid key):
     - NIE konsumujemy quoty
     - zaznaczamy UserProviderKey.verifiedAt = null (klucz przestał działać)
     - zwracamy oryginalny status + body do klienta apki
     - opcjonalnie: webhook 'provider_key.invalid' do ownera Account
```

---

### 9.3 Wykup subskrypcji (Stripe Checkout)

**PRZED:** `POST /v1/billing/top-up { amount: 10000 }` — manualne dolanie kredytów (bez płatności).

**PO:**
```
1. Frontend: GET /v1/billing/plans (Public) → lista [Free, Starter $19/mo 1M tokens, Pro $99/mo 10M, ...]

2. User klika 'Subscribe to Starter'.

3. Frontend: POST /v1/billing/checkout
   { type: 'subscription', priceId: 'price_starter_monthly' }
   Authorization: Bearer <JWT>

4. Backend BillingService.createCheckoutSession:
   - upewnia się że Account ma stripeCustomerId
   - stripe.checkout.sessions.create({
       customer: account.stripeCustomerId,
       mode: 'subscription',
       line_items: [{ price: 'price_starter_monthly', quantity: 1 }],
       success_url: STRIPE_CHECKOUT_SUCCESS_URL,
       cancel_url:  STRIPE_CHECKOUT_CANCEL_URL,
       metadata: { accountId: account.id, type: 'subscription', planId },
     })
   - zwraca { checkoutUrl }

5. Frontend redirect na checkoutUrl (hosted Stripe page).
   User płaci kartą.
   Stripe redirect z powrotem na success_url.

6. Stripe (async, w międzyczasie) wysyła webhooki na:
   POST /v1/billing/stripe/webhook

   StripeWebhookController:
   - weryfikuje Stripe-Signature (STRIPE_WEBHOOK_SECRET)
   - upsert StripeEvent { id: event.id } z processedAt=null
     ↑ jeśli już istnieje processedAt != null → return 200 (idempotency)
   - dispatch po type:

     a) 'checkout.session.completed':
        - znajdź Account po metadata.accountId
        - zapisz do logu (faktyczna aktywacja w invoice.paid)

     b) 'invoice.paid' (subscription cycle):
        - znajdź Subscription po stripeSubscriptionId (lub create)
        - update status='active', currentPeriodStart/End z eventu
        - jeśli to pierwszy okres — zlokalizuj/aktywuj plan
        - TokenLedger.credit(
            accountId,
            type: 'CREDIT_SUBSCRIPTION',
            amount: plan.monthlyTokenCap,
            source: 'subscription:<id>',
            idempotencyKey: 'inv_<invoice.id>',
          )
        ↑ od razu user ma świeży 1M tokenów do wykorzystania

     c) 'invoice.paid' (one-time package):
        - utwórz TokenPackage { tokensPurchased, tokensRemaining = same, offerId, stripeInvoiceId }
        - TokenLedger.credit({ type: 'CREDIT_PACKAGE', amount: tokensPurchased, source: 'package:<id>' })

     d) 'customer.subscription.updated':
        - sync status, cancelAtPeriodEnd, currentPeriodEnd

     e) 'customer.subscription.deleted':
        - status='canceled', wygasłe tokeny zostają do końca okresu
        - po currentPeriodEnd → cron job EXPIRE_SUBSCRIPTION (sekcja 9.6)

     f) 'invoice.payment_failed':
        - status='past_due', email do usera, webhook 'payment.failed' do customer'a

   - StripeEvent.processedAt = now
   - return 200 do Stripe (inaczej Stripe retry)

7. Frontend (po redirect na success_url) odpytuje:
   GET /v1/billing/subscription
   GET /v1/billing/balance
   → pokazuje 'You have 1,000,000 tokens this month'
```

---

### 9.4 Wykup pakietu jednorazowego

```
1. POST /v1/billing/checkout { type: 'package', priceId: 'price_pkg_1m' }
2. stripe.checkout.sessions.create({ mode: 'payment', ... })   ← payment, nie subscription
3. User płaci. Stripe → webhook 'invoice.paid' (lub 'checkout.session.completed' dla mode=payment)
4. TokenLedger.credit { type: 'CREDIT_PACKAGE', amount: 1_000_000, source: 'package:<id>' }
5. tokensRemaining w TokenPackage = 1_000_000
6. NIE wygasa z końcem miesiąca. Konsumowane FIFO po wyczerpaniu sub.
```

---

### 9.5 Zarządzanie subą przez usera (Stripe Customer Portal)

```
1. User klika 'Manage subscription' w dashboardzie.

2. Frontend: POST /v1/billing/portal { returnUrl: 'https://app.gateway.dev/billing' }

3. Backend: stripe.billingPortal.sessions.create({
     customer: account.stripeCustomerId,
     return_url: returnUrl,
   })
   → { portalUrl }

4. Frontend redirect → user na hosted Stripe Portal.
   Może: zmienić plan / anulować / pobrać faktury / zmienić kartę / aktualizować dane.

5. Każda akcja w portalu generuje webhook → backend sync.

6. Po powrocie (returnUrl): frontend reload subscription state.
```

---

### 9.6 Reset miesięczny / cron jobs

```
Cron 'subscription-renewal' (co godzinę):
  - znajdź Subscription gdzie currentPeriodEnd < now AND status='active'
  - czekaj na webhook 'invoice.paid' z nowym okresem (Stripe sam to wyśle)
  - tymczasowo (do nadejścia webhooka) — TokenLedger NIE jest jeszcze odświeżony,
    user widzi balance=0 z subskrypcji i jeśli ma pakiety, zjada z pakietu
  - po webhook → CREDIT_SUBSCRIPTION dla nowego okresu (sekcja 9.3 b)

Cron 'expire-subscription-tokens' (co 5 min):
  - dla każdego Account: zsumuj CREDIT_SUBSCRIPTION w starym okresie minus CONSUME źródło 'subscription'
  - jeśli reszta > 0 i okres minął → TokenLedger { type: 'EXPIRE_SUBSCRIPTION', amount: -reszta }
  ↑ pakiety nie wygasają, więc tej operacji nie podlegają
```

---

### 9.7 Zarządzanie aplikacjami / kluczami przez właściciela

```
DODANIE drugiej apki:
  POST /v1/me/applications { name: 'Web admin' } → app2
  POST /v1/me/applications/:app2.id/keys { label: 'staging' } → klucz om_live_yyy

ROTACJA klucza apki (np. po wycieku):
  POST /v1/me/applications/:appId/keys { label: 'production v2' } → nowy klucz
  DELETE /v1/me/applications/:appId/keys/:oldKeyId → revokedAt=now
  → stare wywołania ze starym kluczem dostają 401

USUNIĘCIE apki:
  DELETE /v1/me/applications/:appId → soft-delete (isActive=false), revoke wszystkie keys
  → UsageEvent z applicationId zostają (do historycznej analityki)

WYŚWIETLENIE WYKORZYSTANIA per apka:
  GET /v1/me/applications/:appId
  → { id, name, stats: { tokensThisMonth, requestsThisMonth, costUsdThisMonth, topModels: [...] } }
```

---

### 9.8 Analityka — co user widzi w dashboardzie

Przykład: user ma 2 apki ('Mobile' i 'Web'), w 'Mobile' są 3 końcowi userzy.

```
GET /v1/analytics/overview?from=2026-05-01&to=2026-05-31
→ {
    totalRequests: 12450,
    totalTokens: 8_200_000,
    totalCostUsd: 41.50,
    activeApplications: 2,
    activeEndUsers: 247,
    quotaUsage: { used: 8_200_000, cap: 10_000_000, percent: 82 }
  }

GET /v1/analytics/by-application?from=...
→ [
    { applicationId: 'app1', name: 'Mobile', requests: 9800, tokens: 6_500_000, costUsd: 32.10 },
    { applicationId: 'app2', name: 'Web',    requests: 2650, tokens: 1_700_000, costUsd:  9.40 }
  ]

GET /v1/analytics/by-end-user?applicationId=app1&from=...
→ [
    { externalId: 'user_42', email: 'a@x', requests: 4100, tokens: 2_800_000, costUsd: 13.20 },
    { externalId: 'user_99',                requests: 2200, tokens: 1_400_000, costUsd:  7.80 },
    ... (paginated)
  ]

GET /v1/analytics/by-provider?from=...
→ [
    { provider: 'ANTHROPIC',  tokens: 5_100_000, costUsd: 25.50 },
    { provider: 'OPENAI',     tokens: 2_800_000, costUsd: 14.00 },
    { provider: 'OPENROUTER', tokens:   300_000, costUsd:  2.00 }
  ]

GET /v1/analytics/by-model?from=...
→ [
    { provider: 'ANTHROPIC', model: 'claude-sonnet-4-5', tokens: 4_200_000, ... },
    { provider: 'OPENAI',    model: 'gpt-4o-mini',       tokens: 2_500_000, ... },
    ...
  ]

GET /v1/analytics/timeseries?bucket=day&from=2026-05-01&to=2026-05-31&applicationId=app1
→ [
    { date: '2026-05-01', requests: 320, tokens: 215_000 },
    { date: '2026-05-02', requests: 410, tokens: 278_000 },
    ...
  ]
```

Wszystkie agregaty liczone z `UsageEvent` po `accountId` (właściciel) i opcjonalnych filtrach. End-user privacy: backend zwraca tylko `externalId` i metadane przekazane przez aplikację klienta — nie ma dostępu do wewnętrznych userów innych Accountów.

---

### 9.9 Co się ZMIENIA w istniejących endpointach

| Endpoint | PRZED | PO |
|---|---|---|
| `POST /v1/auth/register` | `{ name, email }` → API key + 10k credits | `{ email, password, name }` → JWT + Free plan |
| `POST /v1/auth/rotate-key` | Rotacja jedynego klucza | **USUNIĘTY** (zastąpiony Gateway Keys CRUD per Application) |
| `GET /v1/auth/me` | Customer info, API-key auth | Account info, **JWT auth** |
| `GET /v1/billing/balance` | Credit wallet balance | `{ subscriptionRemaining, packageRemaining, total, periodEnd }` |
| `POST /v1/billing/top-up` | Manualne dolanie kredytów | **USUNIĘTY** (zastąpiony Stripe Checkout dla pakietów) |
| `GET /v1/billing/pricing` | Provider cost table | Zostaje (pricing dla cost tracking), ale dochodzi `GET /v1/billing/plans` i `GET /v1/billing/packages` |
| `POST /v1/proxy/anthropic/messages` | Klucz z env, kredyty z CreditWallet | **Klucz z UserProviderKey usera, quota z TokenLedger**, dodatkowy header `X-End-User-Id`, zapis `applicationId`/`gatewayKeyId`/`endUserId` |
| `POST /v1/proxy/openai/chat/completions` | j.w. | j.w. |
| (NOWY) `POST /v1/proxy/openrouter/chat/completions` | – | OpenRouter proxy (OpenAI-compatible) |
| `GET /v1/usage/events` | Filtrowanie po userId (externalId) | Dodatkowo `applicationId`, `gatewayKeyId`, `endUserId` |

---

### 9.10 Migracja istniejących danych (jeśli są w produkcji)

Jeśli baza nie jest pusta:
```
1. Customer → Account: rename + dodanie passwordHash
   - dla istniejących Customer'ów: passwordHash = generated random + email reset link
     (force-reset password on first login)
   - tworzenie stripeCustomerId dla każdego (stripe.customers.create)

2. Customer.apiKeyHash → utworzenie:
   a) domyślnej Application 'Default' dla każdego Customer
   b) GatewayApiKey { keyHash: customer.apiKeyHash, label: 'Migrated', applicationId }
   ↑ stare klucze nadal działają

3. CreditWallet → konwersja:
   - dla każdego Customer: TokenLedger.credit({ amount: wallet.balance, type: 'CREDIT_PACKAGE', ... })
   ↑ kredyty stają się 'pakietowymi tokenami' bez wygaśnięcia
   - alternatywa: skip migracji, force users buy plan

4. UsageEvent (existing): bez zmian, tylko dodać index na nowe kolumny

5. CreditTransaction: zostaje read-only do historycznego wglądu (jeśli treba) — tabela dropowana po 30 dniach.
```

---

## 10. Steps (kolejność implementacji)

- [ ] **Schema** — dodać/zmienić modele w `schema.prisma`, wygenerować migrację, zaaktualizować `seed.ts` (plany Free/Starter/Pro + pakiety 100k/1M/10M).
- [ ] **Crypto util** — `provider-keys/crypto.util.ts` (AES-256-GCM, klucz z env).
- [ ] **Auth refactor** — bcrypt + `@nestjs/jwt`, `JwtGuard`, register/login/me.
- [ ] **Provider Keys module** — service/controller/DTO + walidacja test-callem.
- [ ] **Applications module** — CRUD.
- [ ] **Gateway Keys module** — CRUD nested pod aplikacją.
- [ ] **ApiKeyGuard refactor** — czytaj z `GatewayApiKey`, ustaw `req.account/application/gatewayKey`.
- [ ] **Anthropic/OpenAI providers** — używaj przekazanego `apiKey`.
- [ ] **OpenRouter provider** — nowy.
- [ ] **Proxy refactor** — pobiera klucz user-providera, pobiera end-user z headera, zapisuje `applicationId`/`gatewayKeyId`/`endUserId` w UsageEvent.
- [ ] **Stripe service** + webhook controller (idempotency przez `StripeEvent`).
- [ ] **Billing service refactor** — checkout/portal/subscription/balance/quota.
- [ ] **Quota system** — `consumeQuota` z atomową transakcją (sub remaining → package → overage).
- [ ] **Analytics module** — agregaty + timeseries.
- [ ] **Usage module** — dodać filtry `applicationId`/`endUserId`.
- [ ] **Env update** + seed Stripe Price IDs.
- [ ] **EXAMPLES.md** — pełen flow.
- [ ] **Swagger** — `@ApiTags` + DTO classes dla wszystkich endpointów.

---

## 11. Verification

1. **Migracja**: `bunx prisma migrate dev --name byok_stripe` przechodzi na pustej DB.
2. **Type check**: `bunx tsc --noEmit` zielony.
3. **E2E happy path**:
   - `register` → `login` → `POST provider-keys` (3 providery) → `POST applications` → `POST applications/:id/keys` → `POST proxy/anthropic/messages` (z `X-End-User-Id`) → `200 OK`, `UsageEvent` zapisany z poprawnymi relacjami.
4. **Billing flow**:
   - `POST checkout (subscription)` → mockowane Stripe → webhook `checkout.session.completed` + `invoice.paid` → `Subscription` aktywna, `TokenLedger` ma credit `CREDIT_SUBSCRIPTION`.
   - `POST checkout (package)` → webhook `invoice.paid` → `TokenPackage` utworzony, `TokenLedger` ma `CREDIT_PACKAGE`.
   - `consumeQuota` najpierw zjada subscriptionRemaining, potem packageRemaining.
   - Wyczerpanie + `allowOverage=false` → proxy `402 PAYMENT_REQUIRED`.
   - Wyczerpanie + `allowOverage=true` → proxy 200, Stripe Meter API dostaje `meter_event`.
5. **Edge cases**:
   - Brak provider-key dla wybranego modelu → `400 PROVIDER_KEY_MISSING`.
   - Revoked gateway key → `401`.
   - Stripe webhook z duplikatem `event.id` → idempotentny (drugie processing skip).
   - End-user externalId nieznany → tworzymy nowy `EndUser` (upsert).
6. **Bezpieczeństwo**:
   - Raw klucz providera nigdy w logach (grep w testach + log redactor).
   - `GET /v1/me/provider-keys` nigdy nie zwraca ciphertext.
   - Gateway key raw widoczny tylko w `POST` create response.
   - Stripe webhook bez prawidłowego sig → 400.
7. **Analytics sanity**:
   - 3 calle z różnymi `X-End-User-Id` → `analytics/by-end-user` zwraca 3 wiersze z prawidłowymi sumami.
   - 2 aplikacje, calle z obu → `analytics/by-application` poprawnie rozdziela.
