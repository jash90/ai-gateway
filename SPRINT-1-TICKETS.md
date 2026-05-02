# Sprint 1 — Tickety (Backend + Frontend)

> Cel sprintu: **Hard cutover na nowy schemat + JWT auth + Apps/Keys/ProviderKeys CRUD + auth migracja na froncie + feature-first refactor.**
>
> Po Sprincie 1 user może: założyć konto (email+hasło), zalogować się, utworzyć Application, wygenerować klucz `sk-rcn-live-...`, dodać BYOK key (OpenAI/Anthropic), przetestować go. Data plane (proxy do providerów) — Sprint 2.
>
> Estymacje: skala Fibonacci 1 / 2 / 4 / 8h, jeden FTE = ~40h/tydzień. **Łącznie: BE ~52h, FE ~40h.** Mieści się w 1 tygodniu z dwoma developerami w parallel albo 2 tygodniach z jednym.
>
> Format: każdy ticket ma ID, opis, acceptance criteria (AC), estymację, zależności (`deps: [...]`).

---

## Backend

### BE-S1-001 — Hard cutover: drop legacy schema, apply target schema
**Estymacja:** 4h
**Deps:** —
**Opis:**
Wykonaj hard cutover bazy: drop DB, wymień schema, fresh migrate, zasiej `ModelPricing` + admin account.

**AC:**
- [ ] `dropdb $DB_NAME && createdb $DB_NAME` (lokalnie i w staging)
- [ ] `rm -rf backend/prisma/migrations/`
- [ ] `mv backend/prisma/schema.target.prisma backend/prisma/schema.prisma`
- [ ] `pnpm prisma migrate dev --name init_byok` przechodzi czysto
- [ ] Dodatkowa migracja `add_brin_indexes` (raw SQL): `CREATE INDEX idx_usage_created_brin ON usage_events USING BRIN (created_at)` + `CREATE INDEX idx_audit_created_brin ON audit_logs USING BRIN (created_at)`
- [ ] `prisma/seed.ts` zaktualizowany: tworzy 1 admin account (env `ADMIN_EMAIL`, `ADMIN_PASSWORD`) + zasiewa `ModelPricing` dla GPT-4o, GPT-4o-mini, Claude Sonnet 4.5, Claude Haiku 4.5 (input + output token costs z aktualnych cenników)
- [ ] `pnpm prisma db seed` przechodzi
- [ ] README zaktualizowane o nowy bootstrap flow

---

### BE-S1-002 — Drop legacy modules (billing, entitlements, customers, users)
**Estymacja:** 2h
**Deps:** [BE-S1-001]
**Opis:** Usuń zbędny kod modułów billing/entitlements oraz wszystkie referencje do `Customer` i `User` (kontekst end-userów; teraz `EndUser` pod `Application` to inny model).

**AC:**
- [ ] `rm -rf backend/src/modules/billing backend/src/modules/entitlements`
- [ ] `app.module.ts`: usunięte importy `BillingModule`, `EntitlementsModule`
- [ ] Stary `CustomerService`, `CustomerController`, DTO i guardy oparte o `Customer` (`X-API-Key` lookup) — usunięte
- [ ] Stary `proxy/` controller — **zostaje** (Sprint 2 podmieni na `gateway/`), ale tymczasowo wyłączony (`@Module({})` bez controllers/providers) żeby nie crashował na brakującym `Customer`
- [ ] `pnpm build` przechodzi czysto

---

### BE-S1-003 — `EncryptionService` (AES-256-GCM envelope)
**Estymacja:** 4h
**Deps:** [BE-S1-001]
**Opis:** Service do szyfrowania BYOK keys + audit hook na każde encrypt/decrypt.

**AC:**
- [ ] `src/modules/crypto/encryption.service.ts` z metodami:
  - `encrypt(plaintext: string, accountId: string, ctx: { keyId?: string }): Promise<{ ciphertext: Buffer; encryptionKeyId: string }>`
  - `decrypt(ciphertext: Buffer, accountId: string, ctx: { keyId: string; requestId?: string; model?: string }): Promise<string>`
- [ ] Master key z `process.env.MASTER_ENCRYPTION_KEY` (base64, 32 bytes) — fail fast w bootstrap jeśli brak / zła długość
- [ ] Format: `[12B IV][16B AuthTag][N B ciphertext]`, `crypto.createCipheriv('aes-256-gcm', ...)`
- [ ] Każde encrypt → `auditLogService.log({ action: 'provider_key.encrypted', metadata: { keyId, ... } })`
- [ ] Każde decrypt → `provider_key.decrypted`. Decryption error (auth tag fail) → `provider_key.decryption_failed` + rethrow `DecryptionError`
- [ ] **NIGDY** nie loguj plaintextu w żadnym audicie
- [ ] Test unit: encrypt → decrypt round-trip; tampered ciphertext → throws; wrong masterek → throws
- [ ] `MASTER_KEY_ID=v1` w `.env.example`

