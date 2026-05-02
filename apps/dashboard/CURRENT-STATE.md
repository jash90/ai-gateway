# Frontend (Dashboard) — obecny stan

> Stan na dziś, na podstawie kodu w `apps/dashboard/src/`. Opis tego co JEST, nie planu zmian.
> Plan migracji do BYOK + Stripe + multi-app w `backend/PLAN-BYOK.md`.

---

## 1. Czym jest

**Dashboard SPA** dla obecnego AI Gateway (model "operator-managed keys + credits"). Logowanie przez wklejenie klucza API (`om_live_...`) — bez hasła, bez sesji JWT. Wszystkie dane fetchowane z backendu przez **Orval-generowane** hooki TanStack Query. UI w języku **polskim**.

Nie używa TanStack Start ani SSR — czysty Vite SPA. Plan w `frontend/PLAN.md` mówił o TanStack Start + Nitro, ale **to nie zostało zaimplementowane** — projekt jest na Vite 6 + TanStack Router (file-based, ale client-only).

---

## 2. Stack

| Co | Wersja | Po co |
|---|---|---|
| **React** | 19.1 | UI |
| **Vite** | 6.3 | Bundler + dev server |
| **TanStack Router** | 1.169 | File-based routing (client-side, **bez SSR**) |
| **TanStack Query** | 5.80 | Server state |
| **TanStack Table** | 8.21 | DataTable (3 użycia) |
| **Orval** | 7.0 | Generuje hooki z `/docs-json` (OpenAPI) |
| **Zustand** + persist | 5.0 | Auth store w localStorage |
| **Tailwind CSS** | 4.2 | Styling (przez `@tailwindcss/vite`) |
| **Radix UI** | różne | Prymitywy (dialog, select, switch, tabs, tooltip…) — **zainstalowane, ale praktycznie nieużywane** w bieżącym kodzie (poza Sidebar Separator) |
| **Recharts** | 2.15 | **Zainstalowany, nie używany** (overview pokazuje "Wykres wkrótce") |
| **React Hook Form + Zod** | 7.55 / 3.24 | **Zainstalowane, nie używane** — formularze są raw `<form>` + `useState` |
| **Sonner** | 2.0 | Toasty |
| **lucide-react** | 0.500 | Ikony |
| **class-variance-authority + tailwind-merge + clsx** | — | CVA helpers |

**Aliasy ścieżek** (`vite.config.ts` + `tsconfig.json`):
```
@         → src/
@shared   → src/shared/
@features → src/features/    (folder NIE ISTNIEJE jeszcze!)
@gen      → src/gen/
```

**Vite proxy** dev:
- `/v1/*` → `http://localhost:3000` (backend)
- `/docs` → `http://localhost:3000` (Swagger UI iframe)

---

## 3. Bootstrap (`main.tsx`)

```tsx
const queryClient = createQueryClient()         // staleTime: 30s, retry:1, refetchOnWindowFocus:false
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })

<StrictMode>
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
    <Toaster position="top-right" richColors />
  </QueryClientProvider>
</StrictMode>
```

Nie ma SSR, nie ma server functions, nie ma Suspense fallbacków na poziomie root.

---

## 4. Auth (`shared/stores/auth-store.ts`, `shared/lib/api-fetch.ts`)

### 4.1 Store (Zustand + `persist` w localStorage `ai-gateway-auth`)
```ts
{
  apiKey: string | null
  customer: { id, name, email, tier } | null
  setAuth(apiKey, customer), logout(), isAuthenticated()
}
```

### 4.2 Logowanie (`/login`)
**Surowy raw `<form>`** (nie RHF). User wkleja klucz `om_live_xxx` → wywołuje `setAuth(apiKey, null)` → redirect `/overview`.

⚠ **Zerowa walidacja klucza** po stronie frontu — klucz nie jest sprawdzany czy w ogóle istnieje. Pierwsze realne wywołanie API zwróci 401, wtedy `customFetch` wywoła `logout()` automatycznie.

⚠ **`customer` ustawione na `null`** po loginie — Sidebar nie pokaże nazwy/emaila aż do `/overview` lub innej akcji która zaktualizuje store. (Można by wywołać `useAuthControllerMe()` po loginie i zsynchronizować — nie zrobione.)

### 4.3 Rejestracja (`/register`)
Email + nazwa → `useAuthControllerRegister` → backend zwraca `{ id, name, email, apiKey }` → `setAuth(apiKey, { id, name, email, tier: 'free' })` → redirect `/overview`.

