import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customFetch } from '@shared/lib/api-fetch'

export interface StripeConfigPublic {
  isActive: boolean
  hasSecretKey: boolean
  hasWebhookSecret: boolean
  publishableKey: string | null
  mode: 'test' | 'live'
  lastWebhookAt: string | null
  lastWebhookEvent: string | null
  webhookUrl: string
  requiredEvents: string[]
}

export interface UpsertStripeConfigInput {
  publishableKey?: string | null
  secretKey?: string | null
  webhookSecret?: string | null
  mode?: 'test' | 'live'
}

const QUERY_KEY = ['admin', 'billing', 'stripe-config'] as const

export function useStripeConfig() {
  return useQuery<StripeConfigPublic>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      customFetch<StripeConfigPublic>({
        method: 'GET',
        url: '/v1/admin/billing/config',
      }),
    refetchInterval: 30_000, // poll for live webhook status
  })
}

export function useUpsertStripeConfig() {
  const queryClient = useQueryClient()
  return useMutation<StripeConfigPublic, Error, UpsertStripeConfigInput>({
    mutationFn: (input) =>
      customFetch<StripeConfigPublic>({
        method: 'PATCH',
        url: '/v1/admin/billing/config',
        data: input,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data)
    },
  })
}
