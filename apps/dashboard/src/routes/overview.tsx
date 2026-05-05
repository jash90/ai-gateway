import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Boxes,
  KeyRound,
  Webhook,
  Bell,
  BarChart3,
  BookOpen,
  Shield,
  Activity,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Badge } from '@shared/ui/Badge'
import { Skeleton } from '@shared/ui/Skeleton'
import { useAuthStore } from '@shared/stores/auth-store'
import { ProviderBadge } from '@shared/components/ProviderBadge'
import { MetricCard } from '@features/analytics/components/MetricCard'
import {
  formatInt,
  formatMs,
  formatPercent,
  formatUsd,
} from '@features/analytics/utils/format'
import {
  useApplicationsControllerList,
  useProviderKeysControllerList,
  useAnalyticsControllerEvents,
} from '@gen/api'
import { useWallets } from '@features/billing/hooks/useWallet'

const OverviewPage = React.memo(function OverviewPage() {
  const account = useAuthStore((s) => s.account)

  const apps = useApplicationsControllerList()
  const keys = useProviderKeysControllerList()
  const events = useAnalyticsControllerEvents({ limit: 100 })
  const wallet = useWallets()

  // Compute metrics client-side from events list (avoids the broken
  // /v1/analytics/overview endpoint until it's fixed server-side).
  const stats = React.useMemo(() => {
    const list = events.data?.events ?? []
    if (list.length === 0) {
      return {
        count: 0,
        errorRate: 0,
        errorCount: 0,
        avgLatency: null as number | null,
        totalCost: 0,
      }
    }
    const errors = list.filter((e) => e.statusCode >= 400).length
    const totalLatency = list.reduce((acc, e) => acc + (e.latencyMs ?? 0), 0)
    const totalCost = list.reduce((acc, e) => acc + (e.costUsd ?? 0), 0)
    return {
      count: list.length,
      errorRate: errors / list.length,
      errorCount: errors,
      avgLatency: totalLatency / list.length,
      totalCost,
    }
  }, [events.data])

  const recent = (events.data?.events ?? []).slice(0, 5)
  const greeting = account?.name?.trim() || account?.email?.split('@')[0] || 'tam'

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-neutral-900">
          Cześć, {greeting}
        </h1>
        <p className="text-sm text-neutral-500">
          Tu jest podgląd Twojego konta na AI Gateway. Wszystkie aplikacje, klucze BYOK
          i ostatnie wywołania w jednym miejscu.
        </p>
      </div>

      {/* Top metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Saldo tokenów"
          value={wallet.data ? formatTokensCompact(wallet.data.totalAvailable) : null}
          hint={
            wallet.data && BigInt(wallet.data.totalAvailable) === 0n
              ? 'Doładuj saldo w Płatności →'
              : 'Dostępne do zużycia'
          }
          accent={
            wallet.data && BigInt(wallet.data.totalAvailable) === 0n ? 'warning' : 'default'
          }
          loading={wallet.isLoading}
        />
        <MetricCard
          label="Requesty (ostatnie 100)"
          value={formatInt(stats.count)}
          hint={
            stats.count === 0
              ? 'Brak wywołań — zacznij od dodania klucza BYOK.'
              : undefined
          }
          loading={events.isLoading}
        />
        <MetricCard
          label="Błędy"
          value={formatPercent(stats.errorRate)}
          hint={`${formatInt(stats.errorCount)} z ${formatInt(stats.count)}`}
          accent={
            stats.errorRate > 0.05
              ? 'danger'
              : stats.errorRate > 0.01
                ? 'warning'
                : 'success'
          }
          loading={events.isLoading}
        />
        <MetricCard
          label="Średnia latencja"
          value={stats.avgLatency != null ? formatMs(stats.avgLatency) : '—'}
          loading={events.isLoading}
        />
        <MetricCard
          label="Szacowany koszt"
          value={formatUsd(stats.totalCost, true)}
          hint="Z ostatnich 100 zdarzeń."
          loading={events.isLoading}
        />
      </div>

      {/* Inventory + nav */}
      <div className="grid gap-6 lg:grid-cols-3">
        <InventoryCard
          title="Aplikacje"
          icon={<Boxes className="h-4 w-4" />}
          loading={apps.isLoading}
          count={apps.data?.length ?? 0}
          to="/applications"
          emptyHint="Utwórz pierwszą aplikację, aby wygenerować klucz API."
        />
        <InventoryCard
          title="Klucze BYOK"
          icon={<KeyRound className="h-4 w-4" />}
          loading={keys.isLoading}
          count={keys.data?.length ?? 0}
          to="/settings/provider-keys"
          emptyHint="Dodaj klucz dostawcy (OpenAI / Anthropic / OpenRouter)."
        >
          {keys.data && keys.data.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {keys.data.slice(0, 3).map((k) => (
                <ProviderBadge key={k.id} provider={k.provider} />
              ))}
              {keys.data.length > 3 && (
                <Badge variant="secondary">+{keys.data.length - 3}</Badge>
              )}
            </div>
          )}
        </InventoryCard>
        <InventoryCard
          title="Live log"
          icon={<Activity className="h-4 w-4" />}
          loading={events.isLoading}
          count={events.data?.events.length ?? 0}
          to="/analytics/events"
          emptyHint="Każde wywołanie gateway pojawi się tutaj automatycznie."
          countSuffix="ostatnich"
        />
      </div>

      {/* Quick actions */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Skróty
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ActionCard
            to="/analytics"
            icon={<BarChart3 className="h-5 w-5" />}
            title="Analityka"
            description="Wykresy, breakdown wg modeli, koszty 30 dni."
          />
          <ActionCard
            to="/settings/webhooks"
            icon={<Webhook className="h-5 w-5" />}
            title="Webhooki"
            description="Subskrybuj zdarzenia — usage, errors, key events."
          />
          <ActionCard
            to="/settings/alerts"
            icon={<Bell className="h-5 w-5" />}
            title="Alerty"
            description="Progi kosztów, error rate, latencja P95."
          />
          <ActionCard
            to="/docs"
            icon={<BookOpen className="h-5 w-5" />}
            title="Dokumentacja"
            description="Snippety SDK + Swagger UI."
          />
          {account?.role === 'ADMIN' && (
            <ActionCard
              to="/admin"
              icon={<Shield className="h-5 w-5" />}
              title="Panel administratora"
              description="Konta, audit log, cennik modeli."
            />
          )}
        </div>
      </section>

      {/* Recent events */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Ostatnie wywołania
          </h2>
          <Link
            to="/analytics/events"
            className="inline-flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900"
          >
            Zobacz wszystko
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            {events.isLoading ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-center gap-1 p-10 text-center">
                <p className="text-sm font-medium text-neutral-700">
                  Brak wywołań
                </p>
                <p className="text-xs text-neutral-500">
                  Wywołania pojawią się po pierwszym requeście do gateway.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {recent.map((ev) => (
                  <li
                    key={ev.id}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 py-3 text-sm"
                  >
                    <ProviderBadge provider={ev.provider} />
                    <span className="truncate font-mono text-xs text-neutral-700">
                      {ev.model}
                    </span>
                    <Badge
                      variant={
                        ev.statusCode >= 500
                          ? 'destructive'
                          : ev.statusCode >= 400
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {ev.statusCode}
                    </Badge>
                    <span className="tabular-nums text-xs text-neutral-500">
                      {formatMs(ev.latencyMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
})
OverviewPage.displayName = 'OverviewPage'

interface InventoryCardProps {
  title: string
  icon: React.ReactNode
  loading: boolean
  count: number
  to: string
  emptyHint: string
  countSuffix?: string
  children?: React.ReactNode
}

const InventoryCard = React.memo(function InventoryCard({
  title,
  icon,
  loading,
  count,
  to,
  emptyHint,
  countSuffix,
  children,
}: InventoryCardProps) {
  return (
    <Link to={to}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-neutral-900">
                {count}
              </span>
              {countSuffix && (
                <span className="text-xs text-neutral-500">{countSuffix}</span>
              )}
            </div>
          )}
          {!loading && count === 0 && (
            <p className="mt-2 text-xs text-neutral-500">{emptyHint}</p>
          )}
          {children}
        </CardContent>
      </Card>
    </Link>
  )
})
InventoryCard.displayName = 'InventoryCard'

interface ActionCardProps {
  to: string
  icon: React.ReactNode
  title: string
  description: string
}

const ActionCard = React.memo(function ActionCard({
  to,
  icon,
  title,
  description,
}: ActionCardProps) {
  return (
    <Link to={to}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-neutral-500">
          {description}
        </CardContent>
      </Card>
    </Link>
  )
})
ActionCard.displayName = 'ActionCard'

function formatTokensCompact(value: string): string {
  try {
    const n = BigInt(value)
    if (n >= 1_000_000n) return `${(Number(n) / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
    if (n >= 1_000n) return `${(Number(n) / 1_000).toFixed(1).replace(/\.?0+$/, '')}k`
    return n.toString()
  } catch {
    return value
  }
}

export const Route = createFileRoute('/overview')({
  component: OverviewPage,
})
