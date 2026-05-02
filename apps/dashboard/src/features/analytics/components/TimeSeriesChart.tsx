import * as React from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import { useAnalyticsControllerTimeseries } from '@gen/api'
import { formatCompact, formatMs, formatUsd, formatInt } from '../utils/format'

type Metric = 'requests' | 'tokens' | 'cost' | 'latency_p95'
type Granularity = 'hour' | 'day'

const METRIC_LABELS: Record<Metric, string> = {
  requests: 'Liczba requestów',
  tokens: 'Tokeny (input + output)',
  cost: 'Koszt USD',
  latency_p95: 'Latencja p95',
}

const formatValue = (value: number, metric: Metric): string => {
  switch (metric) {
    case 'cost':
      return formatUsd(value, true)
    case 'latency_p95':
      return formatMs(value)
    case 'tokens':
    case 'requests':
    default:
      return formatInt(value)
  }
}

interface TimeSeriesChartProps {
  /** Optional scoping by app — if omitted, chart aggregates across all apps. */
  applicationId?: string
}

export const TimeSeriesChart = React.memo(function TimeSeriesChart({
  applicationId,
}: TimeSeriesChartProps) {
  const [metric, setMetric] = React.useState<Metric>('requests')
  const [granularity, setGranularity] = React.useState<Granularity>('day')

  const query = useAnalyticsControllerTimeseries({
    metric,
    granularity,
    ...(applicationId ? { applicationId } : {}),
  })

  const points = React.useMemo(() => {
    const raw = query.data?.points ?? []
    return raw.map((p) => ({
      bucket: p.bucket,
      value: p.value,
      bucketLabel: formatBucketLabel(p.bucket, granularity),
    }))
  }, [query.data, granularity])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Trend w czasie</CardTitle>
        <div className="flex gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requests">Requesty</SelectItem>
              <SelectItem value="tokens">Tokeny</SelectItem>
              <SelectItem value="cost">Koszt USD</SelectItem>
              <SelectItem value="latency_p95">Latencja p95</SelectItem>
            </SelectContent>
          </Select>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">Godzinowo</SelectItem>
              <SelectItem value="day">Dziennie</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-neutral-500">
            Brak danych w wybranym zakresie.
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="metricGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#171717" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#171717" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis
                  dataKey="bucketLabel"
                  fontSize={11}
                  stroke="#a3a3a3"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={11}
                  stroke="#a3a3a3"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatCompact(v)}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e5e5',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#525252', marginBottom: 4 }}
                  formatter={(value: number) => [formatValue(value, metric), METRIC_LABELS[metric]]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#171717"
                  strokeWidth={2}
                  fill="url(#metricGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
})
TimeSeriesChart.displayName = 'TimeSeriesChart'

function formatBucketLabel(iso: string, granularity: Granularity): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  if (granularity === 'hour') {
    return d.toLocaleString('pl-PL', { month: 'short', day: 'numeric', hour: '2-digit' })
  }
  return d.toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })
}
