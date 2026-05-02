import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Key, Ban, ShieldOff } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { EmptyState } from '@shared/components/EmptyState'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useApplicationKeysControllerList,
  applicationKeysControllerCreate,
  applicationKeysControllerRevoke,
  getApplicationKeysControllerListQueryKey,
} from '@gen/api'
import type { ApplicationKeyCreatedDto } from '@gen/api.schemas'
import { KeyRevealModal } from './KeyRevealModal'

interface KeyListProps {
  applicationId: string
}

/**
 * Lists ApplicationKeys for a given Application + handles generate / revoke.
 *
 * Generate flow: POST /keys → KeyRevealModal (one-time reveal of plaintext) →
 * acknowledge → invalidate list query.
 *
 * Revoke flow: ConfirmDialog (destructive) → DELETE /keys/:id → invalidate.
 */
export const KeyList = React.memo(function KeyList({ applicationId }: KeyListProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [revealKey, setRevealKey] = React.useState<ApplicationKeyCreatedDto | null>(null)

  const query = useApplicationKeysControllerList(applicationId)
  const keys = query.data ?? []

  const createMutation = useMutation({
    mutationFn: () => applicationKeysControllerCreate(applicationId, {}),
    onSuccess: (data) => {
      setRevealKey(data as ApplicationKeyCreatedDto)
      void queryClient.invalidateQueries({
        queryKey: getApplicationKeysControllerListQueryKey(applicationId),
      })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się wygenerować klucza.',
      )
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => applicationKeysControllerRevoke(applicationId, keyId),
    onSuccess: () => {
      toast.success('Klucz został cofnięty.')
      void queryClient.invalidateQueries({
        queryKey: getApplicationKeysControllerListQueryKey(applicationId),
      })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się cofnąć klucza.',
      )
    },
  })

  const handleRevoke = async (keyId: string, prefix: string) => {
    const ok = await confirm({
      title: 'Cofnąć klucz?',
      description:
        `Klucz ${prefix}... przestanie działać natychmiast. ` +
        `Zapytania używające go zwrócą 401 KEY_REVOKED. Tej operacji nie da się cofnąć.`,
      confirmLabel: 'Cofnij klucz',
      destructive: true,
    })
    if (ok) revokeMutation.mutate(keyId)
  }

  const activeKeys = keys.filter((k) => !k.revokedAt)
  const revokedKeys = keys.filter((k) => k.revokedAt)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Klucze API</h2>
          <p className="text-sm text-neutral-500">
            Generuj i cofuj klucze <code className="text-xs">sk-rcn-live-...</code>.
          </p>
        </div>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          <Plus className="h-4 w-4" />
          {createMutation.isPending ? 'Generowanie...' : 'Nowy klucz'}
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<Key className="h-12 w-12 text-neutral-400" />}
          title="Brak kluczy"
          description="Wygeneruj klucz, aby zacząć korzystać z gateway w SDK."
          action={
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              <Plus className="h-4 w-4" />
              Wygeneruj klucz
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {activeKeys.length > 0 && <KeyTable keys={activeKeys} onRevoke={handleRevoke} />}
          {revokedKeys.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-700">
                Cofnięte klucze ({revokedKeys.length})
              </summary>
              <div className="mt-3">
                <KeyTable keys={revokedKeys} onRevoke={handleRevoke} />
              </div>
            </details>
          )}
        </div>
      )}

      <KeyRevealModal
        open={revealKey !== null}
        secret={revealKey?.secret ?? null}
        keyPrefix={revealKey?.keyPrefix ?? null}
        label={revealKey?.label}
        onAcknowledge={() => setRevealKey(null)}
      />
    </div>
  )
})
KeyList.displayName = 'KeyList'

// =============================================================================
// Key row (extracted for reuse between active + revoked tables)
// =============================================================================

interface KeyRow {
  id: string
  keyPrefix: string
  label: string | null
  lastUsedAt?: unknown
  expiresAt?: unknown
  revokedAt?: unknown
  createdAt: unknown
}

const KeyTable = React.memo(function KeyTable({
  keys,
  onRevoke,
}: {
  keys: KeyRow[]
  onRevoke: (keyId: string, prefix: string) => void
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-medium">Prefix</th>
              <th className="px-4 py-3 font-medium">Etykieta</th>
              <th className="px-4 py-3 font-medium">Ostatnio użyty</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-neutral-100 last:border-b-0">
                <td className="px-4 py-3">
                  <code className="font-mono text-xs">{k.keyPrefix}…</code>
                </td>
                <td className="px-4 py-3 text-neutral-700">{k.label ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-500">{formatDateOrDash(k.lastUsedAt)}</td>
                <td className="px-4 py-3">
                  {k.revokedAt ? (
                    <Badge variant="secondary" className="bg-red-50 text-red-700">
                      <ShieldOff className="mr-1 h-3 w-3" />
                      Cofnięty
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                      Aktywny
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!k.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRevoke(k.id, k.keyPrefix)}
                    >
                      <Ban className="h-4 w-4" />
                      Cofnij
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
})
KeyTable.displayName = 'KeyTable'

function formatDateOrDash(value: unknown): string {
  if (!value) return '—'
  const d = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pl-PL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
