import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { customFetch } from '@shared/lib/api-fetch'

export type BillingMode = 'PACKAGE' | 'SUBSCRIPTION'

export interface BillingPriceDto {
  id: string
  stripePriceId: string
  currency: string
  unitAmount: number // cents
  interval: string | null // "month" | "year" | null
  tokensGranted: string // BigInt as string
  isActive: boolean
  metadata: unknown | null
  createdAt: string
}

export interface BillingProductDto {
  id: string
  stripeProductId: string
  name: string
  description: string | null
  mode: BillingMode
  isActive: boolean
  createdAt: string
  prices: BillingPriceDto[]
}

const QUERY_KEY = ['admin', 'billing', 'products'] as const

export function useProducts() {
  return useQuery<{ products: BillingProductDto[] }>({
    queryKey: QUERY_KEY,
    queryFn: () =>
      customFetch<{ products: BillingProductDto[] }>({
        method: 'GET',
        url: '/v1/admin/billing/products',
      }),
  })
}

interface CreateProductInput {
  name: string
  description?: string | null
  mode: BillingMode
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation<BillingProductDto, Error, CreateProductInput>({
    mutationFn: (input) =>
      customFetch<BillingProductDto>({
        method: 'POST',
        url: '/v1/admin/billing/products',
        data: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

interface UpdateProductInput {
  id: string
  name?: string
  description?: string | null
  isActive?: boolean
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation<BillingProductDto, Error, UpdateProductInput>({
    mutationFn: ({ id, ...rest }) =>
      customFetch<BillingProductDto>({
        method: 'PATCH',
        url: `/v1/admin/billing/products/${id}`,
        data: rest,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

interface CreatePriceInput {
  productId: string
  unitAmount: number
  currency?: string
  interval?: 'month' | 'year' | null
  tokensGranted: string
  metadata?: Record<string, unknown>
}

export function useCreatePrice() {
  const queryClient = useQueryClient()
  return useMutation<BillingPriceDto, Error, CreatePriceInput>({
    mutationFn: (input) =>
      customFetch<BillingPriceDto>({
        method: 'POST',
        url: '/v1/admin/billing/prices',
        data: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useDeactivatePrice() {
  const queryClient = useQueryClient()
  return useMutation<{ id: string; isActive: boolean }, Error, string>({
    mutationFn: (id) =>
      customFetch<{ id: string; isActive: boolean }>({
        method: 'DELETE',
        url: `/v1/admin/billing/prices/${id}`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}
