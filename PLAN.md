# AI Gateway — Plan naprawy aplikacji (final)

> Stan kodu zwalidowany 2025: backend `backend/` (Nest 11 + Fastify + Prisma + Redis + BullMQ),
> frontend `apps/dashboard/` (Vite 6 SPA + TanStack Router/Query + Orval + Zustand + Tailwind 4 + shadcn fragm.).
> `frontend/` to martwy stub (PLAN.md o TanStack Start/Nitro, **nigdy nie zaimplementowane**).

---

## Decyzje zatwierdzone

- **Hard cutover** — drop schemy, fresh deploy, brak migracji danych ani dual-write.
- **Brak logowania promptów** — tylko metadane (model, tokens, latency, errorCode); content opt-in poza MVP.
- **Pojedyncza domena** `https://api.raccoon.dev/v1/...` — bez custom domains per Account.
- **Multi-tenant admin TAK** — `/admin/*` zostaje, naprawiamy nagłówki (JWT z `role='admin'`, `X-Admin-Key` jako fallback).
- **Frontend stack utrzymany** — Vite 6 SPA + TanStack Router + TanStack Query + Orval + Zustand + Tailwind + shadcn. Bez przepisywania na Next.js / TanStack Start.
- **Stripe wycofany** całkowicie z planu MVP (`/billing/*` znika z backendu i frontu).
- **Refresh tokens: krótki access (15 min) + refresh (30 d)** — tabela `RefreshToken` w schemacie, endpoint `POST /v1/auth/refresh`, rotacja w `customFetch` przed expiry.
- **`packages/sdk/`** — w scope MVP, dostarczany w Sprincie 4 razem z `/docs` jako część developer experience.
- **Kolejność deliverables:** `1 → 2 → 4 → 3` — najpierw `schema.prisma`, potem Sprint 1 tickety, skill projektowy, na końcu diff (`customFetch` w Sprincie 1, `gateway.service.ts` dopiero w Sprincie 2).
- **Email normalization:** lowercase + trim w app layer (Zod transform). Plain `text @unique` w DB, bez `citext`. Jeden wspólny `emailSchema` w `shared/validation/email.schema.ts` wymuszany w każdym DTO z polem email.
- **Soft delete na `Account`:** kolumna `deletedAt` + `onDelete: Restrict` na wszystkich relacjach `Account → child` (wyjątek: `RefreshToken` cascade — ulotne). Hard delete (anonimizacja PII, zachowanie agregatów) tylko przez endpoint GDPR w Phase 4.
- **Pełny audit BYOK:** każdy `encrypt`/`decrypt`/`decryption_failed`/`invalid_at_provider` każdy request data plane — trafia do `audit_logs`. Tabela rośnie ~per-request, dlatego: BRIN index na `created_at` od początku, retention worker (90 d hot-path / 2 lata reszta) w Phase 4.

---

## Część I — Backend (4 fazy, ~3 tygodnie)

### Faza 1 — Tożsamość: Account + Application + JWT (5–7 dni)

Hard cutover → docelowy schemat od razu, jeden migrate.

**Schemat (target, jednorazowo):**
- `Account` (zamiast `Customer`): `email`, `passwordHash` (argon2id), `emailVerified`, `name`, `role` (`user|admin`), `isActive`.
- `RefreshToken`: `accountId`, `tokenHash` (sha256), `expiresAt`, `revokedAt`, `replacedById` (rotation chain), `userAgent`, `ip` — indeks na `(accountId, expiresAt)` + `tokenHash` unique.
- `Application`: `accountId`, `name`, `description`, `isActive`.
- `ApplicationKey`: `applicationId`, `keyHash` (argon2id), `keyPrefix` (`sk-rcn-live-abcd`, 16 chars, indexed), `label`, `lastUsedAt`, `expiresAt`, `revokedAt`.
- `UserProviderKey`: `accountId`, `provider` (enum `OPENAI|ANTHROPIC|OPENROUTER`), `encryptedKey` (Bytes, AES-256-GCM envelope), `encryptionKeyId`, `label`, `lastUsedAt`.
- `EndUser`: `applicationId`, `externalId`, `metadata` (Json), unique `(applicationId, externalId)`.
- `ModelPricing` (rename `ProviderCost`): info-only, do liczenia `costUsd` w `UsageEvent`.
- `UsageEvent`: + `applicationId` (req), `applicationKeyId` (req), `endUserId` (opt), `ttftMs`, `latencyMs`, `finishReason`, `isStream`; usuwasz `creditsBurned`.
- Drop: `CreditWallet`, `CreditTransaction`, `Entitlement`, enumy billingowe.

