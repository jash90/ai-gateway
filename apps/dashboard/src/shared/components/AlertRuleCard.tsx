import * as React from 'react'
import { Bell, AlertTriangle } from 'lucide-react'
import { cn } from '@shared/utils/cn'
import { formatRelativeTime } from '@shared/utils/format'

interface AlertRuleCardProps {
  type: string
  threshold: string
  channel: string
  lastTriggered: string | null
  onEdit?: () => void
  onDelete?: () => void
  className?: string
}

const typeIcons: Record<string, React.ReactNode> = {
  BALANCE_LOW: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  USAGE_THRESHOLD: <Bell className="h-4 w-4 text-blue-500" />,
}

export const AlertRuleCard = React.memo(function AlertRuleCard({
  type,
  threshold,
  channel,
  lastTriggered,
  onEdit,
  onDelete,
  className,
}: AlertRuleCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-neutral-200 bg-white p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {typeIcons[type] ?? <Bell className="h-4 w-4 text-neutral-500" />}
          <div>
            <p className="text-sm font-medium text-neutral-900">
              {type === 'BALANCE_LOW' ? 'Niskie saldo' : 'Przekroczenie limitu'}
            </p>
            <p className="text-xs text-neutral-500">Typ: {type}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              Edytuj
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Usuń
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1 text-sm text-neutral-600">
        <p>Próg: {threshold}</p>
        <p>Kanał: {channel}</p>
        <p>
          Ostatnie uruchomienie:{' '}
          {lastTriggered ? formatRelativeTime(lastTriggered) : 'nigdy'}
        </p>
      </div>
    </div>
  )
})
AlertRuleCard.displayName = 'AlertRuleCard'
