import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customFetch } from '@shared/lib/api-fetch'
import type { BillingProductDto } from './useProducts'

// =============================================================================
// Subscription types (mirror backend SubscriptionResponseDto + summary)
// =============================================================================

export type SubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'TRIALING'
  | 'UNPAID'
  | 'PAUSED'

export interface SubscriptionDto {
  id: string
  status: SubscriptionStatus
  productName: string
  priceId: string
  unitAmount: number
  currency: string
  interval: string | null
  tokensGranted: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
}

export type CheckoutScope = 'SHARED_ACCOUNT' | 'PER_APPLICATION'

export interface ApplicationWalletSummary {
  id: string
  name: string
  tokenBalance: string
}

export interface BillingPreferences {
  defaultPackageScope: CheckoutScope
  defaultSubscriptionScope: CheckoutScope
  refundOnError: boolean
}

export interface BillingSummaryDto {
  balance: { tokens: string; refundOnError: boolean }
  applications: ApplicationWalletSummary[]
  totalAvailable: string
  preferences: {
    defaultPackageScope: CheckoutScope
    defaultSubscriptionScope: CheckoutScope
  }
  subscription: SubscriptionDto | null
  ready: boolean
  catalog: BillingProductDto[]
}

export interface CombinedWalletsDto {
  sharedBalance: string
  refundOnError: boolean
  applications: ApplicationWalletSummary[]
  totalAvailable: string
}

export interface WalletBalance {
  tokenBalance: string // BigInt as string
  refundOnError: boolean
}

export interface WalletTransaction {
  id: string
  type:
    | 'HOLD'
    | 'SETTLE'
    | 'REFUND'
    | 'TOPUP'
    | 'SUBSCRIPTION_GRANT'
    | 'SUBSCRIPTION_RESET'
    | 'ADJUST'
  amount: string
  balanceAfter: string
  requestId: string | null
  stripeEventId: string | null
  /** When set, this transaction touched a specific application's wallet. Null = shared account wallet. */
  applicationId: string | null
  metadata: unknown | null
  createdAt: string
}

const BALANCE_KEY = ['wallet', 'balance'] as const
const TRANSACTIONS_KEY = ['wallet', 'transactions'] as const
const CATALOG_KEY = ['billing', 'catalog'] as const

export function useWalletBalance() {
  return useQuery<WalletBalance>({
    queryKey: BALANCE_KEY,
    queryFn: () =>
      customFetch<WalletBalance>({
        method: 'GET',
        url: '/v1/wallet',
      }),
    staleTime: 10_000,
  })
}

export function useWalletTransactions(
  opts: {
    limit?: number
    type?: WalletTransaction['type']
    /** When set, server filters transactions to that application (or "null" for shared-only). */
    applicationId?: string
  } = {},
) {
  const params: Record<string, unknown> = {}
  if (opts.limit) params.limit = opts.limit
  if (opts.type) params.type = opts.type
  if (opts.applicationId) params.applicationId = opts.applicationId
  return useQuery<{ transactions: WalletTransaction[]; total: number }>({
    queryKey: [...TRANSACTIONS_KEY, params] as const,
    queryFn: () =>
      customFetch<{ transactions: WalletTransaction[]; total: number }>({
        method: 'GET',
        url: '/v1/wallet/transactions',
        params,
      }),
  })
}

export function useCatalog() {
  return useQuery<{ products: BillingProductDto[] }>({
    queryKey: CATALOG_KEY,
    queryFn: () =>
      customFetch<{ products: BillingProductDto[] }>({
        method: 'GET',
        url: '/v1/billing/catalog',
      }),
  })
}

interface CheckoutInput {
  priceId: string
  successUrl?: string
  cancelUrl?: string
  scope?: CheckoutScope
  applicationId?: string
}

export function useCheckout() {
  const queryClient = useQueryClient()
  return useMutation<{ url: string; sessionId: string }, Error, CheckoutInput>({
    mutationFn: (input) =>
      customFetch<{ url: string; sessionId: string }>({
        method: 'POST',
        url: '/v1/billing/checkout',
        data: input,
      }),
    onSuccess: () => {
      // Invalidate balance — webhook will land before user returns from Stripe.
      void queryClient.invalidateQueries({ queryKey: BALANCE_KEY })
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
      void queryClient.invalidateQueries({ queryKey: WALLETS_KEY })
    },
  })
}

// =============================================================================
// Combined wallets + per-application wallet
// =============================================================================

const WALLETS_KEY = ['billing', 'wallets'] as const
const APP_WALLET_KEY = (id: string) => ['billing', 'applications', id, 'wallet'] as const

/** Combined view: shared balance + per-application balances. */
export function useWallets() {
  return useQuery<CombinedWalletsDto>({
    queryKey: WALLETS_KEY,
    queryFn: () =>
      customFetch<CombinedWalletsDto>({
        method: 'GET',
        url: '/v1/billing/wallets',
      }),
    staleTime: 10_000,
  })
}

export function useApplicationWallet(applicationId: string | undefined) {
  return useQuery<{ applicationId: string; tokenBalance: string }>({
    queryKey: applicationId ? APP_WALLET_KEY(applicationId) : ['billing', 'applications', '__none__', 'wallet'],
    queryFn: () =>
      customFetch<{ applicationId: string; tokenBalance: string }>({
        method: 'GET',
        url: `/v1/billing/applications/${applicationId}/wallet`,
      }),
    enabled: !!applicationId,
    staleTime: 10_000,
  })
}

// =============================================================================
// Preferences (default scopes + refundOnError)
// =============================================================================

const PREFERENCES_KEY = ['billing', 'preferences'] as const

export function usePreferences() {
  return useQuery<BillingPreferences>({
    queryKey: PREFERENCES_KEY,
    queryFn: () =>
      customFetch<BillingPreferences>({
        method: 'GET',
        url: '/v1/billing/preferences',
      }),
    staleTime: 60_000,
  })
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation<BillingPreferences, Error, Partial<BillingPreferences>>({
    mutationFn: (input) =>
      customFetch<BillingPreferences>({
        method: 'PATCH',
        url: '/v1/billing/preferences',
        data: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY })
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

// =============================================================================
// Subscription
// =============================================================================

const SUBSCRIPTION_KEY = ['billing', 'subscription'] as const
const SUMMARY_KEY = ['billing', 'me'] as const

export function useSubscription() {
  return useQuery<{ subscription: SubscriptionDto | null }>({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: () =>
      customFetch<{ subscription: SubscriptionDto | null }>({
        method: 'GET',
        url: '/v1/billing/subscription',
      }),
    staleTime: 30_000,
  })
}

/**
 * Unified billing summary — one call returns balance + subscription + catalog.
 * Use this from integrating client apps to render a billing screen.
 */
export function useBillingSummary() {
  return useQuery<BillingSummaryDto>({
    queryKey: SUMMARY_KEY,
    queryFn: () =>
      customFetch<BillingSummaryDto>({
        method: 'GET',
        url: '/v1/billing/me',
      }),
    staleTime: 10_000,
  })
}

export function useCancelSubscription() {
  const queryClient = useQueryClient()
  return useMutation<{ subscription: SubscriptionDto }, Error, string>({
    mutationFn: (subscriptionId) =>
      customFetch<{ subscription: SubscriptionDto }>({
        method: 'POST',
        url: `/v1/billing/subscription/${subscriptionId}/cancel`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEY })
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}