---

### BE-S1-004 — `PasswordService` (argon2id)
**Estymacja:** 1h
**Deps:** —
**Opis:** Cienki wrapper nad `argon2` z parametrami zalecanymi przez OWASP 2024.

**AC:**
- [ ] `src/modules/auth/password.service.ts`: `hash(plaintext)`, `verify(hash, plaintext)`
- [ ] Parametry: `argon2id, memoryCost: 19456 KiB (19MB), timeCost: 2, parallelism: 1`
- [ ] Pakiet `argon2` zainstalowany (nie `bcrypt`!)
- [ ] Test: hash → verify match; verify wrong → false; verify tampered → false

---

### BE-S1-005 — `JwtService` config + access token signer
**Estymacja:** 2h
**Deps:** —
**Opis:** Konfiguracja `@nestjs/jwt` (lub `jose`) — symmetric HS256 z env, exp 15 min.

**AC:**
- [ ] `JwtModule.registerAsync({ secret: env JWT_SECRET, signOptions: { expiresIn: '15m', issuer: 'raccoon', audience: 'raccoon-api' } })`
- [ ] Helper `signAccessToken({ sub: accountId, role, email })` zwraca `{ token, expiresAt }`
- [ ] `JWT_SECRET` w `.env.example` (min 32 bytes losowe)
- [ ] Test: sign → verify happy path; expired token rejected; tampered signature rejected

---

### BE-S1-006 — `RefreshTokenService` (rotation chain z reuse detection)
**Estymacja:** 4h
**Deps:** [BE-S1-001]
**Opis:** Wystawianie + rotacja + revoke refresh tokenów. Reuse revoked-and-replaced = breach signal → revoke całej rodziny.

**AC:**
- [ ] `issue(accountId, { ip?, userAgent? })`: generuje 32 random bytes (base64url), zapisuje sha256 jako `tokenHash`, `expiresAt = now + 30d`, zwraca plaintext + meta
- [ ] `rotate(plaintextToken, ctx)`: znajduje po `sha256(plaintext)`. Jeśli `revokedAt != null` ALE `replacedById != null` → **breach** → recursywnie revoke całej rodziny przez `replacedById` chain w obu kierunkach + zwróć 401 z error code `REFRESH_TOKEN_REUSED`. Inaczej: wystaw nowy, ustaw stary `revokedAt = now, replacedById = newId`.
- [ ] `revoke(plaintextToken)`: pojedynczy token (logout)
- [ ] `revokeAllForAccount(accountId)`: dla soft-delete i password change
- [ ] Test: happy path rotation; reuse stary token → cała rodzina revoked; expired token rejected; valid token poza chainem nie jest dotykany

---

### BE-S1-007 — `AuditLogService`
**Estymacja:** 1h
**Deps:** [BE-S1-001]
**Opis:** Cienki wrapper nad `prisma.auditLog.create` używany przez wszystkie pozostałe services.

**AC:**
- [ ] `log({ accountId?, actorType, actorId?, action, resource?, metadata?, ipAddress?, userAgent? })` — jednolinijkowy create
- [ ] Fire-and-forget (non-blocking) dla hot-path actions (`provider_key.decrypted`, `provider_key.encrypted`) — wraps in `setImmediate` lub BullMQ queue. Synchronous dla security-sensitive (`account.login`, `provider_key.created`, `key.revoked`).
- [ ] Helper `extractRequestContext(req)` zwraca `{ ipAddress, userAgent }` z FastifyRequest (X-Forwarded-For aware)

---

### BE-S1-008 — Shared `emailSchema` (Zod)
**Estymacja:** 1h
**Deps:** —
**Opis:** Jeden Zod schemat dla wszystkich DTO z polem email — wymusza lowercase + trim w app layer.

**AC:**
- [ ] `src/common/validation/email.schema.ts`: `z.string().trim().toLowerCase().email().max(254)`
- [ ] Re-eksport: `passwordSchema = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/)` (12+ chars, mix case + digit)
- [ ] Test: `'JAN@X.com  '` → `'jan@x.com'`; `'invalid'` → ZodError; password słaby → ZodError

---

### BE-S1-009 — `POST /v1/auth/register`
**Estymacja:** 2h
**Deps:** [BE-S1-001, BE-S1-004, BE-S1-007, BE-S1-008]
**Opis:** Rejestracja konta + wysyłka verify-email tokena.

