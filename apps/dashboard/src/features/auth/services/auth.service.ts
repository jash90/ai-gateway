import { customFetch } from '@shared/lib/api-fetch'
import type { Account, Tokens } from '@shared/stores/auth-store'

/**
 * Auth service — thin wrappers around customFetch that mirror the backend's
 * /v1/auth/* endpoints (Sprint 1, BE-S1-009 through BE-S1-014).
 *
 * Once the backend ships and `npm run generate:api` regenerates Orval hooks,
 * these wrappers can be replaced 1:1 with `useAuthControllerLogin`, etc.
 * Until then, this file IS the source of truth for the auth API contract on
 * the frontend.
 */

export interface LoginResponse extends Tokens {
  account: Account
}

export interface RegisterResponse {
  accountId: string
}

export async function login(payload: { email: string; password: string }) {
  return customFetch<LoginResponse>({
    method: 'POST',
    url: '/v1/auth/login',
    data: payload,
  })
}

export async function register(payload: {
  email: string
  password: string
  name?: string
}) {
  return customFetch<RegisterResponse>({
    method: 'POST',
    url: '/v1/auth/register',
    data: payload,
  })
}

export async function verifyEmail(token: string) {
  return customFetch<{ verified: true }>({
    method: 'POST',
    url: '/v1/auth/verify-email',
    data: { token },
  })
}

export async function forgotPassword(email: string) {
  return customFetch<void>({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    data: { email },
  })
}

export async function resetPassword(payload: {
  token: string
  newPassword: string
}) {
  return customFetch<void>({
    method: 'POST',
    url: '/v1/auth/reset-password',
    data: payload,
  })
}

export async function logout(refreshToken: string) {
  return customFetch<void>({
    method: 'POST',
    url: '/v1/auth/logout',
    data: { refreshToken },
  })
}
