import * as React from 'react'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
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
import { forgotPassword } from '@features/auth/services/auth.service'

const forgotSchema = z.object({ email: emailSchema })
type ForgotFormValues = z.infer<typeof forgotSchema>

/**
 * Forgot-password form. After submit, ALWAYS shows the same generic message
 * regardless of whether the email exists in the DB — anti-enumeration.
 * Backend mirror: POST /v1/auth/forgot-password also always 200.
 */
export const ForgotPasswordForm = React.memo(function ForgotPasswordForm() {
  const [submitted, setSubmitted] = React.useState(false)

  const form = useZodForm(forgotSchema, { defaultValues: { email: '' } })

  const mutation = useMutation({
    mutationFn: (values: ForgotFormValues) => forgotPassword(values.email),
    // Always treat as success — don't expose whether email exists.
    onSettled: () => setSubmitted(true),
  })

  const onSubmit = (values: ForgotFormValues) => {
    mutation.mutate(values)
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="w-full max-w-sm space-y-4 text-center">
          <Mail className="mx-auto h-12 w-12 text-neutral-400" />
          <h1 className="text-xl font-semibold text-neutral-900">Sprawdź skrzynkę</h1>
          <p className="text-sm text-neutral-600">
            Jeśli ten adres jest zarejestrowany w naszej bazie, wysłaliśmy link do
            zresetowania hasła. Link wygaśnie za godzinę.
          </p>
          <a
            href="/login"
            className="inline-block pt-2 text-sm text-neutral-700 hover:text-neutral-900 hover:underline"
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
          <h1 className="text-2xl font-bold text-neutral-900">Resetowanie hasła</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Podaj adres email konta, do którego chcesz odzyskać dostęp.
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

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Wysyłanie...' : 'Wyślij link resetujący'}
            </Button>

            <p className="text-center text-sm text-neutral-500">
              Pamiętasz hasło?{' '}
              <a href="/login" className="text-neutral-900 underline">
                Zaloguj się
              </a>
            </p>
          </form>
        </Form>
      </div>
    </div>
  )
})
ForgotPasswordForm.displayName = 'ForgotPasswordForm'
