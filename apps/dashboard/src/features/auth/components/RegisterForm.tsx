import * as React from 'react'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { emailSchema, passwordSchema, matchesPassword } from '@shared/validation'
import { ApiError } from '@shared/lib/api-fetch'
import { register } from '@features/auth/services/auth.service'

const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    name: z
      .string()
      .trim()
      .min(1, { message: 'Imię jest wymagane.' })
      .max(80)
      .optional()
      .or(z.literal('')),
  })
  .refine(matchesPassword, {
    message: 'Hasła nie są zgodne.',
    path: ['confirmPassword'],
  })

type RegisterFormValues = z.infer<typeof registerSchema>

export const RegisterForm = React.memo(function RegisterForm() {
  const [submittedEmail, setSubmittedEmail] = React.useState<string | null>(null)

  const form = useZodForm(registerSchema, {
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      name: '',
    },
  })

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: (_data, variables) => {
      setSubmittedEmail(variables.email)
    },
    onError: (err) => {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Nie udało się utworzyć konta. Spróbuj ponownie.'
      toast.error(message)
    },
  })

  const onSubmit = (values: RegisterFormValues) => {
    // Backend expects optional `name` to be omitted when empty, not "".
    const payload = {
      email: values.email,
      password: values.password,
      ...(values.name ? { name: values.name } : {}),
    }
    mutation.mutate(payload)
  }

  // After successful registration, show "check your email" instead of the form.
  // Backend does NOT auto-login (decision: emailVerified must be true to log in).
  if (submittedEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">Sprawdź skrzynkę</h1>
          <p className="text-sm text-neutral-600">
            Wysłaliśmy link weryfikacyjny na adres{' '}
            <strong className="text-neutral-900">{submittedEmail}</strong>.
            Kliknij w link, aby aktywować konto, a następnie wróć tutaj i zaloguj się.
          </p>
          <p className="pt-2 text-xs text-neutral-500">
            Nie widzisz wiadomości? Sprawdź folder spam lub poproś o nowy link na
            stronie logowania.
          </p>
          <a
            href="/login"
            className="inline-block pt-4 text-sm text-neutral-700 hover:text-neutral-900 hover:underline"
          >
            ← Wróć do logowania
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">AI Gateway</h1>
          <p className="mt-2 text-sm text-neutral-500">Utwórz konto</p>
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Imię (opcjonalnie)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      autoComplete="name"
                      {...field}
                      value={field.value ?? ''}
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
              {mutation.isPending ? 'Tworzenie konta...' : 'Zarejestruj się'}
            </Button>

            <p className="text-center text-sm text-neutral-500">
              Masz już konto?{' '}
              <a
                href="/login"
                className="text-neutral-900 underline hover:no-underline"
              >
                Zaloguj się
              </a>
            </p>
          </form>
        </Form>
      </div>
    </div>
  )
})
RegisterForm.displayName = 'RegisterForm'