### 4.4 Custom fetch mutator (`shared/lib/api-fetch.ts`)
Każdy Orval hook trafia tutaj:
1. Wstrzykuje `X-API-Key: <apiKey>` z Zustand store.
2. Buduje URL z `params` (query string).
3. Wywołuje `fetch()`.
4. **401 → `useAuthStore.getState().logout()`** + throw `'Sesja wygasła. Zaloguj się ponownie.'`.
5. Inne błędy: parsuje JSON `{ message }` lub fallback `'Błąd <status>'`.

### 4.5 Route guard (`__root.tsx`)
```tsx
const isPublicRoute = pathname === '/login' || pathname === '/register'
useEffect(() => {
  if (!isPublicRoute && !isAuthenticated) router.navigate({ to: '/login' })
}, [...])
if (!isPublicRoute && !isAuthenticated) return null  // hard redirect
```

Layout: `<Sidebar /> + <Topbar /> + <main><Outlet /></main>` opakowane w `<ErrorBoundary>`.

---

## 5. Routing — wszystkie istniejące routy

File-based routing TanStack Router. Auto-generowany `routeTree.gen.ts`.

| Path | Plik | Co robi |
|---|---|---|
| `/` | `routes/index.tsx` (7 linii) | Pusty placeholder — zwraca pusty `<div>`. Brak redirectu na `/overview`. |
| `/login` | `routes/login.tsx` (71) | Form klucza API |
| `/register` | `routes/register.tsx` (98) | Form rejestracji |
| `/overview` | `routes/overview.tsx` (97) | Dashboard home |
| `/usage` | `routes/usage/index.tsx` (92) | Tabela eventów + 3 stat-cards |
| `/usage/$eventId` | `routes/usage/$eventId.tsx` (44) | Szczegóły eventa |
| `/billing` | `routes/billing/index.tsx` (119) | Saldo + transakcje + quick top-up (10k/50k/100k) |
| `/billing/top-up` | `routes/billing/top-up.tsx` (54) | Form doładowania (custom kwota) |
| `/proxy/playground` | `routes/proxy/playground.tsx` (201) | Playground z SSE streamingiem |
| `/settings` | `routes/settings/index.tsx` (47) | Info o koncie (read-only) |
| `/settings/api-key` | `routes/settings/api-key.tsx` (63) | Pokaż / kopiuj / rotuj klucz |
| `/settings/webhooks` | `routes/settings/webhooks.tsx` (158) | CRUD webhooków + test |
| `/settings/alerts` | `routes/settings/alerts.tsx` (107) | CRUD reguł alertów |
| `/entitlements` | `routes/entitlements/index.tsx` (90) | Lista uprawnień + ręczny check |
| `/admin` | `routes/admin/index.tsx` (47) | 4 stat-cards (analytics) |
| `/admin/customers` | `routes/admin/customers.tsx` (53) | Lista klientów |
| `/admin/pricing` | `routes/admin/pricing.tsx` (49) | Tabela cennika (read-only — brak CRUD UI) |
| `/admin/entitlements` | `routes/admin/entitlements.tsx` (52) | Per-customer entitlements |
| `/admin/audit-logs` | `routes/admin/audit-logs.tsx` (49) | Audit log (read-only) |
| `/docs` | `routes/docs.tsx` (58) | Iframe Swaggera + masked klucz |

**Razem 21 plików routów, ok. 1500 linii**.

---

## 6. Shared

### 6.1 UI prymitywy (`shared/ui/` — 6 plików, ~240 linii)
Istniejące Shadcn-style komponenty:
- `Button.tsx` (55) — CVA z `variant` (default, outline, ghost, destructive) + `size`.
- `Card.tsx` (83) — `Card`, `CardHeader`, `CardTitle`, `CardContent`.
- `Input.tsx` (22) — proste opakowanie `<input>` z Tailwind.
- `Badge.tsx` (35) — CVA `variant` (default, secondary, destructive, outline).
- `Separator.tsx` (26) — Radix-based.
- `Skeleton.tsx` (17) — animowany placeholder.

⚠ **Brakujące prymitywy z planu** (zainstalowane Radix packages, ale komponenty nie napisane):
- Dialog (modale w webhooks/alerts są **inline `<div>` z fixed inset-0 + bg-black/50** — czyli ad-hoc, nie Shadcn).
- Select (używane raw `<select>`).
- Tabs, Switch, Tooltip, Progress, Scroll Area — nieużywane.
- Label — nieużywane (raw `<label>`).

