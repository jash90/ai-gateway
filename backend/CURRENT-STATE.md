# Obecne działanie aplikacji (AI Gateway)

> Stan na dziś, na podstawie kodu w `backend/src/` i `backend/prisma/schema.prisma`. To jest **opis tego co JEST**, nie planu zmian — plan zmian jest w `PLAN-BYOK.md`.

---

## 1. Czym jest ten serwis

To **AI Gateway / proxy SaaS** z modelem "operator-managed keys + credits":
- Operator gatewaya hostuje klucze do OpenAI i Anthropic w env serwera.
- Klient (Customer) rejestruje się i dostaje **jeden klucz API** + 10 000 darmowych kredytów.
- Klient woła `/v1/proxy/...` swoim kluczem — gateway forwarduje do OpenAI/Anthropic używając **kluczy operatora**.
- Po response gateway nalicza koszt po wewnętrznym cenniku, konwertuje na kredyty (`1000 credits = $1`) i zdejmuje z portfela klienta.
- Brak Stripe, brak hasła, brak "aplikacji", brak BYOK, brak OpenRouter.

---

## 2. Stack

- **NestJS 11** + **Fastify** (zamiast Express) — `main.ts`.
- **Prisma 6** + **PostgreSQL** — `prisma/schema.prisma`, `prisma/prisma.service.ts`.
- **Redis (ioredis)** — wstrzykiwany jako provider `'REDIS'` w `app.module.ts`, używany przez rate limiting i kolejki BullMQ.
- **Zod** — walidacja DTO w controllerach (`registerSchema`, `pricingSchema`, `ingestSchema`).
- **Swagger** — `/docs` (UI) + `/docs-json` (OpenAPI), dwa security schemes: `X-API-Key` (klient) i `X-Admin-Key` (admin).
- **BullMQ** — kolejki w `JobsModule` (webhooks, usage, emails — patrz §10).

Bootstrap (`main.ts`):
- CORS otwarty w dev, zablokowany w prod.
- Globalne: `ValidationPipe (whitelist + transform)`, `AllExceptionsFilter`, `LoggingInterceptor`.
- Brak global prefix — każdy controller deklaruje `v1/...` ręcznie.

---

## 3. Schemat bazy (Prisma)

W `prisma/schema.prisma` jest 11 modeli. Trzy główne osie:

### 3.1 Tożsamość
- **Customer** — klient SaaS-a. Pola: `id`, `email` (unique), `name`, **`apiKeyHash`** (sha256 jedynego klucza `om_live_xxx`), `tier` (`free|pro|enterprise`), `isActive`, timestamps.
- **User** — końcowy użytkownik aplikacji klienta. Identyfikowany przez `(customerId, externalId)`. **Aktualnie nieużywany w głównych flow** — tabela istnieje, ale `proxy.controller.ts` nie czyta `userId` z requestu. `usage.controller.ts ingest` przyjmuje `userId` w body, ale nikt go nie wstrzykuje automatycznie.

### 3.2 Kredyty / billing
- **CreditWallet** — portfel klienta. `balance` (Decimal 20,4), `reservedBalance`, `currency='USD'`. Tworzony automatycznie przy `register()` z balance=10000.
- **CreditTransaction** — append-only ledger. `type` (`GRANT|PURCHASE|BURN|REFUND|EXPIRATION`), `amount` (+/-), `balanceBefore`, `balanceAfter`, `idempotencyKey` (unique). Każdy proxy-call generuje wiersz `BURN`, każde `top-up` — `PURCHASE`.
- **ProviderCost** — cennik per `(provider, model, costType, validFrom)`. `costType` = `INPUT_TOKEN | OUTPUT_TOKEN | CACHE_READ_TOKEN | CACHE_WRITE_TOKEN | IMAGE | VIDEO`. Hardcoded fallback w `pricing.service.ts` (Anthropic 13 modeli + OpenAI 8 modeli).

