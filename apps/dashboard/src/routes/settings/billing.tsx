import * as React from 'react'
import { createFileRoute, useSearch, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Wallet,
  ShoppingBag,
  Receipt,
  Sparkles,
  Repeat,
  Calendar,
  X,
  Layers,
  AppWindow,
  Settings,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'
import { Badge } from '@shared/ui/Badge'
import { Skeleton } from '@shared/ui/Skeleton'
import {
  useWalletTransactions,
  useSubscription,
  useCancelSubscription,
  useWallets,
  usePreferences,
  useUpdatePreferences,
  type WalletTransaction,
  type SubscriptionDto,
  type CheckoutScope,
} from '@features/billing/hooks/useWallet'
import { BillingCheckoutDialog } from '@features/billing/components/BillingCheckoutDialog'

const searchSchema = z.object({
  status: z.enum(['ok', 'canceled']).optional(),
})

const BillingSettingsPage = React.memo(function BillingSettingsPage() {
  const search = useSearch({ from: '/settings/billing' })
  const wallets = useWallets()
  const transactions = useWalletTransactions({ limit: 20 })
  const subscription = useSubscription()
  const preferences = usePreferences()
  const [checkoutOpen, setCheckoutOpen] = React.useState(false)

  // Show toast when returning from Stripe Checkout.
  React.useEffect(() => {
    if (search.status === 'ok') {
      toast.success('Płatność zaakceptowana. Tokeny zostaną dodane po potwierdzeniu od Stripe (kilka sekund).')
      void wallets.refetch()
      const t = setTimeout(() => {
        void wallets.refetch()
        void transactions.refetch()
      }, 3000)
      return () => clearTimeout(t)
    } else if (search.status === 'canceled') {
      toast.info('Płatność anulowana.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.status])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Płatności</h1>
          <p className="text-sm text-neutral-500">
            Saldo tokenów (wspólne + per aplikacja), historia transakcji, zakup pakietów i subskrypcji.
          </p>
        </div>
        <Button onClick={() => setCheckoutOpen(true)} size="lg">
          <ShoppingBag className="mr-2 h-4 w-4" />
          Kup tokeny
        </Button>
      </div>

      <WalletsCard data={wallets.data} isLoading={wallets.isLoading} />

      <PreferencesCard
        data={preferences.data}
        isLoading={preferences.isLoading}
      />

      {(subscription.isLoading || subscription.data?.subscription) && (
        <SubscriptionCard
          subscription={subscription.data?.subscription ?? null}
          isLoading={subscription.isLoading}
        />
      )}

      <TransactionsCard
        transactions={transactions.data?.transactions ?? []}
        isLoading={transactions.isLoading}
      />

      <BillingCheckoutDialog open={checkoutOpen} onOpenChange={setCheckoutOpen} />
    </div>
  )
})
BillingSettingsPage.displayName = 'BillingSettingsPage'

const WalletsCard = React.memo(function WalletsCard({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useWallets>['data']
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4" />
          Saldo tokenów
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                Łącznie dostępne
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-neutral-900">
                {formatTokens(data.totalAvailable)}
              </p>
              <p className="text-xs text-neutral-500">tokenów dostępnych do wykorzystania</p>
              {BigInt(data.totalAvailable) === 0n && (
                <p className="mt-3 inline-flex items-center gap-1 rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-800">
                  <Sparkles className="h-3 w-3" />
                  Doładuj saldo, aby zacząć korzystać z gateway
                </p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700">
                    <Layers className="h-3 w-3" />
                    Wspólne (account)
                  </p>
                  <Badge variant="secondary">SHARED_ACCOUNT</Badge>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                  {formatTokens(data.sharedBalance)}
                </p>
                <p className="text-[10px] text-neutral-500">
                  dostępne dla wszystkich aplikacji
                </p>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700">
                    <AppWindow className="h-3 w-3" />
                    Per aplikacja (suma)
                  </p>
                  <Badge variant="default">PER_APPLICATION</Badge>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                  {formatTokens(
                    data.applications
                      .reduce((sum, a) => sum + BigInt(a.tokenBalance), 0n)
                      .toString(),
                  )}
                </p>
                <p className="text-[10px] text-neutral-500">
                  zarezerwowane per aplikacja
                </p>
              </div>
            </div>

            {data.applications.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Aplikacje
                </p>
                <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
                  {data.applications.map((app) => (
                    <li
                      key={app.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <Link
                        to="/applications/$id"
                        params={{ id: app.id }}
                        className="inline-flex items-center gap-1 text-neutral-900 hover:underline"
                      >
                        <AppWindow className="h-3 w-3" />
                        {app.name}
                        <ArrowRight className="h-3 w-3 text-neutral-400" />
                      </Link>
                      <span className="text-sm font-semibold tabular-nums text-neutral-900">
                        {formatTokens(app.tokenBalance)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
})

const PreferencesCard = React.memo(function PreferencesCard({
  data,
  isLoading,
}: {
  data: ReturnType<typeof usePreferences>['data']
  isLoading: boolean
}) {
  const update = useUpdatePreferences()

  const handleChange = async (
    field: 'defaultPackageScope' | 'defaultSubscriptionScope',
    value: CheckoutScope,
  ) => {
    try {
      await update.mutateAsync({ [field]: value })
      toast.success('Zapisano preferencje.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się zapisać.')
    }
  }

  const handleRefundToggle = async (next: boolean) => {
    try {
      await update.mutateAsync({ refundOnError: next })
      toast.success('Zapisano preferencje.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się zapisać.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="h-4 w-4" />
          Domyślne ustawienia zakupu
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-neutral-500">
              Te ustawienia pre-wypełniają sekcję &quot;Gdzie trafią tokeny?&quot; w oknie
              zakupu. Możesz je zawsze nadpisać przy konkretnym zakupie.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <ScopeRow
                label="Pakiety (jednorazowe)"
                value={data.defaultPackageScope}
                onChange={(v) => handleChange('defaultPackageScope', v)}
                disabled={update.isPending}
              />
              <ScopeRow
                label="Subskrypcje"
                value={data.defaultSubscriptionScope}
                onChange={(v) => handleChange('defaultSubscriptionScope', v)}
                disabled={update.isPending}
              />
            </div>

            <div className="rounded-md border border-neutral-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    Zwrot tokenów przy błędach
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Jeśli włączone, tokeny są zwracane gdy provider zwróci błąd
                    (5xx). Wyłączone — tokeny są spalane.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRefundToggle(!data.refundOnError)}
                  disabled={update.isPending}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    data.refundOnError
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                  }`}
                >
                  {data.refundOnError ? 'Włączone' : 'Wyłączone'}
                </button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
})

const ScopeRow = React.memo(function ScopeRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: CheckoutScope
  onChange: (next: CheckoutScope) => void
  disabled: boolean
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <p className="text-sm font-medium text-neutral-900">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <ScopeChoice
          active={value === 'PER_APPLICATION'}
          onClick={() => onChange('PER_APPLICATION')}
          icon={<AppWindow className="h-3 w-3" />}
          title="Per aplikacja"
          subtitle="Jedna aplikacja"
          disabled={disabled}
        />
        <ScopeChoice
          active={value === 'SHARED_ACCOUNT'}
          onClick={() => onChange('SHARED_ACCOUNT')}
          icon={<Layers className="h-3 w-3" />}
          title="Wspólne"
          subtitle="Dla wszystkich"
          disabled={disabled}
        />
      </div>
    </div>
  )
})

const ScopeChoice = React.memo(function ScopeChoice({
  active,
  onClick,
  icon,
  title,
  subtitle,
  disabled,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <div className="flex items-center gap-1 text-xs font-medium">
        {icon}
        {title}
      </div>
      <p className={`text-[10px] ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>
        {subtitle}
      </p>
    </button>
  )
})

const SubscriptionCard = React.memo(function SubscriptionCard({
  subscription,
  isLoading,
}: {
  subscription: SubscriptionDto | null
  isLoading: boolean
}) {
  const cancel = useCancelSubscription()

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-6 w-1/2" />
        </CardContent>
      </Card>
    )
  }
  if (!subscription) return null

  const usd = (subscription.unitAmount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: subscription.currency.toUpperCase(),
  })
  const periodEnd = new Date(subscription.currentPeriodEnd).toLocaleDateString('pl-PL')
  const isCancelable = subscription.status === 'ACTIVE' && !subscription.cancelAtPeriodEnd

  const handleCancel = async () => {
    if (!confirm(`Anulować subskrypcję? Pozostanie aktywna do ${periodEnd}.`)) return
    try {
      await cancel.mutateAsync(subscription.id)
      toast.success('Subskrypcja zostanie anulowana na koniec okresu.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się anulować.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Repeat className="h-4 w-4" />
          Aktywna subskrypcja
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-neutral-900">{subscription.productName}</h3>
              <SubscriptionStatusBadge status={subscription.status} />
              {subscription.cancelAtPeriodEnd && (
                <Badge variant="warning">anulowana na koniec okresu</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              {usd} / {subscription.interval === 'month' ? 'miesiąc' : subscription.interval === 'year' ? 'rok' : 'okres'}
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500">
              <Calendar className="h-3 w-3" />
              {subscription.cancelAtPeriodEnd ? 'Wygasa: ' : 'Odnawia się: '}
              {periodEnd}
            </p>
          </div>
          {isCancelable && (
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancel.isPending}>
              <X className="mr-1 h-3 w-3" />
              Anuluj
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
})

const SUB_STATUS_LABELS: Record<SubscriptionDto['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  ACTIVE: { label: 'Aktywna', variant: 'success' },
  TRIALING: { label: 'Trial', variant: 'success' },
  PAST_DUE: { label: 'Zaległa płatność', variant: 'warning' },
  CANCELED: { label: 'Anulowana', variant: 'secondary' },
  INCOMPLETE: { label: 'Niekompletna', variant: 'warning' },
  INCOMPLETE_EXPIRED: { label: 'Niekompletna (wygasła)', variant: 'secondary' },
  UNPAID: { label: 'Nieopłacona', variant: 'destructive' },
  PAUSED: { label: 'Wstrzymana', variant: 'secondary' },
}

const SubscriptionStatusBadge = React.memo(function SubscriptionStatusBadge({
  status,
}: {
  status: SubscriptionDto['status']
}) {
  const cfg = SUB_STATUS_LABELS[status]
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
})

const TransactionsCard = React.memo(function TransactionsCard({
  transactions,
  isLoading,
}: {
  transactions: WalletTransaction[]
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4" />
          Historia transakcji
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-6">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">
            Brak transakcji. Po pierwszej płatności pojawią się tu.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {transactions.map((tx) => (
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
  )
})

const TX_TYPE_LABELS: Record<WalletTransaction['type'], { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
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

export const Route = createFileRoute('/settings/billing')({
  validateSearch: searchSchema,
  component: BillingSettingsPage,
})
