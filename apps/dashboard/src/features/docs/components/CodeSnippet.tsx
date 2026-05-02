import * as React from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@shared/utils/cn'

interface CodeSnippetProps {
  code: string
  language?: string
  /** Optional title bar (e.g. filename). */
  title?: string
  className?: string
}

/**
 * Code block with copy-to-clipboard. Light syntax styling — heavy highlighting
 * (shiki/prism) deferred — keeps the bundle small.
 */
export const CodeSnippet = React.memo(function CodeSnippet({
  code,
  language,
  title,
  className,
}: CodeSnippetProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Skopiowano do schowka.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Nie udało się skopiować — zaznacz i skopiuj ręcznie.')
    }
  }

  return (
    <div className={cn('overflow-hidden rounded-md border border-neutral-200', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-100 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          {language && (
            <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono uppercase">
              {language}
            </code>
          )}
          {title && <span className="text-neutral-600">{title}</span>}
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
          aria-label="Skopiuj kod"
          type="button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  )
})
CodeSnippet.displayName = 'CodeSnippet'
