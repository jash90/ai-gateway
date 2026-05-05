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
   * Internal flag — set to true on the retry after a 401 → refresh cycle to
   * prevent infinite loops. Callers must NOT set this manually.
   */
  _isRetry?: boolean
}

/**
 * API client used by Orval-generated TanStack Query hooks.
 *
 * Behavior:
 *   - Attaches Authorization: Bearer <accessToken> when authenticated
 *   - Proactive refresh when access token expires within 60s
 *   - Reactive refresh on 401 (single retry, then logout)
 *   - In-flight refresh deduplication (refresh.ts module singleton)
 *   - Maps backend error codes to Polish UX copy
 */
export async function customFetch<TData>(
  options: CustomFetchOptions,
): Promise<TData> {
  // PROACTIVE refresh — refresh BEFORE sending if access token is about to expire.
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

  // REACTIVE refresh — 401 means our proactive check missed (clock drift,
  // server-side revocation, etc.). Try ONE refresh + retry.
  if (
    response.status === 401 &&
    !options._isRetry &&
    !options.url.endsWith('/v1/auth/refresh')
  ) {
    try {
      await refreshTokens()
      return customFetch<TData>({ ...options, _isRetry: true })
    } catch {
      throw new ApiError(
        401,
        'SESSION_EXPIRED',
        'Sesja wygasła. Zaloguj się ponownie.',
      )
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
    case 'INSUFFICIENT_TOKEN_BALANCE':
      return 'Brak tokenów. Doładuj saldo w Ustawieniach → Płatności.'
    case 'PROVIDER_INSUFFICIENT_FUNDS':
      return 'Twój klucz providera nie ma środków u dostawcy AI.'
    case 'MAX_TOKENS_REQUIRED_LOW_BALANCE':
      return 'Wymagane pole `max_tokens` przy niskim saldzie.'
    case 'STRIPE_NOT_CONFIGURED':
      return 'Operator nie skonfigurował jeszcze Stripe. Spróbuj później.'
    default:
      return null
  }
}
