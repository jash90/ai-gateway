# Diff: `customFetch` X-API-Key → JWT Bearer + refresh

> **Ticket:** FE-S1-004 (4h) — `customFetch` refactor: Bearer + proactive/reactive refresh.
> **Pliki:** `apps/dashboard/src/shared/lib/api-fetch.ts` + `apps/dashboard/src/shared/stores/auth-store.ts` + nowy `apps/dashboard/src/shared/lib/refresh.ts`.
> **Zależności:** wymaga `auth-store` po refaktorze (FE-S1-003) z `{ accessToken, expiresAt, refreshToken, refreshExpiresAt, account }`.

---

## Co się zmienia (high-level)

| Aspekt | Przed | Po |
|---|---|---|
| Header auth | `X-API-Key: <apiKey>` | `Authorization: Bearer <accessToken>` |
| Token lifecycle | Permanent w localStorage | Access 15min in-memory + Refresh 30d w localStorage |
| Expiry handling | None — czeka na 401 | Proactive refresh (60s before expiry) + reactive on 401 |
| Concurrent refreshes | N/A | Singleton in-flight `refreshPromise` (deduplikacja) |
| 401 handling | Logout + throw | Try refresh once, retry; double-401 → logout |
| Auto-redirect | None | `window.location.href = '/login'` po wyczyszczeniu store |

---

## Nowy plik: `shared/lib/refresh.ts`

Wydzielona logika rotacji tokena — żeby `api-fetch.ts` mógł być cienki, testowalny, bez cyklicznych zależności.

```ts
import { useAuthStore } from '@shared/stores/auth-store'

/**
 * Singleton in-flight refresh promise. Multiple parallel requests that hit
 * "expired access token" simultaneously should share ONE refresh round-trip,
 * not fan out to N. This is a module-level let on purpose.
 */
let refreshPromise: Promise<void> | null = null

/**
 * Threshold in ms below which we proactively refresh before sending a request.
 * 60 seconds of leeway covers slow networks and clock drift.
 */
const PROACTIVE_REFRESH_WINDOW_MS = 60_000

export function shouldProactivelyRefresh(): boolean {
  const { accessToken, expiresAt } = useAuthStore.getState()
  if (!accessToken || !expiresAt) return false
  return expiresAt - Date.now() < PROACTIVE_REFRESH_WINDOW_MS
}

/**
 * Perform a refresh round-trip. Deduplicates concurrent calls — if a refresh is
 * already in flight, the caller awaits the same promise. Returns void; check
 * the auth store after `await` to see the new tokens (or null on failure).
 *
 * On failure: clears the auth store and redirects to /login. Throws so callers
 * can stop their own pipeline.
 */
export async function refreshTokens(): Promise<void> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) {
      handleAuthFailure()
      throw new Error('REFRESH_TOKEN_MISSING')
    }

    try {
      const response = await fetch('/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!response.ok) {
        // 401 / 403 / 5xx — refresh is dead, force re-login
        handleAuthFailure()
        throw new Error(`REFRESH_FAILED_${response.status}`)
      }

      const data = (await response.json()) as {
        accessToken: string
        expiresAt: number // epoch ms
        refreshToken: string
        refreshExpiresAt: number // epoch ms
        account: {
          id: string
          email: string
          name: string | null
          role: 'USER' | 'ADMIN'
          emailVerified: boolean
        }
      }

      useAuthStore.getState().setTokens({
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        refreshToken: data.refreshToken,
        refreshExpiresAt: data.refreshExpiresAt,
      })
      useAuthStore.getState().setAccount(data.account)
    } finally {
      // Always clear so a subsequent refresh attempt can proceed.
      refreshPromise = null
    }
  })()

  return refreshPromise
}

function handleAuthFailure(): void {
  useAuthStore.getState().logout()
  // Hard navigate so all in-flight queries are cancelled and React tree resets.
  // TanStack Router's `useNavigate` would be cleaner, but we're outside a
  // component here. The trade-off: full page reload. Acceptable for logout.
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}
```

---

## Zmiana: `shared/lib/api-fetch.ts`

### Pełny replacement (nie patch — plik jest mały, czytelność > zwięzłość diffa)