**Endpointy auth (JWT):**
- `POST /v1/auth/register` — `{ email, password, name? }` → wysyła verify email, zwraca `{ accountId }`.
- `POST /v1/auth/verify-email` — `{ token }`.
- `POST /v1/auth/login` — `{ email, password }` → `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, account }` (access TTL 15 min, refresh TTL 30 d).
- `POST /v1/auth/refresh` — `{ refreshToken }` → nowa para tokenów (rotacja: stary token markowany jako `replacedById`, użycie cofniętego = revoke całej rodziny).
- `POST /v1/auth/logout` — revoke aktualnego refresh tokena (i jego rodziny).
- `GET /v1/auth/me` (JWT).
- `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`.

**Guardy:**
- `JwtAuthGuard` dla control plane.
- `AdminGuard` (już jest) — działa na JWT z `role='admin'` zamiast `X-Admin-Key`. Zostawiamy `X-Admin-Key` jako fallback do automatów/skryptów.
- `ApplicationKeyGuard` dla data plane (`sk-rcn-...`).

**Encryption:**
- `EncryptionService` z `aes-256-gcm`, master key z env `MASTER_ENCRYPTION_KEY` (base64), `MASTER_KEY_ID=v1`.
- Format zaszyfrowanego klucza: `[12B IV][16B AuthTag][N B ciphertext]`.
- Key rotation-friendly: `encryptionKeyId` w wierszu pozwala później zrotować masterek bez deszyfrowania wszystkiego.
- **Pełny audit:** każdy `encrypt(plaintext, accountId)` i `decrypt(ciphertext, accountId)` loguje `provider_key.encrypted` / `provider_key.decrypted` do `AuditLog` (metadata: `keyId, provider, requestId, model` — NIGDY plaintext). Decryption failure → `provider_key.decryption_failed` (security signal).

**Endpointy CRUD:**
- `GET/POST/PATCH/DELETE /v1/apps`.
- `GET/POST/DELETE /v1/apps/:id/keys` — POST zwraca `secret` raz.
- `GET/POST/DELETE /v1/provider-keys`, `POST /v1/provider-keys/:id/test`.

**Bugfix przy okazji:** sha256 → argon2id; lookup po `keyPrefix` index (jeden compare, mikrosekundy).

**Soft delete services (Phase 1 scope):**
- `Account.softDelete(id)`: set `deletedAt = now()`, rename `email` → `deleted+<id>@deleted.local` (żeby zwolnić unique), revoke wszystkie `ApplicationKey` (`revokedAt = now`), revoke wszystkie `RefreshToken`.
- `JwtAuthGuard`: odrzuca JWT jeśli `account.deletedAt != null` (treat as logged out).
- Hard delete (anonymization) i cooling-off worker — Phase 4.

### Faza 2 — BYOK gateway + nowe endpointy proxy (5–7 dni)

- `ProviderRouterService` — model prefix routing: `anthropic/claude-sonnet-4-7` → `{ provider: 'anthropic', model: 'claude-sonnet-4-7' }`; opcjonalny override `x-rcn-provider`.
- Nowe controllery (data plane):
  - `POST /v1/chat/completions` (OpenAI-compat, drop-in dla `openai` SDK).
  - `POST /v1/messages` (Anthropic-compat, drop-in dla `@anthropic-ai/sdk`).
  - `GET /v1/models` (lista modeli na bazie skonfigurowanych Provider Keys usera).
- Translation layer: `openai-to-anthropic.ts`, `anthropic-to-openai.ts`.
- **`BaseProvider.proxy(body, apiKey, isStream)` — drugi argument finally używany.** Decryptujesz BYOK z `UserProviderKey` per request, cache w Redis 60s.
- `OpenRouterProvider` (analogiczny, prefix `openrouter/...`).
- `UsageRecorderService` → BullMQ `usage-recording` queue zamiast fire-and-forget.
- `usage-recording.worker` → INSERT do `usage_events`, opcjonalnie agregacja do `usage_daily` MV.
- Stare `/v1/proxy/anthropic/messages` itp. **drop** — hard cutover.

### Faza 3 — Real streaming + analytics endpointy (5–7 dni)

- **Refaktor providerów do prawdziwego streamingu:**
  - Fastify `reply.raw` + `response.body.pipeThrough(...)`.
  - `UsageExtractorTransform` — parse SSE inline (Anthropic `message_start` + `message_delta`; OpenAI wymuszasz `stream_options.include_usage`, ostatni chunk przed `[DONE]`).
  - Mierzysz `ttftMs` przy pierwszym chunku.
