import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Key, Trash2, FlaskConical, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { ProviderBadge } from '@shared/components/ProviderBadge'
import { EmptyState } from '@shared/components/EmptyState'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useProviderKeysControllerList,
  providerKeysControllerDelete,
  providerKeysControllerTest,
  getProviderKeysControllerListQueryKey,
} from '@gen/api'
import type { ProviderKeyTestResultDto } from '@gen/api.schemas'
import { ProviderKeyForm } from './ProviderKeyForm'

/**
 * Lists configured BYOK keys + actions: add new, test, delete.
 *
 * Note on "edit": backend uses (accountId, provider) UNIQUE so adding a new
 * key for an existing provider replaces the previous one. We just open the
 * Add form pre-selected to that provider.
 */
export const ProviderKeyList = React.memo(function ProviderKeyList() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [adding, setAdding] = React.useState(false)
  const [initialProvider, setInitialProvider] = React.useState<
    'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  >('OPENAI')
  const [testResult, setTestResult] = React.useState<{
    keyId: string
    result: ProviderKeyTestResultDto
  } | null>(null)

  const query = useProviderKeysControllerList()
  const keys = query.data ?? []

  const deleteMutation = useMutation({
    mutationFn: (keyId: string) => providerKeysControllerDelete(keyId),
    onSuccess: () => {
      toast.success('Klucz BYOK usunięty.')
      queryClient.invalidateQueries({ queryKey: getProviderKeysControllerListQueryKey() })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się usunąć klucza.',
      )
    },
  })

  const testMutation = useMutation({
    mutationFn: (keyId: string) => providerKeysControllerTest(keyId),
    onSuccess: (data, keyId) => {
      setTestResult({ keyId, result: data as ProviderKeyTestResultDto })
      if ((data as ProviderKeyTestResultDto).ok) {
        toast.success('Klucz działa poprawnie.')
      } else {
        toast.error('Klucz nie działa — sprawdź szczegóły poniżej.')
      }
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Test nie powiódł się.',
      )
    },
  })

  const handleDelete = async (keyId: string, provider: string) => {
    const ok = await confirm({
      title: `Usunąć klucz ${provider}?`,
      description:
        'Aplikacje używające modeli tego providera przestaną działać. ' +
        'Możesz dodać nowy klucz w dowolnym momencie.',
      confirmLabel: 'Usuń klucz',
      destructive: true,
    })
    if (ok) deleteMutation.mutate(keyId)
  }

  const handleAddOrReplace = (provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER') => {
    setInitialProvider(provider)
    setAdding(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Klucze BYOK</h1>
          <p className="text-sm text-neutral-500">
            Twoje klucze do providerów modeli (OpenAI / Anthropic / OpenRouter).
            Zaszyfrowane AES-256-GCM, deszyfrowane tylko per request.
          </p>
        </div>
        <Button onClick={() => handleAddOrReplace('OPENAI')}>
          <Plus className="h-4 w-4" />
          Dodaj klucz
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={<Key className="h-12 w-12 text-neutral-400" />}
          title="Brak skonfigurowanych kluczy BYOK"
          description="Dodaj klucz do co najmniej jednego providera, aby gateway mógł wywoływać modele."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Dodaj pierwszy klucz
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Etykieta</th>
                  <th className="px-4 py-3 font-medium">Ostatnio użyty</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <React.Fragment key={k.id}>
                    <tr className="border-b border-neutral-100 last:border-b-0">
                      <td className="px-4 py-3">
                        <ProviderBadge provider={k.provider} />
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{k.label ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-500">
                        {formatDateOrDash(k.lastUsedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => testMutation.mutate(k.id)}
                            disabled={testMutation.isPending}
                          >
                            <FlaskConical className="h-4 w-4" />
                            Testuj
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAddOrReplace(k.provider)}
                          >
                            Wymień
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(k.id, k.provider)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {testResult?.keyId === k.id && (
                      <tr className="bg-neutral-50">
                        <td colSpan={4} className="px-4 py-3">
                          <TestResultRow result={testResult.result} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <ProviderKeyForm
        open={adding}
        onOpenChange={setAdding}
        initialProvider={initialProvider}
      />
    </div>
  )
})
ProviderKeyList.displayName = 'ProviderKeyList'

const TestResultRow = React.memo(function TestResultRow({
  result,
}: {
  result: ProviderKeyTestResultDto
}) {
  if (result.ok) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium text-emerald-700">Klucz działa</p>
          {result.sampleModels && result.sampleModels.length > 0 && (
            <p className="mt-1 text-neutral-500">
              Provider zwrócił {result.sampleModels.length} modeli (próbka):{' '}
              <code className="text-xs">{result.sampleModels.slice(0, 3).join(', ')}</code>
              {result.sampleModels.length > 3 && '…'}
            </p>
          )}
        </div>
      </div>
    )
  }

  const messages: Record<string, string> = {
    INVALID_KEY: 'Provider odrzucił klucz jako nieprawidłowy. Sprawdź czy nie został zrotowany.',
    RATE_LIMITED: 'Provider zwrócił rate limit — spróbuj ponownie za chwilę.',
    NETWORK_ERROR: 'Nie udało się dotrzeć do providera (timeout lub problem sieciowy).',
    UNKNOWN: `Provider zwrócił błąd ${result.upstreamStatus ?? '?'}.`,
  }
  return (
    <div className="flex items-start gap-2 text-sm">
      <XCircle className="h-5 w-5 shrink-0 text-red-600" />
      <div>
        <p className="font-medium text-red-700">
          {messages[result.errorCode ?? 'UNKNOWN'] ?? messages.UNKNOWN}
        </p>
        {result.upstreamStatus && (
          <p className="mt-1 text-xs text-neutral-500">
            Upstream HTTP {result.upstreamStatus}
          </p>
        )}
      </div>
    </div>
  )
})
TestResultRow.displayName = 'TestResultRow'

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