**AC:**
- [ ] DTO: `{ email: emailSchema, password: passwordSchema, name?: string }`
- [ ] Sprawdza unique email (przyjazny błąd 409 zamiast `P2002`)
- [ ] `passwordHash` przez `PasswordService.hash`
- [ ] Tworzy `Account` z `emailVerified: false, role: 'USER'`
- [ ] Generuje `EmailToken` z `purpose: 'VERIFY_EMAIL', expiresAt: now + 24h`
- [ ] Wysyła email via `EmailsModule` (już istnieje) z linkiem `${APP_URL}/verify-email?token=...`
- [ ] Audit: `account.registered`
- [ ] Response: `{ accountId }` (200/201; **bez** auto-login — wymagane verify lub osobny login)
- [ ] Rate limit: 5 prób/15 min per IP (Redis)

---

### BE-S1-010 — `POST /v1/auth/verify-email`
**Estymacja:** 2h
**Deps:** [BE-S1-009]
**Opis:** Aktywacja konta z linka mailowego.

**AC:**
- [ ] DTO: `{ token: string }`
- [ ] Hash tokena (`sha256`), lookup w `EmailToken` z `purpose: 'VERIFY_EMAIL', usedAt: null, expiresAt > now`
- [ ] Set `Account.emailVerified = true`, `EmailToken.usedAt = now` (transakcja)
- [ ] Audit: `account.email_verified`
- [ ] Response: `{ verified: true }` lub 400 z error code `INVALID_OR_EXPIRED_TOKEN`
- [ ] Rate limit: 10 prób/godz per IP

---

### BE-S1-011 — `POST /v1/auth/login` + `POST /v1/auth/logout`
**Estymacja:** 2h
**Deps:** [BE-S1-004, BE-S1-005, BE-S1-006, BE-S1-007, BE-S1-008]
**Opis:** Login → para `accessToken + refreshToken`. Logout → revoke refresh.

**AC:**
- [ ] `login` DTO: `{ email: emailSchema, password: z.string() }`
- [ ] Lookup po `email`, `PasswordService.verify`, sprawdza `isActive && !deletedAt && emailVerified`
- [ ] **Wszystkie negatywne przypadki zwracają identyczny błąd** `INVALID_CREDENTIALS` (no enumeration)
- [ ] Response: `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, account: { id, email, name, role } }`
- [ ] Audit: `account.login` (success) lub `account.login_failed` (na błąd; metadata: reason w skrócie, np. `WRONG_PASSWORD`, `EMAIL_NOT_VERIFIED` — tylko do supportu, nie zwracane na klienta)
- [ ] `logout`: JWT-protected, revoke refresh z body `{ refreshToken }`, audit `account.logout`
- [ ] Rate limit login: 10/15 min per IP + 5/15 min per email (sliding window)

---

### BE-S1-012 — `POST /v1/auth/refresh`
**Estymacja:** 2h
**Deps:** [BE-S1-006]
**Opis:** Rotacja pary tokenów.

**AC:**
- [ ] DTO: `{ refreshToken: string }`
- [ ] `RefreshTokenService.rotate` — happy path zwraca nową parę; reuse → 401 + revoke chain + audit `account.refresh_token_reuse_detected`
- [ ] Response identyczny jak `/login` (bez `account` lub z — preferowane: z, żeby front mógł odświeżyć stan account np. po zmianie roli)
- [ ] **Bez rate limitu** per IP (legitymne klienty rotują często) — ale per accountId limit 60/min jako defense-in-depth

---

### BE-S1-013 — `POST /v1/auth/forgot-password` + `POST /v1/auth/reset-password`
**Estymacja:** 4h
**Deps:** [BE-S1-009, BE-S1-007]
**Opis:** Flow resetu hasła z one-time tokenem (24h?... → 1h, krótki).

**AC:**
- [ ] `forgot-password` DTO: `{ email: emailSchema }`
- [ ] **Zawsze 200**, niezależnie czy email istnieje (no enumeration) — w środku: jeśli istnieje aktywny Account → wystaw `EmailToken` z `purpose: 'RESET_PASSWORD', expiresAt: now + 1h`, wyślij email
- [ ] **Limit:** max 3 aktywne (niewykorzystane, niewygasłe) reset tokeny per account; wystawienie 4-tego invaliduje wszystkie poprzednie (`usedAt = now`)
- [ ] Audit: `account.password_reset_requested`
- [ ] `reset-password` DTO: `{ token: string, newPassword: passwordSchema }`
- [ ] Lookup tokena (jak w verify-email), nowy hash, set `EmailToken.usedAt`, **revoke wszystkie RefreshTokeny dla account** (żeby wylogować inne sesje)
- [ ] Audit: `account.password_changed`
- [ ] Rate limit forgot: 3/godz per email

