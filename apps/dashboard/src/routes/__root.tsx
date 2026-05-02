import { createRootRouteWithContext, Outlet, useRouter } from '@tanstack/react-router'
import { useAuthStore } from '@shared/stores/auth-store'
import { Sidebar } from '@shared/components/Sidebar'
import { Topbar } from '@shared/components/Topbar'
import { ErrorBoundary } from '@shared/components/ErrorBoundary'
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'

interface RouterContext {
  queryClient: QueryClient
}

function RootLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())
  const router = useRouter()
  const pathname = router.state.location.pathname
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)

  const isPublicRoute =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/verify-email' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password'

  React.useEffect(() => {
    if (!isPublicRoute && !isAuthenticated) {
      router.navigate({ to: '/login' })
    }
  }, [isPublicRoute, isAuthenticated, router])

  if (!isPublicRoute && !isAuthenticated) {
    return null
  }

  return (
    <>
      {isPublicRoute ? (
        <Outlet />
      ) : (
        <div className="flex h-screen bg-neutral-50">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar onMenuToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>
        </div>
      )}
    </>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})