- Tokenizer fallback — `tiktoken` + `@anthropic-ai/tokenizer` (gdy provider nie zwróci usage).
- `AnalyticsModule`:
  - `GET /v1/analytics/overview?from&to&applicationId?`.
  - `GET /v1/analytics/breakdown?dimension=app|model|provider|endUser&from&to`.
  - `GET /v1/analytics/timeseries?metric=requests|tokens|cost|latency_p95&granularity=hour|day`.
  - `GET /v1/analytics/events?cursor&limit&filters` (cursor-based).
- Indeksy Postgres (krytyczne):
  ```sql
  CREATE INDEX idx_usage_account_created  ON usage_events (account_id, created_at DESC);
  CREATE INDEX idx_usage_app_created      ON usage_events (application_id, created_at DESC);
  CREATE INDEX idx_usage_app_model_ts     ON usage_events (application_id, model, created_at DESC);
  CREATE INDEX idx_usage_created_brin     ON usage_events USING BRIN (created_at);
  ```
- Optional: MV `usage_daily` — refresh co godzinę, fallback gdy `usage_events` rośnie >10M wierszy.

### Faza 4 — Cleanup & admin (3–5 dni)

- Drop modułów `billing`, `entitlements` (jeśli jeszcze nie z Fazy 1).
- Webhook events: `usage.recorded`, `request.error`, `provider_key.invalid`, `application.created/deleted`, `key.created/revoked`.
- `AlertRule` enum: + `ERROR_RATE_HIGH`, `LATENCY_P95_HIGH`; drop `BALANCE_LOW`.
- Multi-tenant admin endpointy:
  - `GET /v1/admin/accounts` — lista + counts (apps, keys, usage).
  - `GET /v1/admin/accounts/:id` — szczegóły.
  - `GET /v1/admin/analytics` — system-wide metryki.
  - `GET /v1/admin/audit-logs`.
  - **Auth: JWT z `role='admin'`** (preferowane) **lub `X-Admin-Key`** (fallback).
- Usunięcie env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (operator keys).
- Update Swagger/OpenAPI spec → trigger Orval regeneration.
- Update README z BYOK quick-start.

---

## Część II — Frontend (4 fazy równolegle z backendem)

Refaktor w miejscu — nie przepisujemy. 21 routów istnieje, refaktorujemy je. Recharts/RHF+Zod/Radix są zainstalowane (`package.json`), ale nieużywane — tu właśnie wchodzimy.

### Faza 1 (front) — Auth migracja + base layer fixes (4–5 dni)

**Migracja auth (BREAKING):**
- `/login`: `email + password` zamiast `apiKey`, payload do `POST /v1/auth/login`.
- `/register`: nowa strona z `email + password + name?`.
- `/verify-email`, `/forgot-password`, `/reset-password` — nowe routy.
- Zustand store: `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, account }` zamiast `{ apiKey, customer }`.
- `customFetch`: `Authorization: Bearer ${accessToken}`; **proaktywny refresh** gdy `expiresAt - now < 60s` przed wysyłką, **reaktywny refresh** na 401 (jednorazowy retry) — pojedynczy in-flight refresh deduplikowany przez Promise singleton, żeby równoległe requesty nie zrobiły N refreshy naraz.
- Po revoke refresh tokena (`POST /v1/auth/logout` lub 401 na `/refresh`) → wyczyść store + redirect do `/login`.
- 401 handler już istnieje (auto-logout) — działa po zmianie.

**Bugfixy (z listy):**
1. `/` redirect → `/overview` przez `loader` z `redirect()` w TanStack Router.
2. Login ustawia od razu `account` (z response loginu, nie czeka na `/me`).
3. Playground: poprawne endpointy `/v1/chat/completions` i `/v1/messages` zamiast `/v1/proxy/...`.
4. Admin pages: JWT z `role='admin'` (preferowane — usuwa potrzebę dwóch headerów).
5. `data as any` — czeka na regenerację Orvala po Fazie 4 backendu.

**Foldery (refactor):**
- Wprowadzenie `features/` (alias `@features` już ustawiony w `vite.config.ts`):
  ```
  src/
  ├── features/
  │   ├── auth/          (login, register, verify-email forms + hooks)
  │   ├── applications/  (list, detail, keys management)
  │   ├── provider-keys/ (CRUD + test)
  │   ├── analytics/     (charts, breakdowns, timeseries, events)
  │   ├── playground/
  │   ├── webhooks/
  │   ├── alerts/
  │   ├── admin/         (multi-tenant view)
  │   └── settings/
  ├── routes/            (cienkie, tylko mount feature components)
  ├── shared/            (UI prymitywy, shared hooks, utils)
  └── lib/               (orval, zustand, fetch, dates, formatters)
  ```