### 6.2 Komponenty wyższego poziomu (`shared/components/` — 11 plików, ~870 linii)
- **`Sidebar.tsx`** (155) — kolapsowalny side menu, 9 linków (Przegląd, Użycie, Rozliczenia, Playground, Uprawnienia, Ustawienia, Webhooki, Alerty, Dokumentacja). Sekcja Admin pokazuje się **tylko jeśli** `customer.tier === 'pro' || 'enterprise'`. Z footerem (info o userze + Wyloguj).
- **`Topbar.tsx`** (27) — placeholder, tylko hamburger toggle (na mobile).
- **`DataTable.tsx`** (137) — wrapper na TanStack Table. Używany w `usage/`, `admin/audit-logs`, `admin/pricing`. Wspiera `onRowClick`.
- **`EmptyState.tsx`** (37) — `{ icon, title, description, action? }`.
- **`ErrorBoundary.tsx`** (57) — class-component error boundary.
- **`StreamingViewer.tsx`** (52) — typewriter effect, używany w playground.
- **`WebhookStatusBadge.tsx`** (52) — kropka + status (`delivered | failed | pending | disabled`).
- **`AlertRuleCard.tsx`** (77) — karta reguły alertu.
- **`EntitlementBadge.tsx`** (47) — badge dla `HARD | SOFT | NONE`.
- **`AccessCheckResult.tsx`** (57) — wynik `entitlements/check` (allowed/denied + reason).

### 6.3 Lib (`shared/lib/`)
- `api-fetch.ts` (45) — opisany w §4.4.
- `query-client.ts` (12) — fabryka QueryClient.

### 6.4 Stores (`shared/stores/`)
- `auth-store.ts` (28) — opisany w §4.1.

### 6.5 Utils + types
- `shared/utils/cn.ts` — `clsx + tailwind-merge`.
- `shared/utils/format.ts` — `formatCredits`, `formatDate`.
- `shared/types/api.ts` — chyba pusty / re-export.

### 6.6 `index.ts`
Barrel — eksport wszystkich `shared/*`.

---

## 7. Generowane API (`gen/api.ts` + `gen/api.schemas.ts`)

Orval generuje z backendowego `/docs-json` (Swagger). Nazewnictwo hooków: **`use<Tag><Method><Path>`**, np.:
- `useAuthControllerRegister`
- `useAuthControllerMe`
- `useAuthControllerRotateKey`
- `useBillingControllerGetBalance`
- `useBillingControllerGetTransactions`
- `useBillingControllerTopUp`
- `useBillingControllerGetPricing`
- `useUsageControllerEvents`
- `useUsageControllerStats`
- `useEntitlementsControllerList`
- `useEntitlementsControllerCheck`
- `useWebhooksControllerList/Create/Delete/Test`
- `useAlertsControllerList/Create/Delete`
- `useAdminControllerGetAnalytics/GetCustomers`
- `useAuditControllerGetLogs`

⚠ Generowanie wymaga uruchomionego backendu (`bun run dev` w `backend/`) na porcie 3000. Jeśli backend ma break w Swagger DTO → frontend nie wygeneruje typów.

⚠ **Dane zwracane przez Orval są typowane jako `unknown` w wielu miejscach** — wszystkie strony używają `data as any` i ręcznego destrukturyzowania. Zob. np. `overview.tsx:9` → `const balance = balanceQuery.data as any`. To ścieżka frontu wokół braku poprawnych Swagger DTO klas po stronie backendu.

---

## 8. Strony — co dokładnie robią

### 8.1 `/overview` (97 linii)
- Wywołuje `useBillingControllerGetBalance({ userId: '' })` (pusty `userId` — bo wallet jest na poziomie Customer w obecnym schema) i `useUsageControllerStats()`.
- Renderuje **4 stat-cards**: Saldo, Żądania (30 dni), Koszt (30 dni), Tokeny (30 dni).
- Dwa "wykresy" — placeholdery z napisem "Wykres wkrótce" lub "Brak danych". **Recharts nie podpięte.**

### 8.2 `/usage` (92)
- `useUsageControllerEvents()` + `useUsageControllerStats()`.
- 3 stat-cards (łączne żądania, tokeny, kredyty).
- Tabela 7 kolumn (typ, feature, model, wej., wyj., koszt, data), klik w wiersz → `/usage/$eventId`.
- Brak filtrów (planowane `DateRangePicker`, `UsageFilters` — nie istnieją).

