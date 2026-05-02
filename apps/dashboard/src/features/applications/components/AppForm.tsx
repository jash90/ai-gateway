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
  applicationsControllerCreate,
  applicationsControllerUpdate,
  getApplicationsControllerListQueryKey,
  getApplicationsControllerGetByIdQueryKey,
} from '@gen/api'
import type {
  ApplicationSummaryDto,
  ApplicationListResponseDtoItem,
} from '@gen/api.schemas'

const appFormSchema = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana.').max(80, 'Maksymalnie 80 znaków.'),
  description: z.string().trim().max(500, 'Maksymalnie 500 znaków.').optional(),
})

type AppFormValues = z.infer<typeof appFormSchema>

type ExistingApp = ApplicationSummaryDto | ApplicationListResponseDtoItem

interface AppFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, the form is in edit mode. */
  app?: ExistingApp | null
  onSuccess?: (app: ApplicationSummaryDto) => void
}

/**
 * Modal form for creating or editing an Application. Used from /applications
 * (list view, "+ New" button) and /applications/:id (Settings tab).
 */
export const AppForm = React.memo(function AppForm({
  open,
  onOpenChange,
  app,
  onSuccess,
}: AppFormProps) {
  const isEdit = Boolean(app)
  const queryClient = useQueryClient()

  const form = useZodForm(appFormSchema, {
    defaultValues: {
      name: app?.name ?? '',
      description: app?.description ?? '',
    },
  })

  // Reset form when `app` changes (open same modal for a different row).
  React.useEffect(() => {
    if (open) {
      form.reset({
        name: app?.name ?? '',
        description: app?.description ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, app?.id])

  const mutation = useMutation({
    mutationFn: async (values: AppFormValues) => {
      if (isEdit && app) {
        return applicationsControllerUpdate(app.id, {
          name: values.name,
          description: values.description || null,
        })
      }
      return applicationsControllerCreate({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
      })
    },
    onSuccess: (data) => {
      toast.success(isEdit ? 'Aplikacja zaktualizowana.' : 'Aplikacja utworzona.')
      void queryClient.invalidateQueries({ queryKey: getApplicationsControllerListQueryKey() })
      if (app) {
        void queryClient.invalidateQueries({
          queryKey: getApplicationsControllerGetByIdQueryKey(app.id),
        })
      }
      onSuccess?.(data as ApplicationSummaryDto)
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zapisać aplikacji.',
      )
    },
  })

  const onSubmit = (values: AppFormValues) => mutation.mutate(values)

  return (
    <Dialog open={open} onOpenChange={mutation.isPending ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj aplikację' : 'Nowa aplikacja'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Zmień nazwę lub opis aplikacji.'
              : 'Aplikacja grupuje klucze API i zdarzenia użycia. Możesz mieć ich wiele.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nazwa</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="My Production App"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opis (opcjonalnie)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Krótki opis przeznaczenia aplikacji"
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
                {mutation.isPending ? 'Zapisywanie...' : isEdit ? 'Zapisz' : 'Utwórz'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
})
AppForm.displayName = 'AppForm'
