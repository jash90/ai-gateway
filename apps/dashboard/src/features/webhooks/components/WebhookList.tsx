import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Webhook,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { EmptyState } from '@shared/components/EmptyState'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useWebhooksControllerList,
  webhooksControllerDelete,
  getWebhooksControllerListQueryKey,
} from '@gen/api'
import type { WebhookSummaryDto } from '@gen/api.schemas'
import { WebhookForm } from './WebhookForm'
import { WebhookSecretReveal } from './WebhookSecretReveal'
import { DeliveryHistoryRow } from './DeliveryHistoryRow'

export const WebhookList = React.memo(function WebhookList() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<WebhookSummaryDto | null>(null)
  const [secretToReveal, setSecretToReveal] = React.useState<string | null>(null)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const query = useWebhooksControllerList()
  const webhooks = query.data ?? []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksControllerDelete(id),
    onSuccess: () => {
      toast.success('Webhook usunięty.')
      void queryClient.invalidateQueries({ queryKey: getWebhooksControllerListQueryKey() })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się usunąć webhooka.',
      )
    },
  })

  const handleDelete = async (id: string, url: string) => {
    const ok = await confirm({
      title: 'Usunąć webhook?',
      description: `Webhook z URL ${url} przestanie odbierać zdarzenia. Tej operacji nie da się cofnąć.`,
      confirmLabel: 'Usuń webhook',
      destructive: true,
    })
    if (ok) deleteMutation.mutate(id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Webhooki</h1>
          <p className="text-sm text-neutral-500">
            HTTP POSTy z HMAC signature do Twoich endpointów na zdarzenia w
            systemie.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Nowy webhook
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={<Webhook className="h-12 w-12 text-neutral-400" />}
          title="Brak webhooków"
          description="Skonfiguruj webhook, aby otrzymywać zdarzenia (usage, errors, key events) na swoim endpointzie."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Skonfiguruj pierwszy webhook
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => {
            const expanded = expandedId === wh.id
            return (
              <Card key={wh.id}>
                <CardContent className="p-0">
                  <div className="flex items-start justify-between p-5">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(expanded ? null : wh.id)}
                          className="-ml-1 rounded p-1 hover:bg-neutral-100"
                          aria-label={expanded ? 'Zwiń' : 'Rozwiń'}
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        <code className="truncate font-mono text-sm text-neutral-900">
                          {wh.url}
                        </code>
                        {!wh.isActive && (
                          <Badge variant="secondary" className="bg-neutral-100">
                            Wyłączony
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-7">
                        {wh.events.map((evt) => (
                          <code
                            key={evt}
                            className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs"
                          >
                            {evt}
                          </code>
                        ))}
                      </div>
                      <div className="pl-7 text-xs text-neutral-500">
                        <LastDeliveryStatus webhook={wh} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(wh)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(wh.id, wh.url)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-neutral-100 bg-neutral-50 p-4">
                      <DeliveryHistoryRow webhookId={wh.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <WebhookForm
        open={creating}
        onOpenChange={setCreating}
        onSecretRevealed={setSecretToReveal}
      />
      <WebhookForm
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        webhook={editing}
      />
      <WebhookSecretReveal
        open={secretToReveal !== null}
        secret={secretToReveal}
        onAcknowledge={() => setSecretToReveal(null)}
      />
    </div>
  )
})
WebhookList.displayName = 'WebhookList'

const LastDeliveryStatus = React.memo(function LastDeliveryStatus({
  webhook,
}: {
  webhook: WebhookSummaryDto
}) {
  if (!webhook.lastDelivery) {
    return <span>Brak dostarczeń.</span>
  }
  const ld = webhook.lastDelivery
  const success = ld.statusCode != null && ld.statusCode >= 200 && ld.statusCode < 300
  const Icon = success ? CheckCircle2 : ld.statusCode == null ? Clock : XCircle
  const color = success ? 'text-emerald-600' : ld.statusCode == null ? 'text-neutral-500' : 'text-red-600'
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      Ostatnie: <code className="text-xs">{ld.event}</code> →{' '}
      {ld.statusCode != null ? `HTTP ${ld.statusCode}` : 'pending'}{' '}
      <span className="text-neutral-400">· {formatRelative(ld.createdAt)}</span>
    </span>
  )
})
LastDeliveryStatus.displayName = 'LastDeliveryStatus'

function formatRelative(value: unknown): string {
  if (!value) return ''
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'przed chwilą'
  if (mins < 60) return `${mins} min temu`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h temu`
  return d.toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })
}