- Routy stają się cienkie: importują komponenty z `features/`, definiują tylko mount + loadery.

**Komponenty bazowe — z planu, ale nie wdrożone (pakiety są w `package.json`):**
- **Radix Dialog** wszędzie zamiast inline `<div fixed inset-0>`.
- **Radix Select** zamiast raw `<select>`.
- **react-hook-form + zod** dla wszystkich formularzy (drop `useState` na inputach).
- `<ConfirmDialog />` — zastępuje `confirm()` JS dla destrukcyjnych akcji.

### Faza 2 (front) — Applications + Provider Keys (4–5 dni)

**Nowe routy (zastępują/uzupełniają stare):**
- `/applications` — lista apek.
- `/applications/:id` — szczegóły, tabsy `Keys / Analytics / Settings`.
- `/applications/:id/keys` — lista kluczy, generate, revoke.
- `/settings/provider-keys` — BYOK keys CRUD.
- Drop: `/settings/api-key` (cały koncept jeden-klucz-na-Customer odchodzi).
- Drop: `/billing/*` w starej formie.

**Komponenty:**
- `<KeyRevealModal />` — pokazuje `sk-rcn-live-...` raz, ostrzeżenie + copy + checkbox "zapisałem".
- `<KeyList />` — kolumny: prefix, label, lastUsed, status, actions.
- `<ProviderKeyForm />` — provider select, key input (password), label, "Test before save" checkbox.
- `<ProviderKeyTestResult />` — wynik testu (status, jakie modele zwraca provider).
- `<ProviderBadge />` — kolorowe etykiety per provider.
- `<AppForm />` — RHF + Zod.

### Faza 3 (front) — Analytics dashboard (Recharts) (5–6 dni)

- **Recharts wpięte w `/overview`** zamiast placeholderów "Wykres wkrótce".
- Nowe routy: `/analytics`, `/analytics/timeseries`, `/analytics/breakdown`, `/analytics/events`.
- Komponenty: `<MetricCard />`, `<TimeSeriesChart />` (toggle metric/granularity), `<BreakdownTable />`, `<DateRangePicker />`, `<FilterBar />` (URL state), `<ProviderModelHeatmap />` (bonus).
- TanStack Query: `staleTime: 30_000` na overview, `refetchInterval: 5_000` na live events feed (tylko gdy tab aktywny).
- URL state — wszystkie filtry analytics w search params, deep-linkable.

### Faza 4 (front) — Live logs + Admin + Docs (4–5 dni)

**Live log viewer (`/analytics/events`):**
- Cursor-based pagination (`useInfiniteQuery`).
- `<EventRow />` z expandem do drawera.
- `<EventDetail />` — provider, model, prompt/completion tokens, cost USD, latency, ttft, finishReason, requestId, errorCode.
- Filtry: provider, status, date range, app, model.
- Auto-refresh togglable.

**Admin (multi-tenant view, refaktor istniejącego):**
- `/admin/accounts` (rename z `/admin/customers`).
- `/admin/accounts/:id` — drill-down.
- `/admin/analytics`, `/admin/audit-logs`, `/admin/pricing`.
- Drop: `/admin/entitlements`.
- Header: dropujesz `X-Admin-Key`, używasz JWT z `role='admin'` (jeden customFetch dla wszystkiego).

**Developer docs (`/docs`):**
- Markdown-driven (route `/docs` istnieje).
- Sekcje: Quick start (OpenAI SDK), Anthropic SDK, LangChain / Vercel AI SDK, Model routing, End-user attribution, Webhooks, **`@raccoon/sdk` quick-start**.
- `<CodeSnippet />` z syntax highlightingiem (shiki/prism), copy button, **wstrzykuje przykładowy klucz z aktualnej apki użytkownika**.

**`packages/sdk/` — `@raccoon/sdk`:**
- Cienki wrapper nad `fetch` z dwoma trybami:
  - **Drop-in** — re-export `openai` / `@anthropic-ai/sdk` z prekonfigurowanym `baseURL` (`https://api.raccoon.dev/v1`) i `apiKey` z env.
  - **Native** — typed client `RaccoonClient` z metodami `chat.completions.create`, `messages.create`, `models.list`, plus helper `withEndUser(externalId)` (ustawia header `x-rcn-end-user`).