### 3.3 Aktywność i kontrola
- **UsageEvent** — każdy proxy-call lub manualny ingest. Pola: `customerId`, `userId?`, `eventType` (`TOKEN_USAGE`), `featureId`, `provider`, `model`, tokeny (input/output/cacheRead/cacheCreation), `creditsBurned`, `costUsd`, `metadata`, `idempotencyKey`, `timestamp`. Indexy po `(customerId, timestamp)`, `(provider, model)`, `eventType`.
- **Entitlement** — feature gating. Per `(customerId, featureId, period)`. `limitType` (`HARD|SOFT|NONE`), `limitValue`, `period` (`DAILY|MONTHLY|TOTAL`). Sprawdzane w proxy flow (§4.3 krok 1).
- **WebhookConfig** — konfiguracja outbound webhooków klienta. `url`, `secret` (HMAC), `events[]` (np. `["balance.low", "credits.burned"]`).
- **WebhookDelivery** — log dostarczeń webhooków, retries via BullMQ.
- **AlertRule** — reguły alertów per klient. `type` (`BALANCE_LOW|USAGE_THRESHOLD|DAILY_LIMIT`), `threshold`, `channel` (`email|webhook|both`), `lastTriggered` (debounce 24h).
- **AuditLog** — append-only audyt. `actorType` (`CUSTOMER|ADMIN|SYSTEM`), `action`, `resource`, `metadata`, `ipAddress`.

---

## 4. Auth + identyfikacja

### 4.1 Rejestracja — `POST /v1/auth/register` (`Public`)
Wejście: `{ name, email }` (zod, strict).
Backend (`auth.service.ts`):
1. Sprawdza unikalność email → `ConflictException 409 EMAIL_EXISTS`.
2. Generuje raw key: `om_live_<24 random bytes b64url>`.
3. Hashuje `sha256(rawKey)` → zapisuje do `Customer.apiKeyHash`.
4. Tworzy `Customer` (`tier='free'`, `isActive=true`).
5. Tworzy `CreditWallet` z `balance=10000`, `userId=null` (portfel poziomu Customer, bez per-user-walletów).
6. Async fire-and-forget: `audit.log({ action: 'AUTH_REGISTER' })`.
7. Zwraca `{ id, name, email, apiKey: rawKey }` — **raw key zwracany jeden raz**.

### 4.2 Rotacja klucza — `POST /v1/auth/rotate-key` (`X-API-Key`)
Generuje nowy `om_live_xxx`, nadpisuje `apiKeyHash` na Customer. Stary klucz przestaje działać. `audit.log({ action: 'API_KEY_ROTATED' })`.

### 4.3 Auth na endpointach klienta — `ApiKeyGuard`
Plik: `src/common/guards/api-key.guard.ts`.
1. Wyciąga klucz z `Authorization: Bearer ...` lub `X-API-Key: ...`.
2. `sha256(klucz)` → `Customer.findFirst({ apiKeyHash, isActive: true })`.
3. Jeśli nie ma → `401 INVALID_API_KEY`.
4. Wkłada `req.customer = { id, name, tier }` do requestu.

### 4.4 Auth admin — `AdminGuard`
Czyta env `ADMIN_API_KEY` i porównuje z headerem `X-Admin-Key`. Wszystkie `/v1/admin/*` endpointy.

---

## 5. Proxy — serce aplikacji

### 5.1 Endpointy (`proxy.controller.ts`)
Wszystkie chronione `ApiKeyGuard`:
- `POST /v1/proxy/anthropic/messages` — proxy do Anthropic Messages API.
- `POST /v1/proxy/openai/chat/completions` — proxy do OpenAI Chat Completions API.
- `POST /v1/proxy/chat` — auto-detect po polu `provider` w body lub `model`.

Streaming: jeśli `body.stream === true`, controller zwraca raw body do klienta (na razie buforowane jako string — patrz §13 znane ograniczenia).

### 5.2 Providery (`providers/anthropic.provider.ts`, `openai.provider.ts`)
Każdy provider implementuje `BaseProvider`:
```ts
proxy(requestBody, apiKey, isStreaming): Promise<ProxyResult>
```
**Krytyczne**: argument `apiKey` jest **ignorowany** (`_apiKey` w sygnaturze). Provider w konstruktorze wstrzykuje `ConfigService` i czyta `process.env.ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. To znaczy:
- Wszystkie wywołania od wszystkich klientów lecą z **jednego** klucza po stronie operatora.
- Jeśli env nie ustawiony — request poleci z pustym headerem `x-api-key` / `Bearer ` → provider zwróci 401.

**Anthropic** (`anthropic.provider.ts`):
- `canHandle(model)` = `lower.includes('claude')`.
- POST do `https://api.anthropic.com/v1/messages` z `x-api-key` + `anthropic-version: 2023-06-01`.
- `extractUsage()` z `data.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- `extractStreamUsage()` parsuje SSE — `message_start` → input + cache, `message_delta` → output.

**OpenAI** (`openai.provider.ts`):
- `canHandle(model)` = `model` zawiera `gpt`, `o1` lub `o3`.
- POST do `https://api.openai.com/v1/chat/completions` z `Authorization: Bearer <key>`.
- Streaming wymusza `stream_options: { include_usage: true }` żeby dostać usage w ostatnim chunku.
- `extractUsage()`: `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`. Anthropic-style cache_creation nie jest dostępny w OpenAI.

