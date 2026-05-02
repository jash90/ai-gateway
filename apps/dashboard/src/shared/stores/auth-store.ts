import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface Account {
  id: string
  email: string
  name: string | null
  role: 'USER' | 'ADMIN'
  emailVerified: boolean
}

export interface Tokens {
  /** JWT access token. NOT persisted — rehydrated via /v1/auth/refresh on app start. */
  accessToken: string
  /** Epoch ms when accessToken expires. */
  expiresAt: number
  /** Opaque refresh token. Persisted in localStorage (D-003 / OQ-001). */
  refreshToken: string
  /** Epoch ms when refreshToken expires. */
  refreshExpiresAt: number
}

interface AuthState extends Partial<Tokens> {
  account: Account | null

  /** Set both tokens together — used by login, register-then-login, and refresh. */
  setTokens: (tokens: Tokens) => void
  /** Update account info (e.g. after PATCH /me). */
  setAccount: (account: Account | null) => void
  /** One-shot login from /v1/auth/login response. */
  login: (payload: Tokens & { account: Account }) => void
  /** Wipe everything — logout, expired refresh, soft-deleted account. */
  logout: () => void

  /**
   * True iff we have a refresh token that hasn't expired. Access token may be
   * absent (rehydrating) — that's fine, customFetch will mint one on demand.
   */
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
        return (
          !!s.refreshToken &&
          !!s.refreshExpiresAt &&
          s.refreshExpiresAt > Date.now()
        )
      },
    }),
    {
      name: 'ai-gateway-auth',
      storage: createJSONStorage(() => localStorage),
      // SECURITY DECISION (D-003 / OQ-001 in skill):
      // Persist only refreshToken + refreshExpiresAt + account. Access token
      // is NOT persisted — it rehydrates via /v1/auth/refresh on app start in
      // main.tsx bootstrap. This minimizes the localStorage footprint without
      // adding the operational complexity of HttpOnly cookies + /auth-bff.
      // Reopen this decision if a security review fails.
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        refreshExpiresAt: state.refreshExpiresAt,
        account: state.account,
      }),
    },
  ),
)
