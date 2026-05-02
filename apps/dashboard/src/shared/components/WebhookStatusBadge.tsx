import * as React from 'react'
import { cn } from '@shared/utils/cn'

type WebhookStatus = 'delivered' | 'failed' | 'pending' | 'disabled'

interface WebhookStatusBadgeProps {
  status: WebhookStatus
  className?: string
}

const statusConfig: Record<WebhookStatus, { label: string; dotClass: string; badgeClass: string }> = {
  delivered: {
    label: 'Dostarczono',
    dotClass: 'bg-green-500',
    badgeClass: 'bg-green-50 text-green-700',
  },
  failed: {
    label: 'Błąd',
    dotClass: 'bg-red-500',
    badgeClass: 'bg-red-50 text-red-700',
  },
  pending: {
    label: 'Oczekuje',
    dotClass: 'bg-yellow-500',
    badgeClass: 'bg-yellow-50 text-yellow-700',
  },
  disabled: {
    label: 'Wyłączono',
    dotClass: 'bg-neutral-400',
    badgeClass: 'bg-neutral-100 text-neutral-600',
  },
}

export const WebhookStatusBadge = React.memo(function WebhookStatusBadge({
  status,
  className,
}: WebhookStatusBadgeProps) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.badgeClass,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  )
})
WebhookStatusBadge.displayName = 'WebhookStatusBadge'
