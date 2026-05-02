import * as React from 'react'
import { z } from 'zod'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@shared/ui/Form'
import { Button } from '@shared/ui/Button'
import { Input } from '@shared/ui/Input'
import { emailSchema } from '@shared/validation'
import { useAuthStore } from '@shared/stores/auth-store'
import { ApiError } from '@shared/lib/api-fetch'
import { login } from '@features/auth/services/auth.service'

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Hasło jest wymagane.' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export const LoginForm = React.memo(function LoginForm() {
  const navigate = useNavigate()
  const setLogin = useAuthStore((s) => s.login)

  const form = useZodForm(loginSchema, {
    defaultValues: { email: '', password: '' },
  })

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      // FE-S1-006 / Bugfix #2: hydrate account from /login response, no /me roundtrip.
      setLogin(data)
      toast.success('Zalogowano pomyślnie.')
      void navigate({ to: '/overview' })
    },
    onError: (err) => {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nie udało się zalogować. Spróbuj ponownie.'
      toast.error(message)
    },
  })

  const onSubmit = (values: LoginFormValues) => {
    mutation.mutate(values)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">AI Gateway</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Zaloguj się do swojego konta
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="ty@firma.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hasło</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
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
              {mutation.isPending ? 'Logowanie...' : 'Zaloguj się'}
            </Button>

            <div className="flex justify-between text-sm">
              <a
                href="/forgot-password"
                className="text-neutral-600 hover:text-neutral-900 hover:underline"
              >
                Zapomniałeś hasła?
              </a>
              <a
                href="/register"
                className="text-neutral-600 hover:text-neutral-900 hover:underline"
              >
                Utwórz konto
              </a>
            </div>
          </form>
        </Form>
      </div>
    </div>
  )
})
LoginForm.displayName = 'LoginForm'
