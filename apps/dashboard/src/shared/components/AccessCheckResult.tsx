import * as React from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import { cn } from '@shared/utils/cn'
import { formatCredits } from '@shared/utils/format'

interface AccessCheckResultProps {
  allowed: boolean
  remaining?: number | null
  reason?: string | null
  className?: string
}

export const AccessCheckResult = React.memo(function AccessCheckResult({
  allowed,
  remaining,
  reason,
  className,
}: AccessCheckResultProps) {
  if (allowed) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4',
          className,
        )}
      >
        <CheckCircle className="h-5 w-5 text-green-600" />
        <div>
          <p className="text-sm font-medium text-green-800">Dostęp dozwolony</p>
          {remaining !== null && remaining !== undefined && (
            <p className="text-xs text-green-600">
              Pozostało {formatCredits(remaining)} kredytów
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4',
        className,
      )}
    >
      <XCircle className="h-5 w-5 text-red-600" />
      <div>
        <p className="text-sm font-medium text-red-800">Dostęp zabroniony</p>
        {reason && (
          <p className="text-xs text-red-600">{reason}</p>
        )}
      </div>
    </div>
  )
})
AccessCheckResult.displayName = 'AccessCheckResult'
