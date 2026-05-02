import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { Badge } from '@shared/ui/Badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/Tabs'
import { ComingInSprintCard } from '@shared/components/ComingInSprintCard'
import { AnalyticsDashboard } from '@features/analytics'
import { useConfirm } from '@shared/ui/ConfirmDialog'
import { ApiError } from '@shared/lib/api-fetch'
import {
  useApplicationsControllerGetById,
  applicationsControllerDelete,
  applicationsControllerUpdate,
  getApplicationsControllerListQueryKey,
  getApplicationsControllerGetByIdQueryKey,
} from '@gen/api'
import { AppForm } from './AppForm'
import { KeyList } from './KeyList'

interface AppDetailProps {
  applicationId: string
}

/**
 * /applications/:id detail view with three tabs:
 *   - Klucze: KeyList component (active CRUD)
 *   - Analityka: Sprint 3 placeholder
 *   - Ustawienia: edit name/description, toggle active, delete
 */
export const AppDetail = React.memo(function AppDetail({ applicationId }: AppDetailProps) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [editing, setEditing] = React.useState(false)

  const query = useApplicationsControllerGetById(applicationId)
  const app = query.data

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      applicationsControllerUpdate(applicationId, { isActive }),
    onSuccess: (_data, isActive) => {
      toast.success(isActive ? 'Aplikacja włączona.' : 'Aplikacja wyłączona.')
      queryClient.invalidateQueries({
        queryKey: getApplicationsControllerGetByIdQueryKey(applicationId),
      })
      queryClient.invalidateQueries({ queryKey: getApplicationsControllerListQueryKey() })
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zmienić stanu aplikacji.',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => applicationsControllerDelete(applicationId),
    onSuccess: () => {
      toast.success('Aplikacja usunięta.')
      queryClient.invalidateQueries({ queryKey: getApplicationsControllerListQueryKey() })
      navigate({ to: '/applications' })
    },
    onError: (err) => {
      const apiErr = err instanceof ApiError ? err : null
      if (apiErr?.errorCode === 'APPLICATION_HAS_USAGE') {
        toast.error(
          'Nie można usunąć — aplikacja ma zarejestrowane użycie. Wyłącz ją zamiast usuwać.',
        )
      } else {
        toast.error(apiErr?.message ?? 'Nie udało się usunąć aplikacji.')
      }
    },
  })

  const handleDelete = async () => {
    if (!app) return
    const ok = await confirm({
      title: `Usunąć aplikację „${app.name}"?`,
      description:
        'Wszystkie klucze API tej aplikacji zostaną automatycznie usunięte. ' +
        'Jeśli aplikacja ma zarejestrowane użycie, operacja zostanie zablokowana — wyłącz ją zamiast usuwać.',
      confirmLabel: 'Usuń aplikację',
      destructive: true,
    })
    if (ok) deleteMutation.mutate()
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!app) {
    return (
      <ComingInSprintCard
        pageTitle="Aplikacja nie znaleziona"
        sprintLabel=""
        description="Aplikacja o tym ID nie istnieje lub nie należy do Twojego konta."
        cta={{ label: 'Wróć do listy', href: '/applications' }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/applications"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Aplikacje
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">{app.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
              {app.description && <span>{app.description}</span>}
              {!app.isActive && <Badge variant="secondary">Wyłączona</Badge>}
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edytuj
          </Button>
        </div>
      </div>

      <Tabs defaultValue="keys" className="space-y-6">
        <TabsList>
          <TabsTrigger value="keys">Klucze</TabsTrigger>
          <TabsTrigger value="analytics">Analityka</TabsTrigger>
          <TabsTrigger value="settings">Ustawienia</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <KeyList applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsDashboard applicationId={applicationId} />
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ogólne</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">Status</p>
                  <p className="text-sm text-neutral-500">
                    {app.isActive
                      ? 'Aplikacja jest aktywna i obsługuje requesty.'
                      : 'Aplikacja jest wyłączona — wszystkie klucze odrzucają requesty.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => toggleActiveMutation.mutate(!app.isActive)}
                  disabled={toggleActiveMutation.isPending}
                >
                  {app.isActive ? 'Wyłącz' : 'Włącz'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4 border-red-200">
            <CardHeader>
              <CardTitle className="text-base text-red-700">Strefa niebezpieczna</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900">Usuń aplikację</p>
                  <p className="text-sm text-neutral-500">
                    Usuwa aplikację i wszystkie jej klucze. Nie można cofnąć.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Usuń
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AppForm open={editing} onOpenChange={setEditing} app={app} />
    </div>
  )
})
AppDetail.displayName = 'AppDetail'
