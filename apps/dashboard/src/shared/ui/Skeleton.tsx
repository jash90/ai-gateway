import * as React from 'react'
import { cn } from '@shared/utils/cn'

const Skeleton = React.memo(function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-neutral-200', className)}
      {...props}
    />
  )
})
Skeleton.displayName = 'Skeleton'

export { Skeleton }
