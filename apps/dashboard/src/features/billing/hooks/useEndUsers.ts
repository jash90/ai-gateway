import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customFetch } from '@shared/lib/api-fetch'

/**
 * End-users (B2B2C) management — endpointy ekspozyowane przez
 * EndUserBillingController. Auth via JWT (panel) wymaga query
 * `?applicationId=<uuid>` żeby wskazać aplikację.
 */

export interface EndUserListItem {
  id: string
  externalId: string
  applicationId: string
  tokenBalance: string // BigInt as string
  hasStripeCustomer: boolean
  hasActiveSubscription: boolean
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  lastSeenAt: string | null
  createdAt: string
  metadata: unknown | null
}

export interface EndUserListResponse {
  endUsers: EndUserListItem[]
  total: number
}

interface ListParams {
  applicationId: string
  limit?: number
  search?: string
}

const LIST_KEY = (params: ListParams) =>
  ['admin', 'end-users', params.applicationId, params.limit ?? 50, params.search ?? ''] as const

export function useEndUsers(params: ListParams) {
  return useQuery<EndUserListResponse>({
    queryKey: LIST_KEY(params),
    queryFn: () => {
      const qs = new URLSearchParams({
        applicationId: params.applicationId,
        limit: String(params.limit ?? 50),
        ...(params.search ? { search: params.search } : {}),
      })
      return customFetch<EndUserListResponse>({
        method: 'GET',
        url: `/v1/end-users?${qs.toString()}`,
      })
    },
    enabled: !!params.applicationId,
  })
}

interface GrantInput {
  accountId: string
  endUserId: string
  amount: string // BigInt-compatible
  reason: string
}

export function useGrantToEndUser() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, GrantInput>({
    mutationFn: ({ accountId, endUserId, amount, reason }) =>
      customFetch({
        method: 'POST',
        url: `/v1/admin/accounts/${accountId}/wallet/grant`,
        data: { amount, reason, endUserId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'end-users'], exact: false })
    },
  })
}
