import * as React from 'react'
import { cn } from '@shared/utils/cn'
import { formatCredits } from '@shared/utils/format'

interface StreamingViewerProps {
  isStreaming: boolean
  content: string
  tokens?: { input: number; output: number } | null
  cost?: number | null
  className?: string
}

export const StreamingViewer = React.memo(function StreamingViewer({
  isStreaming,
  content,
  tokens,
  cost,
  className,
}: StreamingViewerProps) {
  return (
    <div className={cn('rounded-md border border-neutral-200 bg-neutral-50 p-4', className)}>
      {content ? (
        <pre className="whitespace-pre-wrap text-sm text-neutral-900 font-mono">
          {content}
          {isStreaming && (
            <span className="inline-block h-4 w-0.5 animate-pulse bg-neutral-900 ml-0.5" />
          )}
        </pre>
      ) : (
        <p className="text-sm text-neutral-400">
          {isStreaming ? 'Oczekiwanie na odpowiedź...' : 'Brak odpowiedzi'}
        </p>
      )}

      {/* Usage stats shown during/after streaming */}
      {(tokens || cost !== null && cost !== undefined) && (
        <div className="mt-3 flex items-center gap-4 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
          {tokens && (
            <>
              <span>Wejście: {tokens.input} tokenów</span>
              <span>Wyjście: {tokens.output} tokenów</span>
            </>
          )}
          {cost !== null && cost !== undefined && (
            <span>Koszt: ~{formatCredits(cost)} kr</span>
          )}
        </div>
      )}
    </div>
  )
})
StreamingViewer.displayName = 'StreamingViewer'
