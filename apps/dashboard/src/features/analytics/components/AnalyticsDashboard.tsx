import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { useAnalyticsControllerOverview } from '@gen/api'
import { MetricCard } from './MetricCard'
import { TimeSeriesChart } from './TimeSeriesChart'
import { BreakdownTable } from './BreakdownTable'
import { formatInt, formatMs, formatPercent, formatTokens, formatUsd } from '../utils/format'

interface AnalyticsDashboardProps {
  /** Optional scope to a single application; omit for account-wide view. */
  applicationId?: string
}

/**
 * Top-level analytics dashboard. Used at /analytics (account-wide) and
 * embedded in /applications/:id "Analityka" tab (app-scoped).
 */
export const AnalyticsDashboard = React.memo(function AnalyticsDashboard({
  applicationId,
}: AnalyticsDashboardProps) {
  const overview = useAnalyticsControllerOverview(
    applicationId ? { applicationId } : {},
  )

  const data = overview.data

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Requesty (30d)"
          value={data ? formatInt(data.totalRequests) : null}
          loading={overview.isLoading}
        />
        <MetricCard
          label="Tokeny (30d)"
          value={data ? formatTokens(data.totalInputTokens + data.totalOutputTokens) : null}
          hint={
            data
              ? `${formatTokens(data.totalInputTokens)} input + ${formatTokens(data.totalOutputTokens)} output`
              : undefined
          }
          loading={overview.isLoading}
        />
        <MetricCard
          label="Koszt USD (30d)"
          value={data ? formatUsd(data.totalCostUsd) : null}
          hint="Info-only — szacowane z ModelPricing."
          loading={overview.isLoading}
        />
        <MetricCard
          label="Latencja p95"
          value={data ? formatMs(data.p95LatencyMs) : null}
          hint={data ? `średnia: ${formatMs(data.avgLatencyMs)}` : undefined}
          loading={overview.isLoading}
        />
        <MetricCard
          label="Współczynnik błędów"
          value={data ? formatPercent(data.errorRate) : null}
          hint={data ? `${formatInt(data.errorCount)} błędnych requestów` : undefined}
          accent={data && data.errorRate > 0.05 ? 'danger' : data && data.errorRate > 0.01 ? 'warning' : 'success'}
          loading={overview.isLoading}
        />
        <MetricCard
          label="Cache hit (input)"
          value={
            data
              ? data.totalInputTokens > 0
                ? formatPercent(data.totalCacheReadTokens / data.totalInputTokens)
                : '0%'
              : null
          }
          hint={data ? `${formatTokens(data.totalCacheReadTokens)} z cache` : undefined}
          loading={overview.isLoading}
        />
      </div>

      <TimeSeriesChart applicationId={applicationId} />

      <BreakdownTable applicationId={applicationId} />

      {!applicationId && (
        <div className="flex justify-center">
          <Button variant="outline" asChild>
            <Link to="/analytics/events">
              <Activity className="h-4 w-4" />
              Live log zdarzeń
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
})
AnalyticsDashboard.displayName = 'AnalyticsDashboard'
