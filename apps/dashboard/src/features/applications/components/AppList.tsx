import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Plus, AppWindow, ExternalLink } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import { EmptyState } from '@shared/components/EmptyState'
import { useApplicationsControllerList } from '@gen/api'
import { AppForm } from './AppForm'

/**
 * /applications list view. Cards grid with click-through to detail.
 *
 * Empty state CTA → opens AppForm modal.
 */
function formatRelativeDate(value: unknown): string {
  if (!value) return '—'
  const d =
    typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : value instanceof Date
        ? value
        : null
  if (!d || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pl-PL', { year: 'numeric', month: 'short', day: 'numeric' })
}

export const AppList = React.memo(function AppList() {
  const [creating, setCreating] = React.useState(false)
  const query = useApplicationsControllerList({})

  const apps = query.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Aplikacje</h1>
          <p className="text-sm text-neutral-500">
            Aplikacje grupują klucze API i agregują użycie.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Nowa aplikacja
        </Button>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<AppWindow className="h-12 w-12 text-neutral-400" />}
          title="Nie masz jeszcze aplikacji"
          description="Utwórz pierwszą aplikację, aby wygenerować klucz API i zacząć korzystać z gateway."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Utwórz pierwszą aplikację
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <Link
              key={app.id}
              to="/applications/$id"
              params={{ id: app.id }}
              className="group block"
            >
              <Card className="h-full transition-all hover:border-neutral-300 hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-neutral-900">
                      {app.name}
                    </h3>
                    <ExternalLink className="h-4 w-4 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  {app.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-neutral-600">
                      {app.description}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
                    {!app.isActive && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                        Wyłączona
                      </span>
                    )}
                    <span>Utworzona {formatRelativeDate(app.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <AppForm open={creating} onOpenChange={setCreating} />
    </div>
  )
})
AppList.displayName = 'AppList'
