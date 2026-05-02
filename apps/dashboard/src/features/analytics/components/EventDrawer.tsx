import * as React from 'react'
import { X, ExternalLink } from 'lucide-react'
import { cn } from '@shared/utils/cn'
import { ProviderBadge } from '@shared/components/ProviderBadge'
import { Badge } from '@shared/ui/Badge'
import { formatInt, formatMs, formatTokens, formatUsd } from '../utils/format'

interface EventRow {
  id: string
  applicationId: string
  applicationKeyId: string
  endUserId: string | null
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  model: string
  isStream: boolean
  statusCode: number
  errorCode: string | null
  finishReason: string | null
  requestId: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number | null
  ttftMs: number | null
  latencyMs: number
  createdAt: unknown
}

interface EventDrawerProps {
  event: EventRow | null
  onClose: () => void
}

/**
 * Side drawer with full UsageEvent details. No prompt content (D-011) —
 * just metadata, tokens, cost, latency.
 */
export const EventDrawer = React.memo(function EventDrawer({
  event,
  onClose,
}: EventDrawerProps) {
  // Close on Escape.
  React.useEffect(() => {
    if (!event) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [event, onClose])

  if (!event) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto bg-white shadow-xl',
          'animate-in slide-in-from-right',
        )}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-neutral-200 bg-white p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Zdarzenie</p>
            <p className="mt-1 font-mono text-xs text-neutral-700">{event.id}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <Section title="Podstawowe">
            <Row label="Provider">
              <ProviderBadge provider={event.provider} />
            </Row>
            <Row label="Model">
              <code className="text-sm">{event.model}</code>
            </Row>
            <Row label="Stream">
              {event.isStream ? (
                <Badge variant="secondary" className="bg-violet-50 text-violet-700">
                  Tak (SSE)
                </Badge>
              ) : (
                <span className="text-neutral-500">Nie</span>
              )}
            </Row>
            <Row label="Status">
              <StatusBadge code={event.statusCode} errorCode={event.errorCode} />
            </Row>
            {event.finishReason && (
              <Row label="Finish reason">
                <code className="text-xs">{event.finishReason}</code>
              </Row>
            )}
            {event.requestId && (
              <Row label="Request ID">
                <code className="break-all text-xs">{event.requestId}</code>
              </Row>
            )}
          </Section>

          <Section title="Tokeny">
            <Row label="Input">
              <span className="tabular-nums">{formatTokens(event.inputTokens)}</span>
            </Row>
            <Row label="Output">
              <span className="tabular-nums">{formatTokens(event.outputTokens)}</span>
            </Row>
            {event.cacheReadTokens > 0 && (
              <Row label="Cache read">
                <span className="tabular-nums text-emerald-700">
                  {formatTokens(event.cacheReadTokens)}
                </span>
              </Row>
            )}
            {event.cacheCreationTokens > 0 && (
              <Row label="Cache write">
                <span className="tabular-nums text-amber-700">
                  {formatTokens(event.cacheCreationTokens)}
                </span>
              </Row>
            )}
            <Row label="Razem">
              <span className="tabular-nums font-medium">
                {formatTokens(event.inputTokens + event.outputTokens)}
              </span>
            </Row>
          </Section>

          <Section title="Latencja">
            <Row label="Total">
              <span className="tabular-nums">{formatMs(event.latencyMs)}</span>
            </Row>
            {event.ttftMs !== null && (
              <Row label="Time to first token">
                <span className="tabular-nums">{formatMs(event.ttftMs)}</span>
              </Row>
            )}
          </Section>

          {event.costUsd !== null && (
            <Section title="Koszt">
              <Row label="USD">
                <span className="tabular-nums font-medium">{formatUsd(event.costUsd)}</span>
              </Row>
            </Section>
          )}

          <Section title="Atrybucja">
            <Row label="Aplikacja">
              <a
                href={`/applications/${event.applicationId}`}
                className="inline-flex items-center gap-1 font-mono text-xs text-neutral-700 hover:underline"
              >
                {event.applicationId.slice(0, 8)}…
                <ExternalLink className="h-3 w-3" />
              </a>
            </Row>
            <Row label="Klucz">
              <code className="font-mono text-xs">{event.applicationKeyId.slice(0, 8)}…</code>
            </Row>
            {event.endUserId && (
              <Row label="End user">
                <code className="font-mono text-xs">{event.endUserId.slice(0, 8)}…</code>
              </Row>
            )}
          </Section>

          <Section title="Czas">
            <Row label="Utworzone">
              <span className="text-sm text-neutral-700">{formatFullTime(event.createdAt)}</span>
            </Row>
          </Section>

          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            Zgodnie z polityką prywatności gateway nie loguje treści promptu ani
            odpowiedzi modelu — tylko metadane (tokeny, koszt, latencja, status).
          </p>
        </div>
      </aside>
    </>
  )
})
EventDrawer.displayName = 'EventDrawer'

const Section = React.memo(function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <div className="space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
        {children}
      </div>
    </div>
  )
})
Section.displayName = 'Section'

const Row = React.memo(function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
})
Row.displayName = 'Row'

const StatusBadge = React.memo(function StatusBadge({
  code,
  errorCode,
}: {
  code: number
  errorCode: string | null
}) {
  if (code >= 200 && code < 300) {
    return (
      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
        {code}
      </Badge>
    )
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Badge variant="secondary" className={code >= 500 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}>
        {code}
      </Badge>
      {errorCode && <code className="text-[10px] text-red-700">{errorCode}</code>}
    </span>
  )
})
StatusBadge.displayName = 'StatusBadge'

function formatFullTime(value: unknown): string {
  if (!value) return '—'
  const d =
    typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

void formatInt // keep import (may be used in future)
