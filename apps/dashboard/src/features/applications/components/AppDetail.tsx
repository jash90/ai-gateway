import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  ChevronLeft,
  Pencil,
  ShoppingBag,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  Search,
  Coins,
} from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/Tabs'
import { ComingInSprintCard } from '@shared/components/ComingInSprintCard'
import { AnalyticsDashboard } from '@features/analytics'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useApplicationsControllerGetById,
  applicationsControllerDelete,
  applicationsControllerUpdate,
  getApplicationsControllerListQueryKey,
  getApplicationsControllerGetByIdQueryKey,
} from '@gen/api'
import {
  useApplicationWallet,
  useWalletTransactions,
  type WalletTransaction,
} from '@features/billing/hooks/useWallet'
import {
  useEndUsers,
  useGrantToEndUser,
  type EndUserListItem,
} from '@features/billing/hooks/useEndUsers'
import { BillingCheckoutDialog } from '@features/billing/components/BillingCheckoutDialog'
import { useAuthStore } from '@shared/stores/auth-store'
import { Input } from '@shared/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
import { AppForm } from './AppForm'
import { KeyList } from './KeyList'

interface AppDetailProps {
  applicationId: string
}

/**
 * /applications/:id detail view with three tabs:
 *   - Klucze: KeyList component (active CRUD)
 *   - Analityka: Sprint 3 placeholder
 *   - Ustawienia: edit name/description, toggle active, delete
 */
