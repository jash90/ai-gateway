import * as React from 'react'
import { toast } from 'sonner'
import { Search, Users, Filter, Plus, Pencil, KeyRound, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { Button } from '@shared/ui/Button'
import { Input } from '@shared/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import { EmptyState } from '@shared/components/EmptyState'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { useAuthStore } from '@shared/stores/auth-store'
import { useAdminControllerListAccounts } from '@gen/api'
import { formatInt, formatUsd } from '@features/analytics/utils/format'
import {
  useDeleteAdminAccount,
  useUpdateAdminAccount,
  type AdminAccountSummary,
} from '../hooks/useAdminAccounts'
import { AccountFormDialog } from './AccountFormDialog'

type RoleFilter = 'all' | 'USER' | 'ADMIN'

type DialogMode =
  | { kind: 'create' }
  | { kind: 'edit'; account: AdminAccountSummary }
  | { kind: 'reset-password'; account: AdminAccountSummary }
  | null

export const AccountsList = React.memo(function AccountsList() {
  const currentAccount = useAuthStore((s) => s.account)
  const confirm = useConfirm()
  const updateMutation = useUpdateAdminAccount()
  const deleteMutation = useDeleteAdminAccount()

  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [role, setRole] = React.useState<RoleFilter>('all')
  const [includeDeleted, setIncludeDeleted] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<DialogMode>(null)

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useAdminControllerListAccounts({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(role !== 'all' ? { role } : {}),
    ...(includeDeleted ? { includeDeleted: 'true' as const } : {}),
  })

  const accounts = query.data?.accounts ?? []
  const total = query.data?.total ?? 0

  const handleSuspendToggle = async (acc: AdminAccountSummary) => {
    try {
      await updateMutation.mutateAsync({
        id: acc.id,
        input: { isActive: !acc.isActive },
      })
      toast.success(acc.isActive ? 'Konto wyłączone.' : 'Konto przywrócone.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Operacja nie powiodła się.')
    }
  }

  const handleDelete = async (acc: AdminAccountSummary) => {
    const ok = await confirm({
      title: `Usunąć konto „${acc.email}"?`,
      description:
        'Soft-delete: e-mail zostanie zmieniony, refresh tokeny i klucze API revoke\'owane. ' +
        'Historia użycia + audit log zostają. Operacji nie można cofnąć z UI.',
      confirmLabel: 'Usuń konto',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteMutation.mutateAsync(acc.id)
      toast.success('Konto usunięte (soft-delete).')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Operacja nie powiodła się.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Konta klientów</h1>
          <p className="text-sm text-neutral-500">
            Multi-tenant view — wszystkie konta w systemie. Wyłącznie dla administratorów.
          </p>
        </div>
        <Button onClick={() => setDialogMode({ kind: 'create' })}>
          <Plus className="mr-1 h-4 w-4" />
          Nowe konto
        </Button>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            placeholder="Szukaj po email lub imieniu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={role} onValueChange={(v) => setRole(v as RoleFilter)}>
            <SelectTrigger className="h-10 w-32">
              <Filter className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie role</SelectItem>
              <SelectItem value="USER">Użytkownik</SelectItem>
              <SelectItem value="ADMIN">Admin</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            <span className="text-neutral-700">Pokaż usunięte</span>
          </label>
        </div>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12 text-neutral-400" />}
          title={debouncedSearch ? 'Brak wyników' : 'Brak kont w systemie'}
          description={
            debouncedSearch
              ? `Żadne konto nie pasuje do zapytania "${debouncedSearch}".`
              : 'Konta klientów pojawią się tutaj po pierwszej rejestracji.'
          }
        />
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {formatInt(total)} {total === 1 ? 'konto' : 'kont'}
          </p>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Imię</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Apki</th>
                    <th className="px-4 py-3 text-right font-medium">Klucze</th>
                    <th className="px-4 py-3 text-right font-medium">Eventy</th>
                    <th className="px-4 py-3 text-right font-medium">Koszt 30d</th>
                    <th className="px-4 py-3 font-medium">Utworzone</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => {
                    const isDeleted = !!acc.deletedAt
                    const isSelf = acc.id === currentAccount?.id
                    return (
                      <tr key={acc.id} className="border-b border-neutral-100 last:border-b-0">
                        <td className="px-4 py-3">
                          <code className="font-mono text-xs">{acc.email}</code>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">{acc.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <AccountStatus account={acc} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                          {acc.applicationsCount}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                          {acc.activeKeysCount}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                          {formatInt(acc.usageEventsCount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                          {acc.totalCostUsdLast30d > 0
                            ? formatUsd(acc.totalCostUsdLast30d, true)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">
                          {formatDate(acc.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {isDeleted ? (
                            <span className="text-xs text-neutral-400">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edytuj"
                                onClick={() => setDialogMode({ kind: 'edit', account: acc })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Resetuj hasło"
                                onClick={() =>
                                  setDialogMode({ kind: 'reset-password', account: acc })
                                }
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={acc.isActive ? 'Wyłącz' : 'Aktywuj'}
                                onClick={() => handleSuspendToggle(acc)}
                                disabled={updateMutation.isPending || isSelf}
                              >
                                {acc.isActive ? (
                                  <span className="text-xs text-amber-700">Wyłącz</span>
                                ) : (
                                  <span className="text-xs text-emerald-700">Aktywuj</span>
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={isSelf ? 'Nie możesz usunąć siebie' : 'Usuń konto'}
                                onClick={() => handleDelete(acc)}
                                disabled={deleteMutation.isPending || isSelf}
                                className="text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      <AccountFormDialog
        open={dialogMode !== null}
        onOpenChange={(open) => !open && setDialogMode(null)}
        mode={dialogMode}
      />
    </div>
  )
})
AccountsList.displayName = 'AccountsList'

const AccountStatus = React.memo(function AccountStatus({
  account,
}: {
  account: {
    role: string
    isActive: boolean
    deletedAt: unknown
    emailVerified: boolean
  }
}) {
  if (account.deletedAt) {
    return (
      <Badge variant="secondary" className="bg-red-50 text-red-700">
        Usunięte
      </Badge>
    )
  }
  if (!account.isActive) {
    return (
      <Badge variant="secondary" className="bg-neutral-100">
        Wyłączone
      </Badge>
    )
  }
  if (!account.emailVerified) {
    return (
      <Badge variant="secondary" className="bg-amber-50 text-amber-700">
        Niezweryfikowane
      </Badge>
    )
  }
  if (account.role === 'ADMIN') {
    return (
      <Badge variant="secondary" className="bg-violet-50 text-violet-700">
        Admin
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
      Aktywne
    </Badge>
  )
})
AccountStatus.displayName = 'AccountStatus'

function formatDate(value: unknown): string {
  if (!value) return '—'
  const d =
    typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pl-PL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
