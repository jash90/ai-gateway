import * as React from 'react'
import { cn } from '@shared/utils/cn'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export const EmptyState = React.memo(function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[300px] flex-col items-center justify-center gap-4 text-center',
        className,
      )}
    >
      {icon && <div className="text-neutral-300">{icon}</div>}
      <div>
        <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
})
EmptyState.displayName = 'EmptyState'