---

### BE-S1-014 — `JwtAuthGuard` + `GET /v1/auth/me`
**Estymacja:** 2h
**Deps:** [BE-S1-005]
**Opis:** Guard dla control plane + endpoint info o aktualnym koncie.

**AC:**
- [ ] `JwtAuthGuard`: extract `Bearer ` z `Authorization`, verify, fetch `Account` z DB (`findUnique`), reject jeśli `!isActive || deletedAt != null || !emailVerified`
- [ ] Attach `request.account` (typed)
- [ ] Decorator `@CurrentAccount()` do controllerów
- [ ] `GET /v1/auth/me` zwraca `{ id, email, name, role, emailVerified, createdAt }`
- [ ] Test: valid JWT → 200; expired → 401; revoked account (deletedAt) → 401; admin role widoczna w response

---

### BE-S1-015 — `AdminGuard` refactor
**Estymacja:** 2h
**Deps:** [BE-S1-014]
**Opis:** JWT z `role='ADMIN'` jako preferowana droga, `X-Admin-Key` jako fallback.

**AC:**
- [ ] `AdminGuard` ma 2 strategie: (1) JWT + role=='ADMIN' (preferowane); (2) jeśli brak JWT, sprawdza `X-Admin-Key` ===  env `ADMIN_API_KEY` (legacy fallback dla skryptów/CI)
- [ ] Audyt: każde użycie X-Admin-Key → `audit.action: 'admin.legacy_key_used'`
- [ ] Wszystkie istniejące controllery `/admin/*` migrowane na nowy guard (działają z JWT i z fallbackiem)
- [ ] Test: JWT user role=USER → 403; JWT role=ADMIN → 200; X-Admin-Key valid → 200; brak obu → 401

---

### BE-S1-016 — `ApplicationsService` + `ApplicationsController`
**Estymacja:** 4h
**Deps:** [BE-S1-014, BE-S1-007]
**Opis:** CRUD aplikacji per Account.

**AC:**
- [ ] `GET /v1/apps` — lista własnych aplikacji aktualnego account; query params: `includeInactive: boolean`
- [ ] `POST /v1/apps` — `{ name, description? }` → tworzy + zwraca; audit `application.created`
- [ ] `GET /v1/apps/:id` — szczegóły (z counts: `keysCount, lastUsageAt`)
- [ ] `PATCH /v1/apps/:id` — `{ name?, description?, isActive? }`; audit `application.updated`
- [ ] `DELETE /v1/apps/:id` — Restrict z poziomu DB jeśli ma usage events; w przeciwnym wypadku: cascade delete keys + audit `application.deleted`
- [ ] **Authorization:** każdy endpoint sprawdza, że `application.accountId === currentAccount.id` (404 jeśli nie pasuje, nie 403 — żeby nie ujawniać istnienia)
- [ ] DTO via Zod, walidacja `name` (min 1, max 80, sane chars)

---

### BE-S1-017 — `ApplicationKeysService` + Controller
**Estymacja:** 4h
**Deps:** [BE-S1-016, BE-S1-004]
**Opis:** Generowanie + revoke kluczy `sk-rcn-live-...`.

**AC:**
- [ ] `GET /v1/apps/:appId/keys` — lista (zwraca `keyPrefix, label, lastUsedAt, expiresAt, revokedAt, createdAt` — **nigdy** keyHash, **nigdy** plaintext)
- [ ] `POST /v1/apps/:appId/keys` — `{ label?, expiresAt? }` → generuje `sk-rcn-live-` + 32 random bytes (base64url) → secret. `keyPrefix = secret.slice(0, 16)`, `keyHash = argon2id(secret)`. Zwraca `{ id, keyPrefix, label, secret }` — **secret pokazany RAZ**
- [ ] `DELETE /v1/apps/:appId/keys/:keyId` — soft revoke (set `revokedAt = now`); audit `key.revoked`
- [ ] Audit: `key.created` (metadata: `keyPrefix, label`)
- [ ] **Authorization:** sprawdza ownership przez `application.accountId`
- [ ] Test: secret nie da się odzyskać; revoked key nie pojawia się w aktywnych; argon2id verify działa na keyHash + plaintext

---

### BE-S1-018 — `UserProviderKeysService` + Controller (BYOK CRUD)
**Estymacja:** 4h
**Deps:** [BE-S1-003, BE-S1-014, BE-S1-007]
**Opis:** Per-account klucze do OpenAI/Anthropic/OpenRouter (envelope encrypted).