```ts
import { useAuthStore } from '@shared/stores/auth-store'
import { refreshTokens, shouldProactivelyRefresh } from '@shared/lib/refresh'

export type ErrorWrapper<TError> = TError | { status: number; payload: string }

export type CustomFetchOptions = {
  method: string
  url: string
  params?: Record<string, unknown>
  data?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
  /**
   * Internal flag: set to true on the retry after a 401 → refresh cycle to
   * prevent infinite loops. Callers should NOT set this manually.
   */
  _isRetry?: boolean
}

/**
 * API client used by Orval-generated TanStack Query hooks. Handles:
 *   - JWT Bearer auth from useAuthStore
 *   - Proactive refresh (when access token expires within PROACTIVE_REFRESH_WINDOW_MS)
 *   - Reactive refresh (one retry on 401, then logout)
 *   - In-flight refresh deduplication (via refresh.ts module singleton)
 *   - Polish error messages mapped from backend error codes
 */
export async function customFetch<TData>(
  options: CustomFetchOptions,
): Promise<TData> {
  // PROACTIVE: refresh BEFORE sending if access token is about to expire.
  // Skip for the refresh endpoint itself to avoid recursion.
  if (
    !options._isRetry &&
    !options.url.endsWith('/v1/auth/refresh') &&
    shouldProactivelyRefresh()
  ) {
    await refreshTokens()
  }

  const { accessToken } = useAuthStore.getState()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const url = new URL(options.url, window.location.origin)
  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    })
  }

  const response = await fetch(url.toString(), {
    method: options.method,
    headers,
    body: options.data ? JSON.stringify(options.data) : undefined,
    signal: options.signal,
  })

  // REACTIVE: 401 means our proactive check missed (clock drift, server-side
  // revocation, etc.). Try ONE refresh + retry. Skip retry if this IS the retry,
  // or if the 401 came from /auth/refresh itself (already handled by refresh.ts).
  if (
    response.status === 401 &&
    !options._isRetry &&
    !options.url.endsWith('/v1/auth/refresh')
  ) {
    try {
      await refreshTokens()
      return customFetch<TData>({ ...options, _isRetry: true })
    } catch {
      // refreshTokens already cleared store + redirected. Surface a generic error
      // so any UI awaiting this promise can show a toast before unmount.
      throw new ApiError(401, 'SESSION_EXPIRED', 'Sesja wygasła. Zaloguj się ponownie.')
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const errorCode = body?.errorCode ?? body?.code ?? null
    const message =
      mapErrorCodeToPolish(errorCode) ??
      body?.message ??
      `Błąd ${response.status}`
    throw new ApiError(response.status, errorCode, message)
  }

  if (response.status === 204) return undefined as TData
  return response.json()
}

/**
 * Typed error so callers can distinguish HTTP errors from network errors and
 * inspect the backend errorCode without parsing strings.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Map stable backend error codes to Polish UX copy. Add entries as new codes
 * appear; falls through to the backend's `message` field when not recognized.
 *
 * Backend-side: codes are stable English strings (D-013 in skill decisions).
 * Frontend-side: localized here.
 */
function mapErrorCodeToPolish(code: string | null): string | null {
  if (!code) return null
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'Nieprawidłowy email lub hasło.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Konto nie zostało jeszcze zweryfikowane. Sprawdź skrzynkę email.'
    case 'EMAIL_ALREADY_REGISTERED':
      return 'Ten adres email jest już zarejestrowany.'
    case 'INVALID_OR_EXPIRED_TOKEN':
      return 'Link wygasł lub jest nieprawidłowy. Poproś o nowy.'
    case 'REFRESH_TOKEN_REUSED':
      return 'Wykryto ponowne użycie tokena. Wszystkie sesje zostały zakończone z powodów bezpieczeństwa.'
    case 'ACCOUNT_DELETED':
      return 'To konto zostało usunięte.'
    case 'RATE_LIMITED':
      return 'Zbyt wiele prób. Spróbuj ponownie za chwilę.'
    default:
      return null
  }
}
```

---

## Zmiany w `auth-store.ts` (FE-S1-003)

Pokazane oddzielnym ticketem (FE-S1-003), ale dla kompletności tu jest oczekiwany shape:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface Account {
  id: string
  email: string
  name: string | null
  role: 'USER' | 'ADMIN'
  emailVerified: boolean
}

interface Tokens {
  accessToken: string
  expiresAt: number // epoch ms
  refreshToken: string
  refreshExpiresAt: number // epoch ms
}

