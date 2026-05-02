import * as React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Activity, RefreshCcw, Pause, Play, Filter, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import { Input } from '@shared/ui/Input'
import { ProviderBadge } from '@shared/components/ProviderBadge'
import { EmptyState } from '@shared/components/EmptyState'
import { analyticsControllerEvents } from '@gen/api'
import type { AnalyticsControllerEventsParams } from '@gen/api.schemas'
import { formatMs, formatTokens, formatUsd } from '../utils/format'
import { EventDrawer } from './EventDrawer'

type Provider = 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
type StatusFilter = 'all' | 'success' | 'client_error' | 'server_error'

interface EventRow {
  id: string
  applicationId: string
  applicationKeyId: string
  endUserId: string | null
  provider: Provider
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

const REFRESH_INTERVAL_MS = 5_000

export const EventsList = React.memo(function EventsList() {
  const [provider, setProvider] = React.useState<'all' | Provider>('all')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [model, setModel] = React.useState('')
  const [debouncedModel, setDebouncedModel] = React.useState('')
  const [autoRefresh, setAutoRefresh] = React.useState(true)
  const [selectedEvent, setSelectedEvent] = React.useState<EventRow | null>(null)

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedModel(model.trim()), 300)
    return () => clearTimeout(t)
  }, [model])

  const baseParams = React.useMemo<AnalyticsControllerEventsParams>(() => ({
    ...(provider !== 'all' ? { provider } : {}),
    ...(status !== 'all' ? { status } : {}),
    ...(debouncedModel ? { model: debouncedModel } : {}),
    limit: 50,
  }), [provider, status, debouncedModel])

  // Pause auto-refresh when drawer is open or tab is hidden.
  const documentVisible = useDocumentVisible()
  const refetchInterval =
    autoRefresh && documentVisible && selectedEvent === null ? REFRESH_INTERVAL_MS : false

  const query = useInfiniteQuery<{ events: EventRow[]; nextCursor: string | null }>({
    queryKey: ['analytics-events', baseParams],
    queryFn: async ({ pageParam }) => {
      const res = await analyticsControllerEvents({
        ...baseParams,
        ...(pageParam ? { cursor: pageParam as string } : {}),
      })
      return res as unknown as { events: EventRow[]; nextCursor: string | null }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval,
  })

  const events = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.events) ?? [],
    [query.data],
  )

  // Surface query errors so a dead live-stream is obvious. Toast once per
  // failure transition (don't spam on every retry tick).
  const lastErrorRef = React.useRef<unknown>(null)
  React.useEffect(() => {
    if (query.error && query.error !== lastErrorRef.current) {
      lastErrorRef.current = query.error
      const msg =
        query.error instanceof Error
          ? query.error.message
          : 'Nie udało się pobrać zdarzeń. Spróbuj odświeżyć.'
      toast.error(msg)
    }
    if (!query.error) {
      lastErrorRef.current = null
    }
  }, [query.error])

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Live log</h1>
            <p className="text-sm text-neutral-500">
              Każdy request gateway jako osobny rekord (bez treści promptu).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {autoRefresh ? 'Pauza' : 'Auto-refresh'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCcw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />
              Odśwież
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={provider} onValueChange={(v) => setProvider(v as 'all' | Provider)}>
            <SelectTrigger className="h-9 w-40">
              <Filter className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszyscy providerzy</SelectItem>
              <SelectItem value="OPENAI">OpenAI</SelectItem>
              <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
              <SelectItem value="OPENROUTER">OpenRouter</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie statusy</SelectItem>
              <SelectItem value="success">Tylko sukces (2xx)</SelectItem>
              <SelectItem value="client_error">Client error (4xx)</SelectItem>
              <SelectItem value="server_error">Server error (5xx)</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Filtruj po modelu..."
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 max-w-xs"
          />
          {query.error ? (
            <Badge variant="secondary" className="bg-red-50 text-red-700">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Błąd pobierania
            </Badge>
          ) : (
            autoRefresh && documentVisible && selectedEvent === null && (
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />
                Live (co 5s)
              </Badge>
            )
          )}
        </div>

        {query.isLoading ? (
          <Skeleton className="h-96 rounded-lg" />
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-12 w-12 text-neutral-400" />}
            title="Brak zdarzeń"
            description="Zdarzenia pojawią się tu po pierwszym wywołaniu gateway."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-neutral-50">
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="px-3 py-2 font-medium">Czas</th>
                    <th className="px-3 py-2 font-medium">Provider</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Tokeny</th>
                    <th className="px-3 py-2 text-right font-medium">Latencja</th>
                    <th className="px-3 py-2 text-right font-medium">Koszt</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((evt) => (
                    <tr
                      key={evt.id}
                      onClick={() => setSelectedEvent(evt)}
                      className="cursor-pointer border-b border-neutral-100 transition-colors last:border-b-0 hover:bg-neutral-50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                        {formatTime(evt.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <ProviderBadge provider={evt.provider} />
                      </td>
                      <td className="px-3 py-2">
                        <code className="text-xs">{evt.model}</code>
                        {evt.isStream && (
                          <span className="ml-1.5 text-[10px] uppercase text-violet-600">stream</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusCell code={evt.statusCode} errorCode={evt.errorCode} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                        {formatTokens(evt.inputTokens + evt.outputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                        {formatMs(evt.latencyMs)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                        {evt.costUsd !== null ? formatUsd(evt.costUsd, true) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Ładowanie...' : 'Załaduj więcej'}
            </Button>
          </div>
        )}
      </div>

      <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </>
  )
})
EventsList.displayName = 'EventsList'

const StatusCell = React.memo(function StatusCell({
  code,
  errorCode,
}: {
  code: number
  errorCode: string | null
}) {
  if (code >= 200 && code < 300) {
    return <span className="font-mono text-xs text-emerald-700">{code}</span>
  }
  return (
    <span className="font-mono text-xs text-red-700">
      {code}
      {errorCode && <span className="ml-1 text-[10px] text-neutral-500">{errorCode}</span>}
    </span>
  )
})
StatusCell.displayName = 'StatusCell'

function formatTime(value: unknown): string {
  if (!value) return '—'
  const d =
    typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Tab visibility — pause auto-refresh when user is on another tab. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = React.useState(
    typeof document === 'undefined' ? true : !document.hidden,
  )
  React.useEffect(() => {
    const handler = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return visible
}