export const AppDetail = React.memo(function AppDetail({ applicationId }: AppDetailProps) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)

  const query = useApplicationsControllerGetById(applicationId)
  const app = query.data

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      applicationsControllerUpdate(applicationId, { isActive }),
    onSuccess: (_data, isActive) => {
      toast.success(isActive ? 'Aplikacja włączona.' : 'Aplikacja wyłączona.')
      void queryClient.invalidateQueries({
        queryKey: getApplicationsControllerGetByIdQueryKey(applicationId),
      })
      void queryClient.invalidateQueries({ queryKey: getApplicationsControllerListQueryKey() })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zmienić stanu aplikacji.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => applicationsControllerDelete(applicationId),
    onSuccess: () => {
      toast.success('Aplikacja usunięta.')
      void queryClient.invalidateQueries({ queryKey: getApplicationsControllerListQueryKey() })
      void navigate({ to: '/applications' })
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null
      if (apiErr?.errorCode === 'APPLICATION_HAS_USAGE') {
        toast.error(
          'Nie można usunąć — aplikacja ma zarejestrowane użycie. Wyłącz ją zamiast usuwać.',
        )
      } else {
        toast.error(apiErr?.message ?? 'Nie udało się usunąć aplikacji.')
      }
    },
  })

  const handleDelete = async () => {
    if (!app) return
    const ok = await confirm({
      title: `Usunąć aplikację „${app.name}"?`,
      description:
        'Wszystkie klucze API tej aplikacji zostaną automatycznie usunięte. ' +
        'Jeśli aplikacja ma zarejestrowane użycie, operacja zostanie zablokowana — wyłącz ją zamiast usuwać.',
      confirmLabel: 'Usuń aplikację',
      destructive: true,
    })
    if (ok) deleteMutation.mutate()
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!app) {
    return (
      <ComingInSprintCard
        pageTitle="Aplikacja nie znaleziona"
        sprintLabel=""
        description="Aplikacja o tym ID nie istnieje lub nie należy do Twojego konta."
        cta={{ label: 'Wróć do listy', href: '/applications' }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/applications"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Aplikacje
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">{app.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
              {app.description && <span>{app.description}</span>}
              {!app.isActive && <Badge variant="secondary">Wyłączona</Badge>}
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edytuj
          </Button>
        </div>
      </div>

      <Tabs defaultValue="keys" className="space-y-6">
        <TabsList>
          <TabsTrigger value="keys">Klucze</TabsTrigger>
          <TabsTrigger value="analytics">Analityka</TabsTrigger>
          <TabsTrigger value="billing">Płatności</TabsTrigger>
          <TabsTrigger value="end-users">Końcowi użytkownicy</TabsTrigger>
          <TabsTrigger value="settings">Ustawienia</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <KeyList applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsDashboard applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="billing">
          <ApplicationBillingTab applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="end-users">
          <EndUsersTab applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ogólne</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">Status</p>
                  <p className="text-sm text-neutral-500">
                    {app.isActive
                      ? 'Aplikacja jest aktywna i obsługuje requesty.'
                      : 'Aplikacja jest wyłączona — wszystkie klucze odrzucają requesty.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => toggleActiveMutation.mutate(!app.isActive)}
                  disabled={toggleActiveMutation.isPending}
                >
                  {app.isActive ? 'Wyłącz' : 'Włącz'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4 border-red-200">
            <CardHeader>
              <CardTitle className="text-base text-red-700">Strefa niebezpieczna</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">Usuń aplikację</p>
                  <p className="text-sm text-neutral-500">
                    Usuwa aplikację i wszystkie jej klucze. Nie można cofnąć.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Usuń
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AppForm open={editing} onOpenChange={setEditing} app={app} />
    </div>
  )
})
AppDetail.displayName = 'AppDetail'

// =============================================================================
// Per-application billing tab — balance + per-app history + checkout
// =============================================================================

const ApplicationBillingTab = React.memo(function ApplicationBillingTab({
  applicationId,
}: {
  applicationId: string
}) {
  const wallet = useApplicationWallet(applicationId)
  // applicationId is passed as a query param the backend already accepts.
  const transactions = useWalletTransactions({ limit: 20, applicationId })
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4" />
            Saldo aplikacji
          </CardTitle>
        </CardHeader>
        <CardContent>
          {wallet.isLoading || !wallet.data ? (
            <Skeleton className="h-12 w-48" />
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-3xl font-bold tabular-nums text-neutral-900">
                  {formatTokens(wallet.data.tokenBalance)}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  tokenów dostępnych dla tej aplikacji.
                  {' '}
                  Gateway próbuje najpierw to saldo, a w razie braków sięga po
                  wspólne saldo konta.
                </p>
                {BigInt(wallet.data.tokenBalance) === 0n && (
                  <p className="mt-3 inline-flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-800">
                    <Sparkles className="h-3 w-3" />
                    Doładuj saldo aplikacji albo kup pakiet wspólny w
                    Ustawienia → Płatności.
                  </p>
                )}
              </div>
              <Button onClick={() => setCheckoutOpen(true)}>
                <ShoppingBag className="mr-2 h-4 w-4" />
                Kup tokeny
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historia transakcji aplikacji</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (transactions.data?.transactions ?? []).length === 0 ? (
            <div className="p-10 text-center text-sm text-neutral-500">
              Brak transakcji powiązanych z tą aplikacją.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {transactions.data!.transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-6 py-3 text-sm"
                >
                  <TxBadge type={tx.type} />
                  <div>
                    <p className="text-neutral-900">{txDescription(tx)}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(tx.createdAt).toLocaleString('pl-PL')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-base font-semibold tabular-nums ${
                        BigInt(tx.amount) > 0n ? 'text-emerald-700' : 'text-neutral-900'
                      }`}
                    >
                      {BigInt(tx.amount) > 0n ? '+' : ''}
                      {formatTokens(tx.amount)}
                    </p>
                    <p className="text-xs text-neutral-500">
                      saldo: {formatTokens(tx.balanceAfter)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <BillingCheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        defaultApplicationId={applicationId}
      />
    </div>
  )
})

const TX_TYPE_LABELS: Record<
  WalletTransaction['type'],
  { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  TOPUP: { label: 'Doładowanie', variant: 'success' },
  SUBSCRIPTION_GRANT: { label: 'Subskrypcja (rollover)', variant: 'success' },
  SUBSCRIPTION_RESET: { label: 'Subskrypcja (reset)', variant: 'success' },
  ADJUST: { label: 'Korekta admina', variant: 'secondary' },
  HOLD: { label: 'Rezerwacja', variant: 'warning' },
  SETTLE: { label: 'Rozliczenie', variant: 'default' },
  REFUND: { label: 'Zwrot', variant: 'success' },
}

const TxBadge = React.memo(function TxBadge({ type }: { type: WalletTransaction['type'] }) {
  const config = TX_TYPE_LABELS[type]
  return <Badge variant={config.variant}>{config.label}</Badge>
})

function txDescription(tx: WalletTransaction): string {
  const meta = tx.metadata as Record<string, unknown> | null
  if (!meta) return tx.type
  if (typeof meta.reason === 'string') return meta.reason
  if (typeof meta.priceId === 'string') return 'Zakup pakietu'
  if (typeof meta.subscriptionId === 'string') return 'Odnowienie subskrypcji'
  if (typeof meta.model === 'string') return `${meta.model} (${meta.provider ?? 'gateway'})`
  return tx.type
}

function formatTokens(value: string): string {
  try {
    const sign = value.startsWith('-') ? '-' : ''
    const abs = BigInt(value < '0' || value.startsWith('-') ? value.slice(1) : value)
    if (abs >= 1_000_000n) return `${sign}${(Number(abs) / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
    if (abs >= 1_000n) return `${sign}${(Number(abs) / 1_000).toFixed(1).replace(/\.?0+$/, '')}k`
    return `${sign}${abs.toString()}`
  } catch {
    return value
  }
}

// =============================================================================
// End-users tab — lista końcowych użytkowników aplikacji + grant tokenów
// =============================================================================

const EndUsersTab = React.memo(function EndUsersTab({
  applicationId,
}: {
  applicationId: string
}) {
  const account = useAuthStore((s) => s.account)
  const isAdmin = account?.role === 'ADMIN'
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [grantTarget, setGrantTarget] = React.useState<EndUserListItem | null>(null)

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useEndUsers({
    applicationId,
    limit: 100,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  })
  const endUsers = query.data?.endUsers ?? []
  const total = query.data?.total ?? 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Końcowi użytkownicy aplikacji
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-neutral-600">
            Każdy końcowy user (identyfikowany przez <code className="font-mono text-xs">x-rcn-end-user</code>) ma własne saldo tokenów.
            Pojawia się tu po pierwszym wywołaniu AI z atrybucją.
          </p>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              placeholder="Szukaj po external ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : endUsers.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
              {debouncedSearch
                ? `Brak końcowych userów pasujących do "${debouncedSearch}".`
                : 'Brak końcowych userów. Pojawią się tu po pierwszym wywołaniu AI z headerem x-rcn-end-user.'}
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                {total} {total === 1 ? 'user' : 'userów'} w aplikacji
              </p>
              <div className="overflow-hidden rounded-md border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th className="px-3 py-2 font-medium">External ID</th>
                      <th className="px-3 py-2 text-right font-medium">Saldo</th>
                      <th className="px-3 py-2 text-right font-medium">Requesty</th>
                      <th className="px-3 py-2 text-right font-medium">Tokeny in/out</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Ostatni</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {endUsers.map((eu) => (
                      <tr key={eu.id} className="border-b border-neutral-100 last:border-b-0">
                        <td className="px-3 py-2">
                          <code className="font-mono text-xs">{eu.externalId}</code>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">
                          {formatTokens(eu.tokenBalance)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                          {eu.totalRequests}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-neutral-500">
                          {eu.totalInputTokens}/{eu.totalOutputTokens}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {eu.hasActiveSubscription && (
                              <Badge variant="success">Subskrypcja</Badge>
                            )}
                            {eu.hasStripeCustomer && (
                              <Badge variant="secondary">Stripe</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-500">
                          {eu.lastSeenAt ? formatDateTime(eu.lastSeenAt) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isAdmin && account ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setGrantTarget(eu)}
                              title="Dodaj tokeny"
                            >
                              <Coins className="mr-1 h-3 w-3" />
                              Grant
                            </Button>
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <GrantTokensDialog
        open={grantTarget !== null}
        onOpenChange={(open) => !open && setGrantTarget(null)}
        endUser={grantTarget}
        accountId={account?.id ?? ''}
      />
    </div>
  )
})

const GrantTokensDialog = React.memo(function GrantTokensDialog({
  open,
  onOpenChange,
  endUser,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  endUser: EndUserListItem | null
  accountId: string
}) {
  const grant = useGrantToEndUser()
  const [amount, setAmount] = React.useState('1000')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setAmount('1000')
      setReason('')
    }
  }, [open])

  if (!endUser) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d+$/.test(amount.trim()) || amount === '0') {
      toast.error('Podaj dodatnią liczbę tokenów.')
      return
    }
    if (!reason.trim()) {
      toast.error('Podaj powód grantu — trafia do audit logu.')
      return
    }
    try {
      await grant.mutateAsync({
        accountId,
        endUserId: endUser.id,
        amount: amount.trim(),
        reason: reason.trim(),
      })
      toast.success(`+${amount} tokenów dla ${endUser.externalId}.`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Operacja nie powiodła się.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant tokenów dla końcowego usera</DialogTitle>
          <DialogDescription>
            Dodaje wskazaną liczbę tokenów do walletu końcowego usera <code className="font-mono text-xs">{endUser.externalId}</code>.
            Operacja loguje się w audit + WalletTransaction (type=ADJUST).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-neutral-700">Liczba tokenów</label>
            <Input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
              required
              autoFocus
            />
            <p className="text-xs text-neutral-500">
              BigInt — wpisz liczbę całkowitą bez separatorów.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-neutral-700">Powód</label>
            <Input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="np. trial promo, korekta po incydencie"
              maxLength={280}
              required
            />
            <p className="text-xs text-neutral-500">
              Trafia do audit logu — zapisuj zwięźle ale informacyjnie.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={grant.isPending}>
              {grant.isPending ? 'Dodawanie…' : `Dodaj +${amount || '?'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})

function formatDateTime(value: string): string {
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString('pl-PL', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}
