import * as React from 'react'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { XCircle } from 'lucide-react'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@shared/ui/Form'
import { Button } from '@shared/ui/Button'
import { Input } from '@shared/ui/Input'
import { passwordSchema, matchesPassword } from '@shared/validation'
import { ApiError } from '@shared/lib/api-fetch'
import { resetPassword } from '@features/auth/services/auth.service'

const resetSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine(matchesPassword, {
    message: 'Hasła nie są zgodne.',
    path: ['confirmPassword'],
  })

type ResetFormValues = z.infer<typeof resetSchema>

interface ResetPasswordFormProps {
  token: string | undefined
}

/**
 * Reset-password form. Token comes from URL like /reset-password?token=...
 * On success, redirect to /login with a "password changed" toast. Backend also
 * revokes all refresh tokens for this account, so any other open sessions die.
 */
export const ResetPasswordForm = React.memo(function ResetPasswordForm({
  token,
}: ResetPasswordFormProps) {
  const navigate = useNavigate()
  const form = useZodForm(resetSchema, {
    defaultValues: { password: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ResetFormValues) =>
      resetPassword({ token: token!, newPassword: values.password }),
    onSuccess: () => {
      toast.success('Hasło zostało zmienione. Zaloguj się nowym hasłem.')
      void navigate({ to: '/login' })
    },
    onError: (err) => {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nie udało się zmienić hasła. Spróbuj ponownie.'
      toast.error(message)
    },
  })

  const onSubmit = (values: ResetFormValues) => {
    if (!token) return
    mutation.mutate(values)
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="w-full max-w-sm space-y-4 text-center">
          <XCircle className="mx-auto h-12 w-12 text-red-600" />
          <h1 className="text-xl font-semibold text-neutral-900">
            Brak tokena resetującego
          </h1>
          <p className="text-sm text-neutral-600">
            Link jest niekompletny. Poproś o nowy link w sekcji „Zapomniałem
            hasła".
          </p>
          <Button asChild className="w-full">
            <a href="/forgot-password">Poproś o nowy link</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">Nowe hasło</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Ustaw hasło dla swojego konta. Wszystkie inne sesje zostaną
            zakończone.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nowe hasło</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Min. 12 znaków, w tym mała litera, wielka litera i cyfra.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Powtórz hasło</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Zmienianie...' : 'Zmień hasło'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
})
ResetPasswordForm.displayName = 'ResetPasswordForm'