### 8.3 `/billing` (119)
- Karta salda + 3 quick-buttons (`+10 000`, `+50 000`, `+100 000`) → `useBillingControllerTopUp` natychmiast (bez płatności).
- Tabela transakcji (`type, amount, description, date`).
- ⚠ Hardcode `userId: ''` w argumencie — wallet poziomu Customer.
- ⚠ Wczytywanie `transactions` z `data?.data` — pewnie struktura `{ data, total, page, limit }` z backendu.

### 8.4 `/billing/top-up` (54)
- Form custom kwoty (`<Input type="number">`, raw form), wywołuje `useBillingControllerTopUp`.
- Brak walidacji RHF/Zod. Brak integracji z paymentem — robi to samo co quick buttons w `/billing`.

### 8.5 `/proxy/playground` (201)
- Tabs Anthropic / OpenAI z `SAMPLE_REQUESTS` (predefiniowane JSON-y).
- Lewa kolumna: textarea z requestem (raw, nie editor).
- Prawa kolumna: `<StreamingViewer>` z odpowiedzią.
- **Streaming**: ręczne `fetch()` z czytaniem `body.getReader()`, parsowanie SSE `data: ` linii, ekstrakcja `delta.text` (Anthropic) lub `choices[0].delta.content` (OpenAI). Wyświetla progresywnie.
- ⚠ Bezpośredni fetch z `X-API-Key` header — pomija `customFetch`. Endpoint hardcoded `/v1/proxy/anthropic` i `/v1/proxy/openai` (BEZ `/messages` i `/chat/completions`!) — **prawdopodobnie bug** (backend ma `/v1/proxy/anthropic/messages`).

### 8.6 `/settings` (47), `/settings/api-key` (63)
- `/settings`: trzy pola read-only (nazwa, email, tier) z `useAuthControllerMe`.
- `/settings/api-key`: maskowany klucz (`om_live_X•••X•••X1234`), button Show/Hide, Copy, Rotate (z confirm dialogiem JS-owym `confirm()`). `useAuthControllerRotateKey` → po sukcesie nadpisuje `setAuth`.

### 8.7 `/settings/webhooks` (158)
- Lista webhooków z `useWebhooksControllerList`, każdy z `WebhookStatusBadge`.
- Inline modal "Nowy webhook" — `<Input>` URL + 4 checkboxy (`balance.low, usage.threshold, credits.burned, api_key.rotated`).
- Per-row buttons: Testuj (`useWebhooksControllerTest`), Usuń (`useWebhooksControllerDelete` z `confirm()`).
- ⚠ Brak edycji (tylko create + delete), brak history view (planowane `/webhooks/:id/deliveries`).

### 8.8 `/settings/alerts` (107)
- Lista z `AlertRuleCard`.
- Inline modal "Nowa reguła" — `<select>` dla type (BALANCE_LOW/USAGE_THRESHOLD/DAILY_LIMIT) i channel (email/webhook/both), `<input type="number">` dla threshold.
- Brak edycji (tylko create + delete).

### 8.9 `/entitlements` (90)
- Lista z `EntitlementBadge` + progress bar (`usedValue / limitValue`).
- "Sprawdź dostęp" form (Input + Button) → `useEntitlementsControllerCheck` → `AccessCheckResult`.
- Brak edycji (tylko view + check).

### 8.10 Admin
- `/admin` (47) — 4 stat-cards (totalCustomers, activeCustomers, totalRequests24h, revenue30d).
- `/admin/customers` (53) — DataTable klientów.
- `/admin/pricing` (49) — DataTable cennika (read-only).
- `/admin/entitlements` (52) — read-only lista per-customer.
- `/admin/audit-logs` (49) — DataTable z 4 kolumnami.

⚠ Wszystkie admin-only strony wciąż używają `X-API-Key` (klienta), nie `X-Admin-Key` — **prawdopodobnie 401 z backendu** dla normalnych klientów. `customFetch` nie wstrzykuje `X-Admin-Key`. Zauważ: Sidebar pokazuje admin tylko dla tier `pro|enterprise`, ale nawet ci klienci nie mają adminowych endpointów dostępnych ze swojego klucza.

### 8.11 `/docs` (58)
- Wyświetla maskowany klucz API + button Copy.
- `<iframe src="/docs">` (przez Vite proxy) wbija backendowy Swagger UI.

---

## 9. Konwencje używane / NIE używane

### Używane:
- ✅ TanStack Router file-based + `createFileRoute`.
- ✅ Tailwind v4 z `cn()`.
- ✅ Toast notifications (`sonner`).
- ✅ `lucide-react` ikony.
- ✅ `useState` + `useEffect`.