**AC:**
- [ ] `GET /v1/provider-keys` — lista: `{ id, provider, label, lastUsedAt, createdAt }` (**nigdy** klucz, **nigdy** ciphertext)
- [ ] `POST /v1/provider-keys` — `{ provider: ProviderType, key: string, label? }` → walidacja kształtu klucza per provider (regex sanity check: OpenAI `^sk-`, Anthropic `^sk-ant-`, OpenRouter `^sk-or-`), encrypt, upsert (unique `(accountId, provider)` — nadpisuje istniejący)
- [ ] `DELETE /v1/provider-keys/:id` — hard delete (Restrict na Account, ale tu user jawnie usuwa)
- [ ] Audit: `provider_key.created`, `provider_key.deleted`
- [ ] **Bez** endpointu GET pojedynczego klucza (nie ma czego zwracać user-facingowo)
- [ ] Test: key wraca tylko ID + meta; delete usuwa; reupsert nadpisuje encrypted bytes

---

### BE-S1-019 — `POST /v1/provider-keys/:id/test`
**Estymacja:** 2h
**Deps:** [BE-S1-018]
**Opis:** Sprawdza czy zapisany BYOK klucz działa u providera (lista modeli).

**AC:**
- [ ] Endpoint pobiera klucz z DB, decrypt, woła:
  - OpenAI: `GET https://api.openai.com/v1/models`
  - Anthropic: `GET https://api.anthropic.com/v1/models` (dostępne w 2024)
  - OpenRouter: `GET https://openrouter.ai/api/v1/models`
- [ ] Response: `{ ok: true, sampleModels: [...top 10 by name] }` lub `{ ok: false, error: 'INVALID_KEY' | 'RATE_LIMITED' | 'NETWORK_ERROR' }`
- [ ] Audit: `provider_key.test_succeeded` lub `provider_key.test_failed`
- [ ] Timeout 5s, no retry
- [ ] Update `lastUsedAt` na success

---

### BE-S1-020 — Soft delete check w JwtAuthGuard (only the check, no service yet)
**Estymacja:** 1h
**Deps:** [BE-S1-014]
**Opis:** Już zaszyte w BE-S1-014 (`!deletedAt`), ale dodaj wprost test + dokumentację że pełna soft-delete service przychodzi w Sprincie 4.

**AC:**
- [ ] Test integracyjny: ustaw `Account.deletedAt = now` ręcznie w DB, request z valid JWT → 401 z error code `ACCOUNT_DELETED`
- [ ] Komentarz w kodzie wskazujący na Phase 4 cleanup ticket dla pełnego soft-delete service'u

---

### BE-S1-021 — Swagger/OpenAPI decoratory na nowych endpointach
**Estymacja:** 4h
**Deps:** [BE-S1-009, BE-S1-010, BE-S1-011, BE-S1-012, BE-S1-013, BE-S1-014, BE-S1-016, BE-S1-017, BE-S1-018, BE-S1-019]
**Opis:** Każdy nowy endpoint ma `@ApiOperation`, `@ApiResponse` (success + error), `@ApiBearerAuth` lub `@ApiSecurity('api-key')` + DTO przez `@ApiProperty`.

**AC:**
- [ ] `/docs` (Swagger UI) renderuje wszystkie nowe endpointy z opisami
- [ ] `/docs-json` (OpenAPI JSON) zawiera kompletne typy dla DTO i response
- [ ] Security schemes: `bearer` (JWT), `apiKey` (X-Admin-Key, deprecated note), `applicationKey` (sk-rcn-..., placeholder dla Sprintu 2)
- [ ] Tagging: `auth`, `applications`, `provider-keys`, `admin`
- [ ] Frontend run `npm run generate:api` w `apps/dashboard/` — bez błędów typów

---

## Frontend

### FE-S1-001 — Foldery `features/` + drop `frontend/` stub
**Estymacja:** 1h
**Deps:** —
**Opis:** Stwórz strukturę `apps/dashboard/src/features/` zgodnie z planem; usuń martwy stub.

**AC:**
- [ ] `apps/dashboard/src/features/` z podfolderami: `auth/`, `applications/`, `provider-keys/`, `analytics/`, `playground/`, `webhooks/`, `alerts/`, `admin/`, `settings/` — każdy z pustym `index.ts`
- [ ] `rm -rf frontend/`
- [ ] `tsconfig.json` i `vite.config.ts`: alias `@features → src/features/` zweryfikowany (już istnieje, sprawdź że działa: `import x from '@features/auth'` typechecks)
- [ ] README root zaktualizowane: skreślony `frontend/`, podkreślone że frontend = `apps/dashboard/`

---

### FE-S1-002 — Shared validation schemas (Zod)
**Estymacja:** 1h
**Deps:** —
**Opis:** Zod schematy mirror-image backendu — żeby walidacja po stronie klienta była tym samym source of truth.

