import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { ApiError } from '@shared/lib/api-fetch'
import { verifyEmail } from '@features/auth/services/auth.service'

interface VerifyEmailScreenProps {
  token: string | undefined
}

/**
 * Auto-submits the token from the URL on mount and renders one of three states:
 *   - loading   — request in flight
 *   - success   — green check + CTA to login
 *   - error     — red X + reason + CTA to register
 *
 * URL contract: /verify-email?token=<opaque-32-bytes-base64url>
 * Backend: POST /v1/auth/verify-email body { token } → { verified: true } or 400
 */
export const VerifyEmailScreen = React.memo(function VerifyEmailScreen({
  token,
}: VerifyEmailScreenProps) {
  const mutation = useMutation({
    mutationFn: (t: string) => verifyEmail(t),
  })

  // Auto-fire once on mount when token is present.
  React.useEffect(() => {
    if (token && mutation.isIdle) {
      mutation.mutate(token)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm space-y-6 text-center">
        {!token ? (
          <ErrorState
            title="Brak tokena weryfikacyjnego"
            description="Link weryfikacyjny wygląda na niekompletny. Sprawdź email lub poproś o nowy link."
          />
        ) : mutation.isPending || mutation.isIdle ? (
          <LoadingState />
        ) : mutation.isSuccess ? (
          <SuccessState />
        ) : (
          <ErrorState
            title="Nie udało się zweryfikować"
            description={
              mutation.error instanceof ApiError
                ? mutation.error.message
                : 'Link wygasł lub jest nieprawidłowy. Poproś o nowy.'
            }
          />
        )}
      </div>
    </div>
  )
})
VerifyEmailScreen.displayName = 'VerifyEmailScreen'

function LoadingState() {
  return (
    <>
      <Loader2 className="mx-auto h-12 w-12 animate-spin text-neutral-400" />
      <h1 className="text-xl font-semibold text-neutral-900">
        Weryfikujemy Twój email...
      </h1>
      <p className="text-sm text-neutral-500">To zajmie chwilę.</p>
    </>
  )
}

function SuccessState() {
  return (
    <>
      <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
      <h1 className="text-xl font-semibold text-neutral-900">
        Email zweryfikowany
      </h1>
      <p className="text-sm text-neutral-600">
        Twoje konto jest gotowe. Możesz się teraz zalogować.
      </p>
      <Button asChild className="w-full">
        <a href="/login">Przejdź do logowania</a>
      </Button>
    </>
  )
}

function ErrorState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <>
      <XCircle className="mx-auto h-12 w-12 text-red-600" />
      <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
      <p className="text-sm text-neutral-600">{description}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" asChild>
          <a href="/login">Logowanie</a>
        </Button>
        <Button className="flex-1" asChild>
          <a href="/register">Załóż nowe</a>
        </Button>
      </div>
    </>
  )
}
