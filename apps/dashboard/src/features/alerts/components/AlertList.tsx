import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Bell, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { EmptyState } from '@shared/components/EmptyState'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useAlertsControllerList,
  alertsControllerDelete,
  useApplicationsControllerList,
  getAlertsControllerListQueryKey,
} from '@gen/api'
import type { AlertSummaryDto } from '@gen/api.schemas'
import { AlertForm } from './AlertForm'

const TYPE_LABELS: Record<string, string> = {
  USAGE_THRESHOLD: 'Próg miesięczny',
  DAILY_LIMIT: 'Limit dzienny',
  ERROR_RATE_HIGH: 'Wysoki error rate',
  LATENCY_P95_HIGH: 'Wysoka latencja p95',
}

export const AlertList = React.memo(function AlertList() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<AlertSummaryDto | null>(null)

  const query = useAlertsControllerList()
  const appsQuery = useApplicationsControllerList({})

  const alerts = query.data ?? []
  const apps = appsQuery.data ?? []
  const appById = new Map(apps.map((a) => [a.id, a.name]))

  const deleteMutation = useMutation({
    mutationFn: (id: string) => alertsControllerDelete(id),
    onSuccess: () => {
      toast.success('Reguła usunięta.')
      queryClient.invalidateQueries({ queryKey: getAlertsControllerListQueryKey() })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się usunąć reguły.',
      )
    },
  })

  const handleDelete = async (id: string, type: string) => {
    const ok = await confirm({
      title: `Usunąć regułę ${TYPE_LABELS[type] ?? type}?`,
      description: 'Reguła przestanie być ewaluowana. Tej operacji nie da się cofnąć.',
      confirmLabel: 'Usuń regułę',
      destructive: true,
    })
    if (ok) deleteMutation.mutate(id)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Alerty</h1>
          <p className="text-sm text-neutral-500">
            Reguły wyzwalają powiadomienia gdy metryki przekroczą progi.
            Ewaluacja co 15 min, cooldown 6h.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Nowa reguła
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-12 w-12 text-neutral-400" />}
          title="Brak reguł alertów"
          description="Skonfiguruj alert, aby otrzymywać powiadomienia o przekroczeniu progów (koszt, error rate, latencja)."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Skonfiguruj pierwszą regułę
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3 font-medium">Typ</th>
                  <th className="px-4 py-3 font-medium">Próg</th>
                  <th className="px-4 py-3 font-medium">Zakres</th>
                  <th className="px-4 py-3 font-medium">Kanał</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ostatnio wyzwolone</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id} className="border-b border-neutral-100 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {TYPE_LABELS[alert.type] ?? alert.type}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-neutral-700">
                      {formatThreshold(alert.type, alert.threshold)}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {alert.applicationId
                        ? appById.get(alert.applicationId) ?? alert.applicationId.slice(0, 8) + '…'
                        : 'Wszystkie aplikacje'}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{alert.channel}</td>
                    <td className="px-4 py-3">
                      {alert.isActive ? (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                          Aktywny
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-neutral-100">
                          Wyłączony
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {alert.lastTriggered ? formatTime(alert.lastTriggered) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(alert)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(alert.id, alert.type)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <AlertForm open={creating} onOpenChange={setCreating} />
      <AlertForm
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        alert={editing}
      />
    </div>
  )
})
AlertList.displayName = 'AlertList'

function formatThreshold(type: string, value: number): string {
  switch (type) {
    case 'USAGE_THRESHOLD':
    case 'DAILY_LIMIT':
      return `$${(value / 100).toFixed(2)}`
    case 'ERROR_RATE_HIGH':
      return `${(value / 100).toFixed(2)}%`
    case 'LATENCY_P95_HIGH':
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`
    default:
      return String(value)
  }
}

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
