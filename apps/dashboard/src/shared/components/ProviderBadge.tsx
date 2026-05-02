import * as React from 'react'
import { cn } from '@shared/utils/cn'

interface ProviderBadgeProps {
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  className?: string
}

const STYLES = {
  OPENAI: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ANTHROPIC: 'bg-amber-50 text-amber-800 border-amber-200',
  OPENROUTER: 'bg-violet-50 text-violet-700 border-violet-200',
} as const

const LABELS = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  OPENROUTER: 'OpenRouter',
} as const

/**
 * Pill-style badge that color-codes a BYOK / model provider. Used in
 * ProviderKey lists, model dropdowns, usage event rows.
 */
export const ProviderBadge = React.memo(function ProviderBadge({
  provider,
  className,
}: ProviderBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        STYLES[provider],
        className,
      )}
    >
      {LABELS[provider]}
    </span>
  )
})
ProviderBadge.displayName = 'ProviderBadge'