- Build: `tsup` → CJS + ESM + `.d.ts`, target Node 18+ i Bun, drop browser bundle (klucz nie powinien być w przeglądarce).
- Publish: `npm publish` w Sprint 4 jako `@raccoon/sdk@0.1.0`.

---

## Część III — Synchronizacja sprintów

| Sprint | Backend | Frontend |
|---|---|---|
| **Sprint 1** (~1 tydz) | Faza 1 (Account/JWT, Apps, Keys, ProviderKeys, encryption) | Faza 1 (auth migracja, bugfixy 1–4, feature-first refactor, RHF+Zod, Radix) |
| **Sprint 2** (~1 tydz) | Faza 2 (BYOK proxy, OpenRouter, UsageRecorder queue) | Faza 2 (Applications, Provider Keys, drop billing UI) |
| **Sprint 3** (~1 tydz) | Faza 3 (real streaming, analytics endpointy, indeksy) | Faza 3 (Recharts, analytics dashboard, URL state) |
| **Sprint 4** (~1 tydz) | Faza 4 (cleanup, admin endpointy, webhook event rename) | Faza 4 (live logs, admin refactor, docs) |

**Klucz:** Orval regeneruje hooki z OpenAPI po każdej iteracji backendu. Front nie pisze klienta ręcznie — czeka na Swaggera i `npm run generate:api`.

**Mock-first development:** dla nowych endpointów (gateway, analytics) backend committuje OpenAPI snapshot w PR-1, front pracuje na MSW lub stub responsach z Orvala, faktyczna implementacja backendu może iść równolegle.

---

## Część IV — Drobne ale ważne rzeczy

**Bugfixy z listy zaadresowane:**
1. ✅ `/` redirect → Faza 1 frontu.
2. ✅ Login ustawia account → Faza 1 frontu.
3. ✅ Playground endpointy → Faza 2 frontu.
4. ✅ Admin headers → Faza 1 (JWT) lub Faza 4.
5. ✅ `data as any` → Faza 4, regeneracja Orvala.
6. ✅ Edycja webhooks/alerts/entitlements → Faza 4 (entitlements drop, webhooks/alerts dostają PATCH endpointy w backendzie + UI).
7. ✅ `confirm()` JS → Faza 1 (`<ConfirmDialog />`).

**Co dropujesz całkowicie:**
- `/billing/*` route + komponenty (cały moduł, hard cutover).
- `/entitlements` route + admin entitlements.
- `/settings/api-key` (zastąpione `/applications/:id/keys`).
- `customFetch` magic dla `X-API-Key` → standardowy Bearer.
- `frontend/` folder (martwy stub z porzuconym planem TanStack Start/Nitro).

**Co zachowujesz:**
- Cały Sidebar, layout, Sonner toasty, lucide ikony, shadcn UI primitives w `shared/ui/`.
- Webhooks/Alerts UI (lekki refactor: edycja, RHF+Zod, Radix Dialog).
- Playground (poprawione endpointy + nowy format auth).
- Sidebar i nawigacja (zmienia się tylko kontekst — `Customer.name` → `Account.email/name`).

---

## Część V — Kolejność deliverables (zatwierdzona)

**Wybrana sekwencja: `1 → 2 → 4 → 3`.**

1. **Target `schema.prisma`** _(następny krok)_ — gotowy do podmiany przy hard cutover, kompletne modele + indeksy + enumy. Zawiera `RefreshToken` (decyzja: krótki access + refresh).
2. **Sprint 1 jako tickety** — backend (Account/JWT/refresh, Apps, Keys, ProviderKeys, encryption) + frontend (auth migracja, feature-first refactor, RHF+Zod, Radix, bugfixy 1–4) z estymacjami w godzinach. Pisze się prosto na bazie schematu z (1).
3. **Skill projektowy** — żeby przy kolejnych konwersacjach od razu wiedzieć o stacku, decyzjach (hard cutover, BYOK, refresh tokens, single domain, multi-tenant admin, Polish UI strings) i scope. Robione raz, działa we wszystkich przyszłych sesjach.
4. **Konkretny diff** — dwa pliki:
   - **Sprint 1:** migracja `customFetch` z `X-API-Key` → JWT Bearer + refresh logic (deduplikacja in-flight refresha).
   - **Sprint 2:** `proxy.service.ts` → `gateway.service.ts` z prawdziwym streamingiem (Fastify `reply.raw` + `UsageExtractorTransform`). Robione dopiero gdy schemat z Fazy 2 backendu jest stabilny.