**AC:**
- [ ] `apps/dashboard/src/shared/validation/email.schema.ts`: `z.string().trim().toLowerCase().email().max(254)`
- [ ] `passwordSchema` z taką samą polityką jak backend (12+ chars, mix case + digit)
- [ ] Polskie messagy błędów (`'Adres email jest nieprawidłowy'`, `'Hasło musi mieć co najmniej 12 znaków'`)
- [ ] Test: te same edge cases co BE-S1-008

---

### FE-S1-003 — Auth store refactor
**Estymacja:** 2h
**Deps:** [FE-S1-001]
**Opis:** Zamień `{ apiKey, customer }` na `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, account }`.

**AC:**
- [ ] `shared/stores/auth-store.ts` ma nowy state shape
- [ ] `account: { id, email, name, role, emailVerified } | null`
- [ ] `login(payload)`, `logout()`, `setTokens(accessToken, expiresAt, refreshToken, refreshExpiresAt)`, `setAccount(account)`
- [ ] **Persist tylko `refreshToken + refreshExpiresAt + account`** w localStorage. `accessToken + expiresAt` trzymane w pamięci (rehydrate na starcie via `/auth/refresh`)
- [ ] `isAuthenticated()`: `!!refreshToken && refreshExpiresAt > now`
- [ ] Komentarz w pliku: "MVP storage decision: refreshToken w localStorage akceptujemy. Później rozważyć HttpOnly cookie via /auth-bff albo Web Worker isolation."

---

### FE-S1-004 — `customFetch` refactor: Bearer + proactive/reactive refresh
**Estymacja:** 4h
**Deps:** [FE-S1-003]
**Opis:** Zastąp X-API-Key na JWT Bearer + automatyczny refresh (proaktywny przed expiry, reaktywny na 401).

**AC:**
- [ ] `Authorization: Bearer ${accessToken}` jeśli `accessToken` w store
- [ ] **Proaktywny refresh**: jeśli `expiresAt - now < 60_000ms` przed wysyłką → najpierw `await refreshIfNeeded()`, potem oryginalny request
- [ ] **Reaktywny refresh**: na 401 → jednorazowy retry po `refreshIfNeeded()`. Drugi 401 → logout + redirect to `/login`
- [ ] **Deduplikacja in-flight refresha**: `let refreshPromise: Promise<void> | null = null` na poziomie modułu — równoległe żądania czekają na ten sam Promise zamiast wystrzeliwać N refreshy
- [ ] `/auth/refresh` 401 → wyczyść store, redirect to `/login`
- [ ] Test (Vitest): mock fetch, scenariusze: happy path, expired access → proactive refresh → success; 401 → reactive refresh → success; 401 + refresh 401 → logout; 5 równoległych requestów z expired access → 1 refresh + 5 retries

---

### FE-S1-005 — UI primitives: Dialog, Select, ConfirmDialog, Form helpers
**Estymacja:** 4h (parallel z 003/004)
**Deps:** [FE-S1-001]
**Opis:** Dodanie shadcn-style wrapperów na Radix komponenty (są w `package.json`, nieużywane).

**AC:**
- [ ] `shared/ui/Dialog.tsx`: wrapper na `@radix-ui/react-dialog` (Trigger, Content, Header, Footer, Title, Description) — styling Tailwind v4
- [ ] `shared/ui/Select.tsx`: wrapper na `@radix-ui/react-select` z items via children
- [ ] `shared/ui/ConfirmDialog.tsx`: pre-build dialog `<ConfirmDialog title description confirmLabel destructive onConfirm />`. Hook `useConfirm()` zwracający promise (analogia do `confirm()` JS)
- [ ] `shared/ui/Form.tsx`: helpery RHF — `<FormField>`, `<FormLabel>`, `<FormMessage>`, `<FormDescription>`, helper `useZodForm(schema)` (RHF + zodResolver)
- [ ] `shared/ui/index.ts` re-eksportuje wszystkie
- [ ] Storybook? Nie. **Tylko** wizualna weryfikacja na 1 stronie auth (FE-S1-008)

---

### FE-S1-006 — Auth screens: Login + Register
**Estymacja:** 4h
**Deps:** [FE-S1-002, FE-S1-003, FE-S1-004, FE-S1-005]
**Opis:** Refaktor `/login` na email+password, nowe `/register`.