### 5.3 Flow proxy — `proxy.service.ts`

```
1. body = requestBody, model = body.model, featureId = body.featureId ?? 'api-proxy'

2. Entitlements check (jeśli EntitlementsService dostępny):
   const access = await entitlements.checkAccess(customerId, featureId)
   if (!access.allowed) → 403 ACCESS_DENIED { reason, suggestion }

3. resolveProvider(provider, model):
   - jeśli provider === 'anthropic' lub anthropic.canHandle(model) → anthropic
   - jeśli provider === 'openai' lub openai.canHandle(model) → openai
   - inaczej → null → 400 UNSUPPORTED_PROVIDER

4. result = await resolvedProvider.proxy(body, '', isStreaming)
   ↑ drugi argument (klucz) PUSTY → provider używa env

5. Jeśli result.status >= 400 → zwraca surowo do klienta (BEZ deduction kredytów)

6. audit.log({ action: 'PROXY_REQUEST', metadata: { provider, model, tokens } })
   ↑ fire-and-forget, .catch(() => {})

7. billing.burnCredits(customerId, provider, model, in, out, cacheRead, cacheCreation, ...)
   ↑ fire-and-forget, .catch(err => console.error(...))
   ↑ jeśli wallet ma za mało kredytów — TUTAJ wyleci błąd, ale jest zjedzony przez .catch
   ↑ czyli proxy ZAWSZE zwraca odpowiedź, nawet jeśli klient nie miał kredytów na to wywołanie

8. return result do controller'a → JSON.parse(result.body) lub raw stream
```

**Konsekwencja**: pre-check (entitlement) blokuje, ale brak twardego pre-check'u salda. Klient może mieć -1000 kredytów (debet), bo `burnCredits` jest fire-and-forget post-response. Pre-check istnieje dopiero wewnątrz `burnCredits` przez `INSUFFICIENT_BALANCE 400`, ale ten błąd nie dociera do klienta — leci do console.error.

### 5.4 Billing — `burnCredits()` (`billing.service.ts:36`)
1. `resolvePricingFromDb(provider, model)` — szuka 4 rekordów `ProviderCost` (`INPUT_TOKEN`, `OUTPUT_TOKEN`, `CACHE_READ_TOKEN`, `CACHE_WRITE_TOKEN`) z `validUntil=null`. Konwertuje `costPerUnit` × `1_000_000/unitSize` aby normalizować do "$ za 1M tokenów".
2. Jeśli brak w DB → fallback `pricing.service.ts:resolvePricing()` (hardcoded tabele).
3. `calculateCost(in, out, cacheRead, cacheCreation, pricing)` → `{ inputUsd, outputUsd, cacheReadUsd, cacheWriteUsd, totalUsd }`. Cache-read = 10% input price, cache-write = 125% input price.
4. `usdToCredits(usd) = Math.ceil(usd * 1000)` — 1000 kredytów = $1.
5. Znajduje `CreditWallet` (po `customerId`, `userId=null`).
6. Jeśli `balance < credits` → `400 INSUFFICIENT_BALANCE` (ale zjedzony, patrz wyżej).
7. **Atomowa transakcja Prisma**:
   - `wallet.balance -= credits`
   - insert `CreditTransaction` (`type='BURN'`, `amount=-credits`, before/after)
   - insert `UsageEvent` (`TOKEN_USAGE`, wszystkie tokeny + `creditsBurned` + `costUsd`)
8. Po transakcji fire-and-forget:
   - `audit.log({ action: 'CREDITS_BURNED' })`
   - `alerts.evaluateAlerts(customerId, 'burn', { newBalance, creditsBurned })`
   - `webhooks.emitEvent(customerId, 'credits.burned', { ... })`

---

## 6. Billing — pozostałe endpointy (`billing.controller.ts`)

