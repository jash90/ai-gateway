import * as React from 'react'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
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
import { ApiError } from '@shared/lib/api-fetch'
import {
  webhooksControllerCreate,
  webhooksControllerUpdate,
  getWebhooksControllerListQueryKey,
} from '@gen/api'
import type {
  WebhookSummaryDto,
  CreateWebhookDtoEventsItem,
  UpdateWebhookDtoEventsItem,
} from '@gen/api.schemas'

const WEBHOOK_EVENTS = [
  { value: 'usage.recorded', label: 'usage.recorded', hint: 'Każdy zakończony request gateway' },
  { value: 'request.error', label: 'request.error', hint: 'Errory 4xx/5xx z gateway' },
  { value: 'provider_key.invalid', label: 'provider_key.invalid', hint: 'Twój BYOK key odrzucony przez providera' },
  { value: 'application.created', label: 'application.created', hint: 'Nowa aplikacja utworzona' },
  { value: 'application.deleted', label: 'application.deleted', hint: 'Aplikacja usunięta' },
  { value: 'key.created', label: 'key.created', hint: 'Wygenerowano klucz API' },
  { value: 'key.revoked', label: 'key.revoked', hint: 'Klucz API cofnięty' },
  { value: 'alert.triggered', label: 'alert.triggered', hint: 'Reguła alertu wyzwolona' },
] as const

const eventValues = WEBHOOK_EVENTS.map((e) => e.value) as [string, ...string[]]

const webhookFormSchema = z.object({
  url: z.string().url({ message: 'URL musi być prawidłowy (https://...).' }),
  events: z
    .array(z.enum(eventValues))
    .min(1, { message: 'Wybierz przynajmniej jedno zdarzenie.' }),
  isActive: z.boolean().optional(),
})

type WebhookFormValues = z.infer<typeof webhookFormSchema>

interface WebhookFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  webhook?: WebhookSummaryDto | null
  /** Called with the plaintext secret when create succeeds (only on create, not edit). */
  onSecretRevealed?: (secret: string) => void
}

export const WebhookForm = React.memo(function WebhookForm({
  open,
  onOpenChange,
  webhook,
  onSecretRevealed,
}: WebhookFormProps) {
  const isEdit = Boolean(webhook)
  const queryClient = useQueryClient()

  const form = useZodForm(webhookFormSchema, {
    defaultValues: {
      url: webhook?.url ?? '',
      events: (webhook?.events as string[] | undefined) ?? [],
      isActive: webhook?.isActive ?? true,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        url: webhook?.url ?? '',
        events: (webhook?.events as string[] | undefined) ?? [],
        isActive: webhook?.isActive ?? true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, webhook?.id])

  const mutation = useMutation({
    mutationFn: async (values: WebhookFormValues) => {
      if (isEdit && webhook) {
        return webhooksControllerUpdate(webhook.id, {
          url: values.url,
          events: values.events as UpdateWebhookDtoEventsItem[],
          isActive: values.isActive,
        })
      }
      return webhooksControllerCreate({
        url: values.url,
        events: values.events as CreateWebhookDtoEventsItem[],
        isActive: values.isActive,
      })
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: getWebhooksControllerListQueryKey() })
      onOpenChange(false)
      if (isEdit) {
        toast.success('Webhook zaktualizowany.')
      } else {
        toast.success('Webhook utworzony.')
        const secret = (data as { secret?: string }).secret
        if (secret && onSecretRevealed) {
          onSecretRevealed(secret)
        }
      }
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zapisać webhooka.',
      )
    },
  })

  const onSubmit = (values: WebhookFormValues) => mutation.mutate(values)

  return (
    <Dialog open={open} onOpenChange={mutation.isPending ? undefined : onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj webhook' : 'Nowy webhook'}</DialogTitle>
          <DialogDescription>
            Wybierz zdarzenia, które mają być wysyłane na Twój URL. Każdy POST
            zawiera HMAC-SHA256 signature w headerze{' '}
            <code className="text-xs">X-Raccoon-Signature</code>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL</FormLabel>
                  <FormControl>
                    <Input
                      type="url"
                      placeholder="https://hooks.example.com/raccoon"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="events"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Zdarzenia</FormLabel>
                  <FormDescription>
                    Wybierz, które zdarzenia mają być wysyłane (możesz zmieniać później).
                  </FormDescription>
                  <div className="mt-2 space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                    {WEBHOOK_EVENTS.map((evt) => {
                      const checked = (field.value as string[]).includes(evt.value)
                      return (
                        <label
                          key={evt.value}
                          className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-neutral-100"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...(field.value as string[]), evt.value]
                                : (field.value as string[]).filter((v) => v !== evt.value)
                              field.onChange(next)
                            }}
                          />
                          <div>
                            <code className="text-xs font-medium text-neutral-900">
                              {evt.label}
                            </code>
                            <p className="text-xs text-neutral-500">{evt.hint}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isEdit && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.value ?? true}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                      <span className="text-neutral-700">
                        Aktywny — wstrzymanie zatrzyma wysyłki bez utraty konfiguracji.
                      </span>
                    </label>
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Anuluj
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Zapisywanie...' : isEdit ? 'Zapisz' : 'Utwórz'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
})
WebhookForm.displayName = 'WebhookForm'
