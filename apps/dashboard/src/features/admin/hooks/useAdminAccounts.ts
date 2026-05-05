import { useMutation, useQueryClient } from '@tanstack/react-query'
import { customFetch } from '@shared/lib/api-fetch'
import { getAdminControllerListAccountsQueryKey } from '@gen/api'

/**
 * Admin user CRUD — endpointy pojawiły się po Orvalu, więc piszemy hooki
 * ręcznie (jak inne post-Orval features). Po sukcesie unieważniamy listę
 * kont, żeby tabela odświeżyła się sama.
 */

export interface AdminAccountSummary {
  id: string
  email: string
  name: string | null
  role: 'USER' | 'ADMIN'
  emailVerified: boolean
  isActive: boolean
  // Orval emits date fields as `unknown` (Zod date coerce). We mirror that
  // shape so this type is interchangeable with `useAdminControllerListAccounts`
  // results without casts.
  deletedAt: unknown
  createdAt: unknown
  applicationsCount: number
  activeKeysCount: number
  providerKeysCount: number
  usageEventsCount: number
  totalCostUsdLast30d: number
}

export interface CreateAccountInput {
  email: string
  password: string
  name?: string | null
  role?: 'USER' | 'ADMIN'
  emailVerified?: boolean
}

export interface UpdateAccountInput {
  name?: string | null
  role?: 'USER' | 'ADMIN'
  isActive?: boolean
  emailVerified?: boolean
  newPassword?: string
}

function invalidateAccountsList(queryClient: ReturnType<typeof useQueryClient>) {
  // The Orval-generated key uses the params object as the second segment.
  // Invalidate everything starting with the base list key so all filter
  // permutations refetch.
  void queryClient.invalidateQueries({
    queryKey: getAdminControllerListAccountsQueryKey(),
    exact: false,
  })
}

export function useCreateAdminAccount() {
  const queryClient = useQueryClient()
  return useMutation<{ account: AdminAccountSummary }, Error, CreateAccountInput>({
    mutationFn: (input) =>
      customFetch<{ account: AdminAccountSummary }>({
        method: 'POST',
        url: '/v1/admin/accounts',
        data: input,
      }),
    onSuccess: () => invalidateAccountsList(queryClient),
  })
}

export function useUpdateAdminAccount() {
  const queryClient = useQueryClient()
  return useMutation<
    { account: AdminAccountSummary },
    Error,
    { id: string; input: UpdateAccountInput }
  >({
    mutationFn: ({ id, input }) =>
      customFetch<{ account: AdminAccountSummary }>({
        method: 'PATCH',
        url: `/v1/admin/accounts/${id}`,
        data: input,
      }),
    onSuccess: () => invalidateAccountsList(queryClient),
  })
}

export function useDeleteAdminAccount() {
  const queryClient = useQueryClient()
  return useMutation<{ account: AdminAccountSummary }, Error, string>({
    mutationFn: (id) =>
      customFetch<{ account: AdminAccountSummary }>({
        method: 'DELETE',
        url: `/v1/admin/accounts/${id}`,
      }),
    onSuccess: () => invalidateAccountsList(queryClient),
  })
}