Wszystkie chronione `ApiKeyGuard`:
- `GET /v1/billing/balance` — `{ walletId, balance, reserved, available, currency }`.
- `POST /v1/billing/top-up` — `{ amount }` → atomic: `balance += amount`, insert `CreditTransaction (PURCHASE)`. **Nie ma podpięcia do Stripe** — jest to manualne dolewanie. W praktyce raczej do testów / admina. `audit.log({ action: 'CREDITS_TOPPED_UP' })`.
- `GET /v1/billing/transactions?page&limit` — paginowana historia z `CreditTransaction` (desc by createdAt, default 25/page).
- `GET /v1/billing/pricing` (Public lub API key — sprawdź) — lista `ProviderCost` z `validUntil=null`, grupowana po `(provider, model)`.

---

## 7. Usage tracking (`usage.controller.ts`)

- `POST /v1/usage/ingest` — manualny zapis `UsageEvent` przez klienta. Zod schema: `eventType, featureId, provider?, model?, tokeny..., creditsBurned, costUsd?, metadata?, idempotencyKey?, userId?`. Idempotency: jeśli `idempotencyKey` istnieje → zwraca istniejący event bez zmian.
- `GET /v1/usage/stats?from&to` — agregaty dla `customerId`: `totalCredits` (sum creditsBurned), `totalRequests` (count), `byProvider` (groupBy provider z sumami).
- `GET /v1/usage/events?page&limit` — paginowana historia (desc by createdAt).

**Brak filtrowania po `userId` (externalId), brak `applicationId`** — bo te koncepcje nie istnieją w schemacie.

---

## 8. Admin (`admin.controller.ts`)

Chronione `AdminGuard` (header `X-Admin-Key`):
- `POST /v1/admin/pricing` — `{ provider, model, costType, costPerUnit, unitSize=1_000_000 }` → insert `ProviderCost`.
- `DELETE /v1/admin/pricing/:id` — usunięcie.
- `GET /v1/admin/customers?page&limit` — lista wszystkich klientów + ich wallets.
- `GET /v1/admin/analytics` — system-wide agregaty (totalCustomers, totalCreditsBurned, totalRequests, top providers/models — co dokładnie zależy od implementacji `admin.service.ts`).

---

## 9. Entitlements — feature gating (`entitlements.service.ts`)

Wywoływane z `proxy.service.ts` przed forward'em.

`checkAccess(customerId, featureId)`:
1. Lookup `Entitlement` po `(customerId, featureId, period='MONTHLY')`.
2. Jeśli brak — `{ allowed: false, reason: 'Brak uprawnień', suggestion: 'Uaktualnij plan' }`.
3. Jeśli `limitType='NONE'` — `{ allowed: true }` (unlimited).
4. Inaczej: `getPeriodStart(period)` → query `usageEvent.aggregate({ where: { customerId, featureId, createdAt >= periodStart }, _sum: creditsBurned })`.
5. `remaining = limitValue - totalBurned`.
6. Jeśli `remaining <= 0` i `limitType='HARD'` → `{ allowed: false }`.
7. Jeśli `limitType='SOFT'` i `remaining < 20% limitu` → `{ allowed: true, reason: warn }`.

`setEntitlement(customerId, featureId, config)` — upsert z poziomu admina.

**Domyślnie nowi Customer'zy nie mają żadnych Entitlements** — czyli proxy by ich blokował, gdyby Entitlements były aktywne. Aktualnie w `proxy.service.ts` jest `@Optional() private entitlements`, więc działa tylko jeśli moduł jest podpięty (jest, w `app.module.ts`). Trzeba sprawdzić czy domyślnie `featureId='api-proxy'` ma `Entitlement` z `NONE`, inaczej nikt nie przepuści proxy.

> **Uwaga**: prawdopodobnie tu jest bug / niedociągnięcie — register'em nie tworzy się żadnego Entitlement, więc świeży klient dostałby `403 ACCESS_DENIED`. Albo Entitlements moduł jest dezaktywowany de facto, albo jest wyjątek dla braku reguły (kod: "brak entitlement = blok"). To zachowanie do potwierdzenia przy testach.

---

## 10. Webhooks, Alerts, Emails, Audit, Jobs — moduły wspierające

### 10.1 Webhooks (`webhooks.module`)
- CRUD przez klienta: `POST/GET/DELETE /v1/webhooks` (URL, secret, events[]).
- `emitEvent(customerId, event, payload)` — znajduje `WebhookConfig` z `events.has(event)`, kolejkuje delivery do **BullMQ webhook-deliveries queue** (3 attempts, exponential backoff 5s).
- Worker (`jobs/workers/webhook.worker.ts`): HTTP POST z headerem `X-Signature: sha256=<hmac>` (HMAC-SHA256 z `secret`). Zapis do `WebhookDelivery` (statusCode, response, attempts, deliveredAt).
- Eventy emitowane: `credits.burned`, `balance.low`, `usage.threshold` itp.
- `POST /v1/webhooks/:id/test` — manualne wystrzelenie testowego payloadu.

