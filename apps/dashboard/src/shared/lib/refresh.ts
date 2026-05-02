import { useAuthStore } from '@shared/stores/auth-store'

/**
 * Singleton in-flight refresh promise. Multiple parallel requests that hit
 * "expired access token" simultaneously share ONE refresh round-trip, not N.
 * Module-level on purpose.
 */
let refreshPromise: Promise<void> | null = null

/** Refresh proactively this many ms before the access token expires. */
const PROACTIVE_REFRESH_WINDOW_MS = 60_000

export function shouldProactivelyRefresh(): boolean {
  const { accessToken, expiresAt } = useAuthStore.getState()
  if (!accessToken || !expiresAt) return false
  return expiresAt - Date.now() < PROACTIVE_REFRESH_WINDOW_MS
}

/**
 * Perform a refresh round-trip. Deduplicates concurrent calls — if a refresh
 * is already in flight, the caller awaits the same promise.
 *
 * On failure: clears the auth store and redirects to /login. Re-throws so
 * callers can stop their own pipeline.
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
        // 401/403/5xx — refresh is dead, force re-login.
        handleAuthFailure()
        throw new Error(`REFRESH_FAILED_${response.status}`)
      }

      const data = (await response.json()) as {
        accessToken: string
        expiresAt: number
        refreshToken: string
        refreshExpiresAt: number
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
      refreshPromise = null
    }
  })()

  return refreshPromise
}

function handleAuthFailure(): void {
  useAuthStore.getState().logout()
  // Hard navigate so all in-flight queries are cancelled and React tree resets.
  // TanStack Router's `useNavigate` would be cleaner, but we're outside a
  // component here. Trade-off: full page reload. Acceptable for logout.
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}
