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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import { Button } from '@shared/ui/Button'
import { Input } from '@shared/ui/Input'
import { ApiError } from '@shared/lib/api-fetch'
import {
  providerKeysControllerCreate,
  getProviderKeysControllerListQueryKey,
} from '@gen/api'

const providerKeyFormSchema = z
  .object({
    provider: z.enum(['OPENAI', 'ANTHROPIC', 'OPENROUTER']),
    key: z.string().min(20, 'Klucz wygląda zbyt krótko.').max(500),
    label: z.string().trim().max(80).optional(),
  })
  .refine(
    (data) => {
      const patterns = {
        OPENAI: /^sk-/,
        ANTHROPIC: /^sk-ant-/,
        OPENROUTER: /^sk-or-/,
      }
      return patterns[data.provider].test(data.key)
    },
    {
      message: 'Klucz nie pasuje do wybranego providera (sprawdź prefix).',
      path: ['key'],
    },
  )

type ProviderKeyFormValues = z.infer<typeof providerKeyFormSchema>

interface ProviderKeyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select a provider (e.g. user clicked "Replace OpenAI key"). */
  initialProvider?: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
}

const PROVIDER_HINTS: Record<'OPENAI' | 'ANTHROPIC' | 'OPENROUTER', string> = {
  OPENAI: 'Format: sk-... (z https://platform.openai.com/api-keys)',
  ANTHROPIC: 'Format: sk-ant-... (z https://console.anthropic.com/settings/keys)',
  OPENROUTER: 'Format: sk-or-... (z https://openrouter.ai/keys)',
}

/**
 * Modal form for adding / replacing a BYOK provider key.
 *
 * Note: backend uses `(accountId, provider) UNIQUE`, so creating an OpenAI key
 * when one already exists silently REPLACES it (upsert semantics). UI surfaces
 * this as "Save" — no separate edit flow needed.
 */
export const ProviderKeyForm = React.memo(function ProviderKeyForm({
  open,
  onOpenChange,
  initialProvider,
}: ProviderKeyFormProps) {
  const queryClient = useQueryClient()

  const form = useZodForm(providerKeyFormSchema, {
    defaultValues: {
      provider: initialProvider ?? 'OPENAI',
      key: '',
      label: '',
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        provider: initialProvider ?? 'OPENAI',
        key: '',
        label: '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProvider])

  const provider = form.watch('provider')

  const mutation = useMutation({
    mutationFn: (values: ProviderKeyFormValues) =>
      providerKeysControllerCreate({
        provider: values.provider,
        key: values.key,
        ...(values.label ? { label: values.label } : {}),
      }),
    onSuccess: () => {
      toast.success('Klucz BYOK zapisany.')
      void queryClient.invalidateQueries({ queryKey: getProviderKeysControllerListQueryKey() })
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zapisać klucza.',
      )
    },
  })

  const onSubmit = (values: ProviderKeyFormValues) => mutation.mutate(values)

  return (
    <Dialog open={open} onOpenChange={mutation.isPending ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dodaj klucz BYOK</DialogTitle>
          <DialogDescription>
            Twój klucz API do providera (OpenAI / Anthropic / OpenRouter). Zostanie
            zaszyfrowany AES-256-GCM i nigdy nie opuści naszego serwera w jawnej formie.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="OPENAI">OpenAI</SelectItem>
                      <SelectItem value="ANTHROPIC">Anthropic</SelectItem>
                      <SelectItem value="OPENROUTER">OpenRouter</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Klucz API</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="sk-..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{PROVIDER_HINTS[provider]}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Etykieta (opcjonalnie)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="np. Production OpenAI"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {mutation.isPending ? 'Zapisywanie...' : 'Zapisz klucz'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
})
ProviderKeyForm.displayName = 'ProviderKeyForm'