### Z planu, ale NIE używane:
- ❌ **React Hook Form + Zod** — wszystkie formy są raw `<form>` + `useState`. Plan zakładał `useForm<...>({ resolver: zodResolver })`.
- ❌ **Recharts** — placeholdery "Wykres wkrótce".
- ❌ **Feature-first folders** (`features/auth/`, `features/billing/`...) — folder `features/` **nie istnieje**. Cała logika strony jest inline w pliku route.
- ❌ **Radix Dialog** — modale są inline `<div className="fixed inset-0 bg-black/50">`.
- ❌ **Radix Select** — raw `<select>`.
- ❌ **Apply Loader pattern z TanStack Router** — brak `loader` per route, brak SSR prefetch (bo brak SSR).
- ❌ **One-component-per-file React.memo + displayName** — tylko `Sidebar` używa.

---

## 10. Znane bugi / dziwactwa

1. **`/` to pusty placeholder** — nie redirectuje na `/overview`. User po loginie idzie na `/overview` ręcznie z `navigate({ to: '/overview' })`.
2. **Login NIE ustawia `customer`** — tylko `apiKey`. Sidebar pokazuje "—" w polu nazwa/email aż do refresza i fetcha `/auth/me` (ale `/auth/me` jest wołany dopiero w `/settings` lub gdy strona go potrzebuje).
3. **Playground hardcoduje złe endpointy** — `/v1/proxy/anthropic` zamiast `/v1/proxy/anthropic/messages`. Backend zwróci 404.
4. **`balance.userId: ''`** — wszędzie hardcoded pusty string. Prawdopodobnie celowo (wallet poziomu Customer), ale brzydkie i wprowadza w błąd.
5. **`data as any` wszędzie** — Orval generuje `unknown`, frontend rzutuje na `any` i destrukturyzuje ręcznie. Brak typesafe response shapes.
6. **Admin endpointy bez `X-Admin-Key`** — `customFetch` zna tylko `X-API-Key`. Admin pages działają tylko jeśli backend akceptuje X-API-Key dla admin — co byłoby błędem bezpieczeństwa, więc pewnie 401-ują.
7. **Brak edycji** w webhooks, alerts, entitlements — tylko create + delete.
8. **`confirm()` JS-owy** zamiast Shadcn Dialog do potwierdzenia destrukcyjnych akcji (rotate key, delete webhook).
9. **Brak walidacji formularzy** — można wysłać `top-up { amount: 0 }` lub negatywną kwotę, nieprawidłowy URL webhooka itp.
10. **Brak loading states na route-poziomie** — używają per-query `isLoading` ze Skeletonami w komponencie. Brak top-level "loading bar" przy navigacji.
11. **Brak error states** — błąd 500 z backendu pokaże toast "Błąd 500" i puste pole. Strona nie pokaże przyczyny.
12. **Brak responsywności** w niektórych miejscach — modale są fixed-width `max-w-md`, na mobile wyleci poza viewport.
13. **Brak page titles / OG tags** — SPA bez ustawiania `document.title` na route change.

---

## 11. Stan vs PLAN.md (`frontend/PLAN.md`)

`PLAN.md` zakładał:
- **TanStack Start + Nitro + SSR** → ❌ Nie wdrożone, jest zwykły Vite SPA.
- **Feature-first folders** → ❌ Wszystko inline w `routes/`.
- **RHF + Zod** → ❌ Raw forms.
- **Recharts** → ❌ Placeholdery.
- **Wszystkie 21 routów** → ✅ Stworzone.
- **Wszystkie shared components** → ✅ Stworzone (10 komponentów).
- **Orval auto-generation** → ✅ Działa.
- **Polish UI** → ✅.

**Wniosek**: szkielet kompletny, wnętrze **częściowo zaślepione** (placeholdery wykresów, brak edycji, brak walidacji, brak SSR). Funkcjonalnie pokrywa 70% planowanych endpointów, ale jakość kodu daleka od konwencji w `CLAUDE.md`.

---

## 12. Co trzeba zmienić dla nowego flow (BYOK + Stripe + multi-app)

W skrócie: **całość auth, billing i sporo settings** musi się zmienić.

### 12.1 Auth — login/register
- `/login` raw form klucza → **email + hasło + JWT** (`useAuthControllerLogin`).
- `/register` email + nazwa → **email + nazwa + hasło**.
- `auth-store` → trzymać `accessToken` zamiast `apiKey`. Field `customer` → `account`.
- `customFetch` → `Authorization: Bearer <accessToken>` zamiast `X-API-Key`.