**AC:**
- [ ] `features/auth/LoginForm.tsx`: RHF + Zod (email + password), submit → `useApiMutation` na `POST /v1/auth/login`, success → `setTokens + setAccount` (od razu, bez `/me`)
- [ ] **Bugfix #2 zaadresowany**: po loginie account jest w store; nie czekamy na `/me`
- [ ] Sonner toast na sukces ("Zalogowano") i błąd (mapping error code → polski tekst)
- [ ] `features/auth/RegisterForm.tsx`: email + password + confirmPassword + name, walidacja `password === confirmPassword`, submit → `POST /v1/auth/register`, success → ekran "Sprawdź email"
- [ ] `routes/login.tsx` i `routes/register.tsx` jako cienkie mounty (`<LoginForm />` i `<RegisterForm />`)

---

### FE-S1-007 — Auth screens: VerifyEmail / ForgotPassword / ResetPassword
**Estymacja:** 4h
**Deps:** [FE-S1-006]
**Opis:** Trzy proste ekrany z token-from-URL flow.

**AC:**
- [ ] `routes/verify-email.tsx`: pobiera `?token=` z search params, auto-submit do `POST /v1/auth/verify-email`. Stany: `loading`, `success` (CTA `Zaloguj się`), `error` (CTA `Wyślij ponownie` → `POST /v1/auth/resend-verification` — jeśli backend ma; inaczej tylko link do `/register`)
- [ ] `routes/forgot-password.tsx`: form z emailem, `POST /v1/auth/forgot-password`, zawsze ten sam komunikat "Jeśli adres istnieje w bazie, wysłaliśmy link"
- [ ] `routes/reset-password.tsx`: token z URL + form `newPassword + confirmPassword`, `POST /v1/auth/reset-password`, success → redirect to `/login`
- [ ] Wszystkie z RHF + Zod + ConfirmDialog (resetowanie hasła = destructive confirm przed submitem)

---

### FE-S1-008 — Bugfix #1: `/` redirect → `/overview`
**Estymacja:** 1h
**Deps:** [FE-S1-001]
**Opis:** Aktualnie `/` pokazuje 404 lub lecący index — ma natychmiast redirectować.

**AC:**
- [ ] `routes/index.tsx`: `loader: () => redirect({ to: '/overview' })` (TanStack Router import)
- [ ] Niezalogowany user (`!isAuthenticated`) na `/overview` → redirect to `/login` (już powinno być w `__root.tsx`, weryfikuj)
- [ ] Po logout → redirect to `/login`

---

### FE-S1-009 — Bugfix #4: admin pages na unified customFetch
**Estymacja:** 2h
**Deps:** [FE-S1-004]
**Opis:** Drop osobnego `customAdminFetch` (jeśli był) lub flag w `customFetch` na X-Admin-Key — używamy tylko JWT z `role='admin'`.

**AC:**
- [ ] Wszystkie wywołania w `routes/admin/*` używają standardowego customFetch z Bearer
- [ ] Brak żadnego użycia `X-Admin-Key` w kodzie frontu (grep `X-Admin-Key` → 0 hits)
- [ ] Admin sidebar widoczny tylko gdy `account.role === 'ADMIN'` (warunkowy render w sidebar)
- [ ] Test E2E (manualny): zaloguj jako admin → widzi `/admin/*`; zaloguj jako USER → nie widzi i 403 jeśli wpisze URL

---

### FE-S1-010 — Sidebar/header: `customer.name` → `account.email/name`
**Estymacja:** 1h
**Deps:** [FE-S1-003]
**Opis:** Cosmetic — wszystkie miejsca które wyświetlały `customer` jadą teraz na `account`.

**AC:**
- [ ] grep `customer\.` w `apps/dashboard/src/` → 0 wyników (poza komentarzami i legacy refs do dropowania)
- [ ] Sidebar pokazuje `account.name || account.email`
- [ ] Avatar inicjały z `name` (lub `email[0]`)
- [ ] Logout button w dropdownie pod avatarem

---

### FE-S1-011 — Drop `/billing/*` i `/settings/api-key` z menu i kodu
**Estymacja:** 2h
**Deps:** [FE-S1-001]
**Opis:** Hard cutover na froncie — billing i jednoklucz-na-Customer odchodzi.

**AC:**
- [ ] `rm -rf apps/dashboard/src/routes/billing apps/dashboard/src/routes/entitlements`
- [ ] `rm apps/dashboard/src/routes/settings/api-key.tsx`
- [ ] Sidebar: usunięte linki do billing/entitlements/api-key
- [ ] `pnpm typecheck` przechodzi (regenerated route tree)
- [ ] `routes/admin/entitlements.tsx` też usunięte (drop)

---

### FE-S1-012 — Migracja form auth na RHF+Zod (nie wszystkie istniejące — tylko auth)
**Estymacja:** 2h (jeśli już zrobione w FE-S1-006/007 jako część implementacji — to ten ticket = 0h, traktować jako milestone)
**Deps:** [FE-S1-006, FE-S1-007]
**Opis:** Audyt że wszystkie 5 auth form używa RHF+Zod (bez `useState` na inputach).

