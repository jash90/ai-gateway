import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Clock, RotateCcw } from 'lucide-react'
import { Skeleton } from '@shared/ui/Skeleton'
import { Button } from '@shared/ui/Button'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useWebhooksControllerListDeliveries,
  webhooksControllerReplayDelivery,
  getWebhooksControllerListDeliveriesQueryKey,
} from '@gen/api'

interface DeliveryHistoryRowProps {
  webhookId: string
}

interface Delivery {
  id: string
  event: string
  statusCode: number | null
  attempts: number
  deliveredAt: unknown
  createdAt: unknown
  response: string | null
}

/**
 * Inline expand showing last 50 webhook deliveries for a webhook config.
 * Embedded in WebhookList rows.
 */
export const DeliveryHistoryRow = React.memo(function DeliveryHistoryRow({
  webhookId,
}: DeliveryHistoryRowProps) {
  const queryClient = useQueryClient()
  const query = useWebhooksControllerListDeliveries(webhookId)
  // Type-less due to Orval mapping List → unknown[]; treat as Delivery[].
  const deliveries = (query.data ?? []) as unknown as Delivery[]

  const replayMutation = useMutation({
    mutationFn: ({ deliveryId }: { deliveryId: string }) =>
      webhooksControllerReplayDelivery(webhookId, deliveryId),
    onSuccess: () => {
      toast.success('Delivery zakolejkowany do ponownego wysłania.')
      // Refresh deliveries list — the new attempt will appear shortly.
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: getWebhooksControllerListDeliveriesQueryKey(webhookId),
        })
      }, 2000)
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Replay nie powiódł się.')
    },
  })

  if (query.isLoading) return <Skeleton className="h-24 w-full" />

  if (deliveries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-neutral-500">
        Brak dostarczeń. Pojawią się tu po pierwszym zdarzeniu.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Ostatnie dostarczenia ({deliveries.length})
      </p>
      <div className="overflow-hidden rounded border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Zdarzenie</th>
              <th className="px-3 py-2 font-medium">Próby</th>
              <th className="px-3 py-2 font-medium">Czas</th>
              <th className="px-3 py-2 font-medium">Odpowiedź</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-b border-neutral-100 last:border-b-0">
                <td className="px-3 py-2">
                  <DeliveryStatus statusCode={d.statusCode} />
                </td>
                <td className="px-3 py-2">
                  <code className="text-neutral-700">{d.event}</code>
                </td>
                <td className="px-3 py-2 tabular-nums text-neutral-500">{d.attempts}</td>
                <td className="px-3 py-2 text-neutral-500">{formatTime(d.createdAt)}</td>
                <td className="px-3 py-2 text-neutral-500">
                  <code className="line-clamp-1 max-w-xs break-all text-xs">
                    {d.response ?? '—'}
                  </code>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => replayMutation.mutate({ deliveryId: d.id })}
                    disabled={replayMutation.isPending}
                    title="Ponow doustaczanie z tym samym payloadem"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
DeliveryHistoryRow.displayName = 'DeliveryHistoryRow'

const DeliveryStatus = React.memo(function DeliveryStatus({
  statusCode,
}: {
  statusCode: number | null
}) {
  if (statusCode === null) {
    return (
      <span className="inline-flex items-center gap-1 text-neutral-500">
        <Clock className="h-3 w-3" />
        Pending
      </span>
    )
  }
  if (statusCode >= 200 && statusCode < 300) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        {statusCode}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-600">
      <XCircle className="h-3 w-3" />
      {statusCode}
    </span>
  )
})
DeliveryStatus.displayName = 'DeliveryStatus'

function formatTime(value: unknown): string {
  if (!value) return '—'
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
