import * as React from 'react'
import { cn } from '@shared/utils/cn'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'

interface MetricCardProps {
  label: string
  value: string | number | null
  hint?: string
  loading?: boolean
  /** Optional accent color for the value (use Tailwind classes). */
  accent?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}

const ACCENT_CLASSES = {
  default: 'text-neutral-900',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
}

/**
 * Single big-number stat card. Used in /overview and /analytics for top-line
 * metrics (total requests, tokens, cost, p95 latency, error rate).
 */
export const MetricCard = React.memo(function MetricCard({
  label,
  value,
  hint,
  loading,
  accent = 'default',
  className,
}: MetricCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <p className={cn('mt-2 text-2xl font-bold tabular-nums', ACCENT_CLASSES[accent])}>
            {value ?? '—'}
          </p>
        )}
        {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
      </CardContent>
    </Card>
  )
})
MetricCard.displayName = 'MetricCard'
