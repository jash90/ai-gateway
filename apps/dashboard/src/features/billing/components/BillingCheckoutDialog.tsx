import * as React from 'react'
import { toast } from 'sonner'
import { Package, Repeat, ArrowRight, Layers, AppWindow } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
import { Button } from '@shared/ui/Button'
import { Badge } from '@shared/ui/Badge'
import { Skeleton } from '@shared/ui/Skeleton'
import { useApplicationsControllerList } from '@gen/api'
import {
  useCatalog,
  useCheckout,
  usePreferences,
  type CheckoutScope,
} from '../hooks/useWallet'
import type { BillingPriceDto } from '../hooks/useProducts'

interface BillingCheckoutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select an application (from /applications/:id "Płatności" tab). */
  defaultApplicationId?: string
}

export const BillingCheckoutDialog = React.memo(function BillingCheckoutDialog({
  open,
  onOpenChange,
  defaultApplicationId,
}: BillingCheckoutDialogProps) {
  const catalog = useCatalog()
  const apps = useApplicationsControllerList({})
  const preferences = usePreferences()
  const checkout = useCheckout()
  const [pendingPriceId, setPendingPriceId] = React.useState<string | null>(null)

  const activeApps = React.useMemo(
    () => (apps.data ?? []).filter((a) => a.isActive),
    [apps.data],
  )

  // Per-product-mode scope state: PACKAGE defaults to PER_APPLICATION,
  // SUBSCRIPTION defaults to SHARED_ACCOUNT (per spec).
  const [packageScope, setPackageScope] = React.useState<CheckoutScope>('PER_APPLICATION')
  const [subscriptionScope, setSubscriptionScope] =
    React.useState<CheckoutScope>('SHARED_ACCOUNT')
  const [applicationId, setApplicationId] = React.useState<string | null>(
    defaultApplicationId ?? null,
  )

  // Hydrate defaults from server preferences once available, unless the dialog
  // was opened with an explicit defaultApplicationId (per-app payment tab).
  React.useEffect(() => {
    if (preferences.data) {
      setPackageScope(preferences.data.defaultPackageScope)
      setSubscriptionScope(preferences.data.defaultSubscriptionScope)
    }
  }, [preferences.data])

  React.useEffect(() => {
    if (defaultApplicationId) {
      setApplicationId(defaultApplicationId)
      setPackageScope('PER_APPLICATION')
      setSubscriptionScope('PER_APPLICATION')
    }
  }, [defaultApplicationId])

  // Auto-pick first application when scope=PER_APPLICATION and none chosen.
  React.useEffect(() => {
    if (!applicationId && activeApps.length > 0) {
      setApplicationId(activeApps[0].id)
    }
  }, [activeApps, applicationId])

  const handleBuy = async (
    price: BillingPriceDto,
    productMode: 'PACKAGE' | 'SUBSCRIPTION',
  ) => {
    const scope = productMode === 'PACKAGE' ? packageScope : subscriptionScope
    if (scope === 'PER_APPLICATION' && !applicationId) {
      toast.error('Wybierz aplikację, do której trafią tokeny.')
      return
    }
    setPendingPriceId(price.id)
    try {
      const session = await checkout.mutateAsync({
        priceId: price.id,
        scope,
        applicationId: scope === 'PER_APPLICATION' ? applicationId ?? undefined : undefined,
        successUrl: `${window.location.origin}/settings/billing?status=ok`,
        cancelUrl: `${window.location.origin}/settings/billing?status=canceled`,
      })
      window.location.href = session.url
    } catch (err) {
      setPendingPriceId(null)
      toast.error(
        err instanceof Error ? err.message : 'Nie udało się utworzyć sesji Checkout.',
      )
    }
  }

  const products = catalog.data?.products ?? []
  const hasAny = products.some((p) => p.prices.length > 0)
  const isLoading = catalog.isLoading || apps.isLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kup tokeny</DialogTitle>
          <DialogDescription>
            Wybierz pakiet lub subskrypcję. Zapłatę realizuje Stripe — w trybie test użyj karty
            <code className="mx-1 rounded bg-neutral-100 px-1">4242 4242 4242 4242</code>
            z dowolną przyszłą datą i CVC.
          </DialogDescription>
        </DialogHeader>

        {/* Scope picker */}
        <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Gdzie trafią tokeny?
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <ScopeBlock
              label="Pakiety (jednorazowe)"
              icon={<Package className="h-3 w-3" />}
              value={packageScope}
              onChange={setPackageScope}
            />
            <ScopeBlock
              label="Subskrypcje"
              icon={<Repeat className="h-3 w-3" />}
              value={subscriptionScope}
              onChange={setSubscriptionScope}
            />
          </div>
          {(packageScope === 'PER_APPLICATION' || subscriptionScope === 'PER_APPLICATION') && (
            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Aplikacja
              </label>
              {activeApps.length === 0 ? (
                <p className="mt-1 text-xs text-amber-600">
                  Brak aktywnych aplikacji. Stwórz aplikację w sekcji &quot;Aplikacje&quot;
                  zanim kupisz pakiet PER_APPLICATION.
                </p>
              ) : (
                <select
                  value={applicationId ?? ''}
                  onChange={(e) => setApplicationId(e.target.value || null)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                >
                  {activeApps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !hasAny ? (
          <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            Operator gateway nie skonfigurował jeszcze żadnych pakietów. Spróbuj ponownie później.
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product) =>
              product.prices.map((price) => (
                <PriceOption
                  key={price.id}
                  productName={product.name}
                  productMode={product.mode}
                  productDescription={product.description}
                  price={price}
                  scope={
                    product.mode === 'PACKAGE' ? packageScope : subscriptionScope
                  }
                  onBuy={() => handleBuy(price, product.mode)}
                  isPending={pendingPriceId === price.id}
                />
              )),
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
})
BillingCheckoutDialog.displayName = 'BillingCheckoutDialog'

const ScopeBlock = React.memo(function ScopeBlock({
  label,
  icon,
  value,
  onChange,
}: {
  label: string
  icon: React.ReactNode
  value: CheckoutScope
  onChange: (v: CheckoutScope) => void
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2">
      <div className="flex items-center gap-1 text-xs font-medium text-neutral-700">
        {icon}
        {label}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1">
        <ScopeButton
          active={value === 'PER_APPLICATION'}
          onClick={() => onChange('PER_APPLICATION')}
          icon={<AppWindow className="h-3 w-3" />}
          title="Per aplikacja"
          subtitle="Jedna aplikacja"
        />
        <ScopeButton
          active={value === 'SHARED_ACCOUNT'}
          onClick={() => onChange('SHARED_ACCOUNT')}
          icon={<Layers className="h-3 w-3" />}
          title="Wspólne"
          subtitle="Dla wszystkich apps"
        />
      </div>
    </div>
  )
})

const ScopeButton = React.memo(function ScopeButton({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300'
      }`}
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

const PriceOption = React.memo(function PriceOption({
  productName,
  productMode,
  productDescription,
  price,
  scope,
  onBuy,
  isPending,
}: {
  productName: string
  productMode: 'PACKAGE' | 'SUBSCRIPTION'
  productDescription: string | null
  price: BillingPriceDto
  scope: CheckoutScope
  onBuy: () => void
  isPending: boolean
}) {
  const usd = (price.unitAmount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  })
  const tokens = formatTokens(price.tokensGranted)
  const cadence = price.interval ? `/${price.interval === 'month' ? 'mc' : 'rok'}` : ' jednorazowo'

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-neutral-900">{productName}</h3>
            <Badge variant={productMode === 'SUBSCRIPTION' ? 'secondary' : 'default'}>
              {productMode === 'SUBSCRIPTION' ? (
                <>
                  <Repeat className="mr-1 h-3 w-3" /> Subskrypcja
                </>
              ) : (
                <>
                  <Package className="mr-1 h-3 w-3" /> Pakiet
                </>
              )}
            </Badge>
            <Badge variant={scope === 'PER_APPLICATION' ? 'default' : 'secondary'}>
              {scope === 'PER_APPLICATION' ? (
                <>
                  <AppWindow className="mr-1 h-3 w-3" /> Per aplikacja
                </>
              ) : (
                <>
                  <Layers className="mr-1 h-3 w-3" /> Wspólne
                </>
              )}
            </Badge>
          </div>
          {productDescription && (
            <p className="mt-1 text-sm text-neutral-500">{productDescription}</p>
          )}
          <p className="mt-2 text-xs text-neutral-600">
            <strong className="text-neutral-900">{tokens}</strong> tokenów
            {price.interval ? ` na ${price.interval === 'month' ? 'mc' : 'rok'}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums text-neutral-900">
              {usd}
              <span className="ml-1 text-xs font-normal text-neutral-500">{cadence}</span>
            </p>
          </div>
          <Button onClick={onBuy} disabled={isPending} size="sm">
            {isPending ? 'Przekierowywanie…' : 'Kup'}
            {!isPending && <ArrowRight className="ml-1 h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  )
})

function formatTokens(value: string): string {
  try {
    const n = BigInt(value)
    if (n >= 1_000_000n) return `${(Number(n) / 1_000_000).toFixed(1).replace('.0', '')}M`
    if (n >= 1_000n) return `${(Number(n) / 1_000).toFixed(1).replace('.0', '')}k`
    return n.toString()
  } catch {
    return value
  }
}
