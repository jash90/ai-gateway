import { createFileRoute } from '@tanstack/react-router'
import { useAuthStore } from '@shared/stores/auth-store'

function SettingsPage() {
  // Read account directly from the auth store — it's already hydrated from the
  // /v1/auth/login response. No /v1/auth/me roundtrip needed unless we suspect
  // server-side changes (role escalation etc.), which is a separate concern.
  const account = useAuthStore((s) => s.account)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Ustawienia</h1>
        <p className="text-sm text-neutral-500">Zarządzaj kontem i preferencjami</p>
      </div>

      <div className="max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">Informacje o koncie</h2>
        {account ? (
          <div className="mt-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Email</span>
              <span className="font-medium text-neutral-900">{account.email}</span>
            </div>
            {account.name && (
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Imię</span>
                <span className="font-medium text-neutral-900">{account.name}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Rola</span>
              <span className="font-medium text-neutral-900">
                {account.role === 'ADMIN' ? 'Administrator' : 'Użytkownik'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-500">Email zweryfikowany</span>
              <span className="font-medium text-neutral-900">
                {account.emailVerified ? 'Tak' : 'Nie'}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">Brak danych konta.</p>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/settings/')({
  component: SettingsPage,
})
