import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@shared/utils/cn'

const entitlementVariants = cva('', {
  variants: {
    type: {
      HARD: 'bg-red-100 text-red-800',
      SOFT: 'bg-yellow-100 text-yellow-800',
      NONE: 'bg-green-100 text-green-800',
    },
  },
})

const entitlementLabels: Record<string, string> = {
  HARD: 'Blokada',
  SOFT: 'Ostrzeżenie',
  NONE: 'Bez limitu',
}

interface EntitlementBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof entitlementVariants> {
  limitType: 'HARD' | 'SOFT' | 'NONE'
}

export const EntitlementBadge = React.memo(function EntitlementBadge({
  limitType,
  className,
  ...props
}: EntitlementBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        entitlementVariants({ type: limitType }),
        className,
      )}
      {...props}
    >
      {entitlementLabels[limitType]}
    </span>
  )
})
EntitlementBadge.displayName = 'EntitlementBadge'

export { entitlementVariants }