### 10.2 Alerts (`alerts.module`)
- `AlertRule` per klient: `BALANCE_LOW | USAGE_THRESHOLD | DAILY_LIMIT`.
- `evaluateAlerts(customerId, event, context)` wywoływane z `billing.burnCredits` i `usage.ingest`. Sprawdza reguły, debounce 24h (`lastTriggered`).
- Po triggerze: w zależności od `channel` → `webhooks.emitEvent(...)` i/lub `emails.sendLowBalance(...)`.

### 10.3 Emails (`emails.module`)
- `EmailsService` używa **Resend** (env `RESEND_API_KEY`).
- Templates: `welcome`, `low_balance`, `invoice`, `api_key_rotated`, `usage_report`.
- W aktualnym kodzie głównie `welcome` (po register) i `low_balance` (z alerts). Pozostałe — szkielet.

### 10.4 Audit (`audit.module`)
- `audit.log({ customerId, actorType, actorId, action, resource, metadata, ipAddress })` — append-only insert do `AuditLog`.
- Wywoływane (fire-and-forget z `.catch`) z auth, billing, proxy, admin.
- `getLogs(filters)` — paginowane, filtry: `customerId, action, from, to`.

### 10.5 Jobs (`jobs.module`)
- BullMQ na Redis. Trzy kolejki:
  - `webhook-deliveries` — outbound webhooków (z retries).
  - `usage-processing` — async agregacja usage (jeśli ingest jest hot-path bottleneck).
  - `email-sending` — wysyłka maili (async, retries).
- Workery: `webhook.worker.ts`, `usage.worker.ts`, `email.worker.ts`.

### 10.6 Health (`health.controller.ts`)
- `GET /health` (Public) → `{ status: 'ok'|'degraded', services: { database, redis }, uptime }`. Sprawdza `prisma.$queryRaw 'SELECT 1'` i `redis.ping()`.

---

## 11. Rate limiting

`src/common/guards/throttle.guard.ts` (z planu, prawdopodobnie zaimplementowany):
- Per-customer Redis sliding window: `rate_limit:{customerId}:{routerPath}`.
- Limity per tier: `free=30/min`, `pro=300/min`, `enterprise=3000/min`.
- Headery `X-RateLimit-Limit` i `X-RateLimit-Remaining` w response.
- Po przekroczeniu → `429 RATE_LIMIT_EXCEEDED`.

---

## 12. Środowisko (`.env.example`)

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_gateway
REDIS_URL=redis://localhost:6379
JWT_SECRET=...                    # zarezerwowany — nieużywany w aktualnej auth
ADMIN_API_KEY=adm_dev_key_...

# Klucze providerów (UŻYWANE PRZEZ PROXY DLA WSZYSTKICH KLIENTÓW)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

