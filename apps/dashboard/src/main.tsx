import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { routeTree } from './routeTree.gen'
import { createQueryClient } from '@shared/lib/query-client'
import { useAuthStore } from '@shared/stores/auth-store'
import { refreshTokens } from '@shared/lib/refresh'
import { ConfirmProvider } from '@shared/ui/ConfirmDialog'
import './styles/app.css'

const queryClient = createQueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

/**
 * Bootstrap: rehydrate the access token via /v1/auth/refresh BEFORE rendering.
 *
 * Why: the access token is intentionally NOT persisted (only refresh + account
 * are). Without this, the first /v1/* request after page reload would 401, then
 * customFetch's reactive refresh would kick in. That works, but costs an extra
 * roundtrip on every page load. Doing it once at boot is cleaner.
 *
 * Trade-off: ~150ms before the app paints. Acceptable — reload is rare.
 */
async function bootstrap() {
  await useAuthStore.persist.rehydrate()
  const { refreshToken, refreshExpiresAt } = useAuthStore.getState()
  if (refreshToken && refreshExpiresAt && refreshExpiresAt > Date.now()) {
    try {
      await refreshTokens()
    } catch {
      // refreshTokens already cleared the store and redirected; nothing to do.
    }
  }
}

const rootElement = document.getElementById('root')!

void bootstrap().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <RouterProvider router={router} />
          <Toaster position="top-right" richColors />
        </ConfirmProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