### 12.2 Provider Keys (NEW page)
- `/settings/provider-keys` — 3 sekcje (OpenAI/Anthropic/OpenRouter) z polem klucza, statusem `verifiedAt`, last4, akcje Save/Test/Delete.

### 12.3 Applications (NEW page)
- `/applications` — lista aplikacji + create.
- `/applications/:id` — szczegóły apki + lista gateway keys + create/revoke + per-app stats.

### 12.4 Settings/api-key → Applications/:id/keys
- Obecny `/settings/api-key` (jeden klucz Customer) **znika** — zastąpiony per-application keys CRUD.

### 12.5 Billing — Stripe
- `/billing` (obecnie quick-top-up) → **kompletnie nowa**:
  - Karta aktualnego planu + remaining tokens (sub + package).
  - Lista planów z `useBillingControllerGetPlans` (Public).
  - Lista pakietów.
  - Buttony "Subscribe" / "Buy package" → `useBillingControllerCreateCheckoutSession` → redirect na Stripe Checkout.
  - "Manage subscription" → `useBillingControllerCreatePortalSession` → redirect na Stripe Portal.
- `/billing/top-up` **znika** (zastąpione checkoutem).

### 12.6 Analytics (NEW page)
- `/analytics/overview`, `/analytics/by-application`, `/analytics/by-end-user`, `/analytics/by-provider`, `/analytics/by-model`, `/analytics/timeseries`.
- Tutaj **finalnie wpiąć Recharts** (timeseries + pie/bar charts).

### 12.7 Sidebar
- Nowe linki: Provider Keys, Applications (zastępuje Settings/api-key), Analytics.
- Usunięte: Settings/api-key, Entitlements (jeśli nie używane).

### 12.8 Streamline conventions
Przy okazji rewrite warto dotknąć:
- Wprowadzić **feature-first** (`features/auth/`, `features/applications/`, `features/billing/`).
- Wprowadzić **RHF + Zod** dla wszystkich formularzy.
- Stworzyć **Shadcn Dialog** zamiast inline `<div fixed inset-0>`.
- Stworzyć **Shadcn Select**.
- Naprawić **typowanie odpowiedzi** (Orval emit z proper DTO classes po backendzie).
- Naprawić **playground endpointy** (`/messages`, `/chat/completions`).
- Wpiąć **Recharts** do overview i analytics.

---

## 13. Lista plików (mapa)

```
apps/dashboard/
├── orval.config.ts                          # input: http://localhost:3000/docs-json
├── vite.config.ts                           # aliasy + proxy /v1, /docs
├── package.json                             # scripts: dev, build, generate:api, typecheck
├── env.d.ts
├── index.html
├── tsconfig.json
└── src/
    ├── main.tsx                             # bootstrap, QueryClient, Router, Toaster
    ├── routeTree.gen.ts                     # auto-generowany przez TanStack Router plugin
    ├── styles/app.css                       # Tailwind import
    ├── env.d.ts
    ├── gen/                                 # auto-generowany Orval
    │   ├── api.ts                           # hooki TanStack Query
    │   └── api.schemas.ts                   # typy
    ├── routes/                              # 21 plików, ~1500 linii
    │   ├── __root.tsx
    │   ├── index.tsx                        # ⚠ pusty placeholder
    │   ├── login.tsx, register.tsx
    │   ├── overview.tsx                     # 4 stat-cards + placeholder charts
    │   ├── docs.tsx                         # iframe Swagger
    │   ├── usage/index.tsx, $eventId.tsx
    │   ├── billing/index.tsx, top-up.tsx
    │   ├── proxy/playground.tsx             # SSE streaming
    │   ├── settings/index.tsx, api-key.tsx, webhooks.tsx, alerts.tsx
    │   ├── entitlements/index.tsx
    │   └── admin/index.tsx, customers.tsx, pricing.tsx, entitlements.tsx, audit-logs.tsx
    └── shared/
        ├── ui/                              # 6 prymitywów
        ├── components/                      # 10 komponentów wyższego poziomu
        ├── lib/api-fetch.ts, query-client.ts
        ├── stores/auth-store.ts
        ├── utils/cn.ts, format.ts
        ├── types/api.ts
        └── index.ts                         # barrel
```

**Łącznie ok. 2 550 linii TS/TSX** (bez `gen/`, bez `routeTree.gen.ts`).