RESEND_API_KEY=                   # do emails
PORT=3000
NODE_ENV=development
```

---

## 13. Znane ograniczenia / dziwactwa

1. **Streaming nie jest prawdziwie strumieniowy** — `anthropic.provider.ts` i `openai.provider.ts` używają `await response.text()` (czyta cały body do stringa) zamiast pipe'owania `response.body` jako stream. Dla SSE klient dostanie odpowiedź dopiero po zakończeniu generacji u providera. Zaplanowane do refaktora.
2. **`burnCredits` jest fire-and-forget** — błąd `INSUFFICIENT_BALANCE` jest zjadany przez `.catch(console.error)` w `proxy.service.ts:90`. Klient z saldem 0 dostanie odpowiedź AI, ale nie zobaczy że nie zapłacił. To znaczy że obecnie **kredyty są de facto soft cap, nie hard cap** — wbrew Entitlement logice.
3. **`Entitlement` blokuje przez brak rekordu** — `checkAccess` zwraca `allowed: false` jeśli klient nie ma `Entitlement` dla `featureId='api-proxy'`. Register nie tworzy domyślnych entitlements. W praktyce moduł musi być nieaktywny lub być seedowany domyślny. Do potwierdzenia przy ruchu.
4. **`User` (end-user, externalId) jest tabelą-widmem** — istnieje w schemacie, ale żadne flow proxy nie wstrzykuje `userId`. Tylko `usage/ingest` przyjmuje go w body.
5. **Brak hashowania hasła / JWT** — auth opiera się tylko na API kluczu. `JWT_SECRET` w env jest zarezerwowany, ale nieużywany.
6. **Top-up to manualny insert** — żadnej integracji z Stripe / paymentami. To znaczy obecnie nie ma sposobu na realne kupienie kredytów przez klienta poza wywołaniem endpoint'u, który po prostu doda balance bez płatności.
7. **`webhooks.emitEvent` używa BullMQ queue, ale `JobsModule` musi mieć skonfigurowane Redis-y i workery działają w tym samym procesie** — w produkcji warto wydzielić workery (osobne procesy / Railway services).
8. **`UsageEvent.userId` może łapać końcowego usera, ale `proxy.controller.ts` nie wstrzykuje go automatycznie** — więc bez ręcznego ingestu lub modyfikacji proxy, statystyki per-end-user nie istnieją.
9. **OpenRouter nie jest wspierany** — tylko Anthropic + OpenAI.

---

## 14. Pełna mapa endpointów (live)

| Method | Path | Auth | Status |
|---|---|---|---|
| POST | `/v1/auth/register` | Public | ✅ live |
| POST | `/v1/auth/rotate-key` | API key | ✅ live |
| GET | `/v1/auth/me` | API key | ✅ live |
| GET | `/v1/billing/balance` | API key | ✅ live |
| POST | `/v1/billing/top-up` | API key | ✅ live (ale bez paymentu) |
| GET | `/v1/billing/pricing` | API key | ✅ live |
| GET | `/v1/billing/transactions` | API key | ✅ live |
| POST | `/v1/proxy/anthropic/messages` | API key | ✅ live (z env keys) |
| POST | `/v1/proxy/openai/chat/completions` | API key | ✅ live (z env keys) |
| POST | `/v1/proxy/chat` | API key | ✅ live (auto-detect) |
| POST | `/v1/usage/ingest` | API key | ✅ live |
| GET | `/v1/usage/stats` | API key | ✅ live |
| GET | `/v1/usage/events` | API key | ✅ live |
| POST | `/v1/admin/pricing` | Admin key | ✅ live |
| DELETE | `/v1/admin/pricing/:id` | Admin key | ✅ live |
| GET | `/v1/admin/customers` | Admin key | ✅ live |
| GET | `/v1/admin/analytics` | Admin key | ✅ live |
| POST | `/v1/webhooks` | API key | ✅ live |
| GET | `/v1/webhooks` | API key | ✅ live |
| DELETE | `/v1/webhooks/:id` | API key | ✅ live |
| POST | `/v1/webhooks/:id/test` | API key | ✅ live |
| GET | `/v1/webhooks/:id/deliveries` | API key | ✅ live |
| POST | `/v1/alerts` | API key | ✅ live |
| GET | `/v1/alerts` | API key | ✅ live |
| PATCH | `/v1/alerts/:id` | API key | ✅ live |
| DELETE | `/v1/alerts/:id` | API key | ✅ live |
| POST | `/v1/entitlements/check` | API key | ✅ live |
| GET | `/v1/entitlements` | API key | ✅ live |
| POST | `/v1/admin/entitlements` | Admin key | ✅ live |
| GET | `/v1/admin/audit-logs` | Admin key | ✅ live |
| GET | `/health` | Public | ✅ live |
| GET | `/docs` | Public | ✅ live (Swagger UI) |
| GET | `/docs-json` | Public | ✅ live (OpenAPI spec) |

---

## 15. Co to oznacza dla Twojej zmiany (BYOK + Stripe)

W skrócie: **całe drzewo billingu, auth i proxy musi się przesunąć**:

- Auth: `Customer` → `Account` z hasłem + JWT. API-key przeniesie się z poziomu Customer na poziom Application.
- Proxy: drugi argument `apiKey` w `BaseProvider.proxy()` przestanie być ignorowany — będzie pochodził z `UserProviderKey` decyptowanego z DB. Env keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) znikną.
- Billing: `CreditWallet`/`CreditTransaction` znikną na rzecz `TokenLedger` + Stripe `Subscription`/`TokenPackage`. `top-up` bez Stripe → `checkout` z Stripe.
- Schema: 5 nowych modeli (`Application`, `GatewayApiKey`, `UserProviderKey`, `Subscription`, `TokenPackage`, `Plan`, `PackageOffer`, `TokenLedger`, `StripeEvent`), `User` → `EndUser` z `applicationId`, `UsageEvent` dostaje 4 nowe relacje.

Pełna lista zmian w `PLAN-BYOK.md` sekcje 4–6.