interface AuthState extends Partial<Tokens> {
  account: Account | null
  setTokens: (tokens: Tokens) => void
  setAccount: (account: Account | null) => void
  login: (payload: Tokens & { account: Account }) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: undefined,
      expiresAt: undefined,
      refreshToken: undefined,
      refreshExpiresAt: undefined,
      account: null,
      setTokens: (tokens) => set(tokens),
      setAccount: (account) => set({ account }),
      login: ({ account, ...tokens }) => set({ ...tokens, account }),
      logout: () =>
        set({
          accessToken: undefined,
          expiresAt: undefined,
          refreshToken: undefined,
          refreshExpiresAt: undefined,
          account: null,
        }),
      isAuthenticated: () => {
        const s = get()
        return !!s.refreshToken && !!s.refreshExpiresAt && s.refreshExpiresAt > Date.now()
      },
    }),
    {
      name: 'ai-gateway-auth',
      storage: createJSONStorage(() => localStorage),
      // SECURITY DECISION (D-003 / OQ-001 in skill):
      // We persist the refresh token and account in localStorage in MVP. The
      // access token is intentionally NOT persisted — it rehydrates via
      // /v1/auth/refresh on app start. This minimizes the steady-state localStorage
      // footprint without adding the operational complexity of HttpOnly cookies +
      // /auth-bff proxy. Reopen this decision if security review fails.
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        refreshExpiresAt: state.refreshExpiresAt,
        account: state.account,
      }),
    },
  ),
)
```

---

## Bootstrap: rehydrate access token na starcie aplikacji

Jako że access token nie jest persistowany, na starcie SPA musimy wymusić jeden refresh **zanim** TanStack Query odpali jakikolwiek `useQuery`. Bez tego pierwszy request po reload poleci bez `Authorization` header → 401 → reactive refresh i tak załatwi sprawę, ale to dwa round-tripy zamiast jednego.

**Plik:** `apps/dashboard/src/main.tsx` (lub `__root.tsx` loader)

```tsx
// In main.tsx, BEFORE rendering <App />:
import { useAuthStore } from '@shared/stores/auth-store'
import { refreshTokens } from '@shared/lib/refresh'

async function bootstrap() {
  // Wait for Zustand persist to hydrate from localStorage.
  await useAuthStore.persist.rehydrate()

  // If we have a valid refresh token, mint a fresh access token immediately.
  // This avoids the 1-extra-roundtrip cost on first load.
  const { refreshToken, refreshExpiresAt } = useAuthStore.getState()
  if (refreshToken && refreshExpiresAt && refreshExpiresAt > Date.now()) {
    try {
      await refreshTokens()
    } catch {
      // refreshTokens redirected to /login; nothing to do here.
    }
  }
}

bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
})
```

**Trade-off:** ~150ms opóźnienia w renderze ekranu zalogowanego usera (czekamy na `/auth/refresh`). Akceptowalne — bez tego pierwszy `useQuery` i tak by się 401-nął i refreshnął, więc realny wpływ na UX = ~0.

---

## Test plan (Vitest, do FE-S1-004)

```ts
// shared/lib/api-fetch.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { customFetch, ApiError } from './api-fetch'
import { useAuthStore } from '@shared/stores/auth-store'

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('customFetch', () => {
  it('attaches Bearer header when authenticated', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    useAuthStore.getState().setTokens({
      accessToken: 'access-1',
      expiresAt: Date.now() + 60_000_000, // far future
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 60_000_000,
    })

    await customFetch({ method: 'GET', url: '/v1/apps' })

    const init = fetchSpy.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer access-1')
  })

  it('proactively refreshes when access token expires within 60s', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          accessToken: 'access-2',
          expiresAt: Date.now() + 900_000,
          refreshToken: 'refresh-2',
          refreshExpiresAt: Date.now() + 30 * 86_400_000,
          account: { id: 'a', email: 'x@y.com', name: null, role: 'USER', emailVerified: true },
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    useAuthStore.getState().setTokens({
      accessToken: 'expiring-soon',
      expiresAt: Date.now() + 30_000, // 30s — within the 60s window
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 60_000_000,
    })

    await customFetch({ method: 'GET', url: '/v1/apps' })

    expect(fetchSpy.mock.calls[0]![0]).toBe('http://localhost/v1/auth/refresh')
    expect(fetchSpy.mock.calls[1]![0]).toContain('/v1/apps')
    expect(useAuthStore.getState().accessToken).toBe('access-2')
  })

  it('reactively refreshes on 401 then retries the original request', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          accessToken: 'access-2',
          expiresAt: Date.now() + 900_000,
          refreshToken: 'refresh-2',
          refreshExpiresAt: Date.now() + 30 * 86_400_000,
          account: { id: 'a', email: 'x@y.com', name: null, role: 'USER', emailVerified: true },
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    useAuthStore.getState().setTokens({
      accessToken: 'access-1',
      expiresAt: Date.now() + 60_000_000,
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 60_000_000,
    })

    const result = await customFetch<{ ok: boolean }>({ method: 'GET', url: '/v1/apps' })

    expect(result).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(3) // original 401 + refresh + retry
    expect(useAuthStore.getState().accessToken).toBe('access-2')
  })

  it('logs out and throws on double 401 (refresh itself fails)', async () => {
    const navSpy = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 401 })) // refresh fails

    useAuthStore.getState().setTokens({
      accessToken: 'access-1',
      expiresAt: Date.now() + 60_000_000,
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 60_000_000,
    })

    await expect(customFetch({ method: 'GET', url: '/v1/apps' })).rejects.toThrow(ApiError)

    expect(useAuthStore.getState().refreshToken).toBeUndefined()
    expect(navSpy).toHaveBeenCalled()
  })

  it('deduplicates concurrent refreshes', async () => {
    let refreshCallCount = 0
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCallCount++
        return Promise.resolve(new Response(JSON.stringify({
          accessToken: 'access-N',
          expiresAt: Date.now() + 900_000,
          refreshToken: 'refresh-N',
          refreshExpiresAt: Date.now() + 30 * 86_400_000,
          account: { id: 'a', email: 'x@y.com', name: null, role: 'USER', emailVerified: true },
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })

    useAuthStore.getState().setTokens({
      accessToken: 'expiring',
      expiresAt: Date.now() + 30_000, // within 60s window
      refreshToken: 'refresh-1',
      refreshExpiresAt: Date.now() + 60_000_000,
    })

    // 5 parallel requests — should result in 1 refresh, not 5.
    await Promise.all([
      customFetch({ method: 'GET', url: '/v1/apps' }),
      customFetch({ method: 'GET', url: '/v1/apps' }),
      customFetch({ method: 'GET', url: '/v1/apps' }),
      customFetch({ method: 'GET', url: '/v1/apps' }),
      customFetch({ method: 'GET', url: '/v1/apps' }),
    ])

    expect(refreshCallCount).toBe(1)
  })
})
```

---

## Co dropujemy z aktualnego kodu

```diff
- const { apiKey } = useAuthStore.getState()
- if (apiKey) {
-   headers['X-API-Key'] = apiKey
- }
```

```diff
- if (response.status === 401) {
-   useAuthStore.getState().logout()
-   throw new Error('Sesja wygasła. Zaloguj się ponownie.')
- }
```

Te dwa kawałki zastąpione opisaną wyżej logiką Bearer + dual-mode refresh.

---

## Acceptance criteria checklist (mirror z FE-S1-004)

- [ ] `Authorization: Bearer ${accessToken}` jeśli `accessToken` w store
- [ ] **Proaktywny refresh**: jeśli `expiresAt - now < 60_000ms` → najpierw `await refreshTokens()`
- [ ] **Reaktywny refresh**: na 401 → jednorazowy retry; drugi 401 → logout
- [ ] **Deduplikacja**: 5 równoległych requestów z expired access → 1 refresh + 5 retries (test pokrywa)
- [ ] `/auth/refresh` 401 → wyczyść store, redirect to `/login`
- [ ] `ApiError` typed z polami `status, errorCode, message` (zamiast string `Error`)
- [ ] Polish copy mapowany przez `mapErrorCodeToPolish`
- [ ] 0 wystąpień `X-API-Key` w `apps/dashboard/src/`
- [ ] 5 testów Vitest przechodzi

---

## Powiązane tickety (aktualizacja)

Po wdrożeniu tego diffa:
- **FE-S1-003** (auth-store) musi być **zrobione przed** — diff zakłada nowy shape store'a
- **FE-S1-009** (admin pages na unified customFetch) staje się trywialne (zero zmian — już używa nowego customFetch)
- **FE-S1-014** (Orval regen) może wymagać update'u typów `ErrorWrapper` żeby obsłużyć nowy `ApiError` shape z backendu