**AC:**
- [ ] Login, Register, VerifyEmail, ForgotPassword, ResetPassword — wszystkie via `useZodForm(schema)`
- [ ] Brak `useState<string>('')` dla pól email/password w auth screens (grep weryfikacyjny)
- [ ] Migracja **innych** formularzy (apps, provider-keys, webhooks, alerts) — Sprint 2/3, NIE w Sprincie 1

---

### FE-S1-013 — Replace inline modals → Dialog + JS confirm() → ConfirmDialog (auth scope only)
**Estymacja:** 1h
**Deps:** [FE-S1-005]
**Opis:** Auth ma minimum modali, ale są: "wyślij ponownie email", "wyloguj wszystkie sesje" (z poziomu /me w przyszłości). Zaadresuj te które są.

**AC:**
- [ ] grep `confirm\(` w auth scope → 0 hits
- [ ] grep `<div .* fixed inset-0` w auth scope → 0 hits (jeśli były)
- [ ] Pozostałe miejsca w aplikacji (apps, keys revoke etc.) — Sprint 2 ticket FE-S2-XXX

---

### FE-S1-014 — Orval regen po backendzie + fix `data as any`
**Estymacja:** 2h
**Deps:** [BE-S1-021, FE-S1-001]
**Opis:** Po BE-S1-021 (Swagger) Orval generuje pełne typy — usuwamy wszystkie `data as any`.

**AC:**
- [ ] `cd apps/dashboard && npm run generate:api` przechodzi czysto
- [ ] grep `as any` w `apps/dashboard/src/` (poza testami) → max 0–2 hits, każdy z TODO komentem dlaczego
- [ ] `npm run typecheck` zielony

---

## Sumarycznie

| Kategoria | Backend (h) | Frontend (h) |
|---|---:|---:|
| Foundation (cutover, dropy) | 6 | 4 |
| Crypto + Password + JWT + Refresh | 11 | — |
| Audit log | 1 | — |
| Auth endpoints (register/verify/login/refresh/forgot/reset/me) | 12 | — |
| Guards + admin refactor | 4 | — |
| Apps/Keys CRUD | 8 | — |
| Provider Keys CRUD + test | 6 | — |
| Soft delete check | 1 | — |
| Swagger | 4 | — |
| Validation schemas | — | 1 |
| Auth store + customFetch | — | 6 |
| UI primitives | — | 4 |
| Auth screens | — | 8 |
| Bugfixy (#1, #2 inline, #4) | — | 3 |
| Layout + drop billing | — | 3 |
| Forms milestone + Orval regen | — | 4 |
| **Razem** | **53h** | **33h** |

---

## DAG zależności (kluczowe ścieżki)

**Krytyczna ścieżka backendu (najdłuższa):**
`BE-S1-001 (4h) → BE-S1-006 (4h) → BE-S1-011 (2h) → BE-S1-014 (2h) → BE-S1-016 (4h) → BE-S1-017 (4h) → BE-S1-021 (4h)` = **24h** (ok. 3 dni z jednym FTE).

**Krytyczna ścieżka frontu (zależy od BE-S1-021):**
`FE-S1-001 (1h) || FE-S1-002 (1h) || FE-S1-005 (4h) → FE-S1-003 (2h) → FE-S1-004 (4h) → FE-S1-006 (4h) → FE-S1-007 (4h) → FE-S1-014 (2h)` = **22h** (ok. 3 dni).

**Parallelism win:** front startuje na MSW mocks od FE-S1-006. Backend kończy ~D3, front-Orval-regen ~D4, Sprint 1 close ~D5 z dwoma FTE.

---

## Co świadomie odkładamy do Sprintu 2+

- **Soft-delete service backendu** (samokasowanie konta przez user) — Sprint 4 GDPR endpoint. Phase 1 tylko *check* w guardzie.
- **Migracja innych formularzy na RHF+Zod** (apps, provider-keys, webhooks) — Sprint 2 razem z featurami w których żyją.
- **Replace inline modals/confirms w pełnej aplikacji** — Sprint 2 podczas refaktoru `/applications` i `/settings/provider-keys`.
- **Endpoint `POST /v1/auth/resend-verification`** — backend nie ma w Sprincie 1; FE-S1-007 używa fallbacku "wyślij ponownie z poziomu loginu" (jeśli login zwraca `EMAIL_NOT_VERIFIED`).
- **Audit log retention worker + monthly partitioning** — Sprint 4. W Sprincie 1 tylko BRIN index.
- **Email templates pretty / branding** — Sprint 1 używa minimalnych templatek (plain text + 1 link). Brand UI maili w Sprincie 4.
