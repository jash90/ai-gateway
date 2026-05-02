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
  alertsControllerCreate,
  alertsControllerUpdate,
  alertsControllerDryRun,
  useApplicationsControllerList,
  getAlertsControllerListQueryKey,
} from '@gen/api'
import type { AlertSummaryDto, DryRunResponseDto } from '@gen/api.schemas'
import { FlaskConical } from 'lucide-react'

type AlertType = 'USAGE_THRESHOLD' | 'DAILY_LIMIT' | 'ERROR_RATE_HIGH' | 'LATENCY_P95_HIGH'
type AlertChannel = 'EMAIL' | 'WEBHOOK' | 'BOTH'

const ALERT_TYPE_META: Record<AlertType, { label: string; unit: string; hint: string; example: string }> = {
  USAGE_THRESHOLD: {
    label: 'Próg miesięczny (USAGE_THRESHOLD)',
    unit: 'centy',
    hint: 'Wyzwala się gdy łączny koszt USD od początku miesiąca przekroczy próg.',
    example: 'np. 5000 = $50',
  },
  DAILY_LIMIT: {
    label: 'Limit dzienny (DAILY_LIMIT)',
    unit: 'centy',
    hint: 'Wyzwala się gdy łączny koszt z ostatnich 24h przekroczy próg.',
    example: 'np. 1000 = $10',
  },
  ERROR_RATE_HIGH: {
    label: 'Wysoki error rate (ERROR_RATE_HIGH)',
    unit: 'punkty bazowe (1% = 100 bps)',
    hint: 'Wyzwala się gdy procent błędów (4xx + 5xx) w ostatniej godzinie przekroczy próg. Wymaga min. 50 requestów.',
    example: 'np. 500 = 5%',
  },
  LATENCY_P95_HIGH: {
    label: 'Wysoka latencja p95 (LATENCY_P95_HIGH)',
    unit: 'milisekundy',
    hint: 'Wyzwala się gdy 95th percentile latencji w ostatniej godzinie przekroczy próg. Wymaga min. 50 requestów.',
    example: 'np. 5000 = 5 s',
  },
}

const alertFormSchema = z.object({
  type: z.enum(['USAGE_THRESHOLD', 'DAILY_LIMIT', 'ERROR_RATE_HIGH', 'LATENCY_P95_HIGH']),
  threshold: z.coerce.number().int().positive({ message: 'Próg musi być dodatnią liczbą całkowitą.' }),
  applicationId: z.string().uuid().nullable().optional(),
  channel: z.enum(['EMAIL', 'WEBHOOK', 'BOTH']),
  isActive: z.boolean().optional(),
})

type AlertFormValues = z.infer<typeof alertFormSchema>

interface AlertFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  alert?: AlertSummaryDto | null
}

export const AlertForm = React.memo(function AlertForm({
  open,
  onOpenChange,
  alert,
}: AlertFormProps) {
  const isEdit = Boolean(alert)
  const queryClient = useQueryClient()
  const appsQuery = useApplicationsControllerList({})
  const apps = appsQuery.data ?? []

  const form = useZodForm(alertFormSchema, {
    defaultValues: {
      type: (alert?.type as AlertType) ?? 'USAGE_THRESHOLD',
      threshold: alert?.threshold ?? 5000,
      applicationId: alert?.applicationId ?? null,
      channel: (alert?.channel as AlertChannel) ?? 'EMAIL',
      isActive: alert?.isActive ?? true,
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        type: (alert?.type as AlertType) ?? 'USAGE_THRESHOLD',
        threshold: alert?.threshold ?? 5000,
        applicationId: alert?.applicationId ?? null,
        channel: (alert?.channel as AlertChannel) ?? 'EMAIL',
        isActive: alert?.isActive ?? true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alert?.id])

  const type = form.watch('type')
  const meta = ALERT_TYPE_META[type as AlertType]
  const [dryRunResult, setDryRunResult] = React.useState<DryRunResponseDto | null>(null)

  const dryRunMutation = useMutation({
    mutationFn: () => {
      const values = form.getValues()
      return alertsControllerDryRun({
        type: values.type,
        threshold: values.threshold,
        applicationId: values.applicationId ?? null,
      }) as Promise<DryRunResponseDto>
    },
    onSuccess: (data) => {
      setDryRunResult(data)
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Dry-run nie powiódł się.',
      )
    },
  })

  const handleDryRun = async () => {
    const valid = await form.trigger(['type', 'threshold'])
    if (valid) dryRunMutation.mutate()
  }

  const mutation = useMutation({
    mutationFn: async (values: AlertFormValues) => {
      if (isEdit && alert) {
        return alertsControllerUpdate(alert.id, {
          threshold: values.threshold,
          applicationId: values.applicationId,
          channel: values.channel,
          isActive: values.isActive,
        })
      }
      return alertsControllerCreate({
        type: values.type,
        threshold: values.threshold,
        applicationId: values.applicationId ?? undefined,
        channel: values.channel,
        isActive: values.isActive,
      })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Reguła zaktualizowana.' : 'Reguła utworzona.')
      void queryClient.invalidateQueries({ queryKey: getAlertsControllerListQueryKey() })
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.message : 'Nie udało się zapisać reguły.',
      )
    },
  })

  const onSubmit = (values: AlertFormValues) => mutation.mutate(values)

  return (
    <Dialog open={open} onOpenChange={mutation.isPending ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edytuj regułę alertu' : 'Nowa reguła alertu'}</DialogTitle>
          <DialogDescription>
            Reguły są ewaluowane co 15 minut. Cooldown wyzwolonej reguły wynosi 6h.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Typ alertu</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isEdit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(Object.keys(ALERT_TYPE_META) as AlertType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {ALERT_TYPE_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{meta.hint}</FormDescription>
                  {isEdit && (
                    <FormDescription className="text-amber-700">
                      Typu nie można zmienić — utwórz nową regułę.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="threshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Próg ({meta.unit})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>{meta.example}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="applicationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Aplikacja (opcjonalnie)</FormLabel>
                  <Select
                    value={field.value ?? '__all__'}
                    onValueChange={(v) => field.onChange(v === '__all__' ? null : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__all__">Wszystkie aplikacje</SelectItem>
                      {apps.map((app) => (
                        <SelectItem key={app.id} value={app.id}>
                          {app.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Domyślnie reguła dotyczy całego konta. Wybierz aplikację, aby zawęzić.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kanał powiadomień</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="EMAIL">Email</SelectItem>
                      <SelectItem value="WEBHOOK">Webhook (alert.triggered)</SelectItem>
                      <SelectItem value="BOTH">Email + Webhook</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {dryRunResult && (
              <DryRunSummary result={dryRunResult} thresholdUnit={meta.unit} />
            )}

            <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDryRun}
                disabled={dryRunMutation.isPending || mutation.isPending}
              >
                <FlaskConical className="h-4 w-4" />
                {dryRunMutation.isPending ? 'Symulacja...' : 'Sprawdź (30d)'}
              </Button>
              <div className="flex gap-2">
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
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
})
AlertForm.displayName = 'AlertForm'

// =============================================================================
// Dry-run preview — inline summary of how the rule would have fired
// =============================================================================

const DryRunSummary = React.memo(function DryRunSummary({
  result,
  thresholdUnit,
}: {
  result: DryRunResponseDto
  thresholdUnit: string
}) {
  const { triggers, peak, windowDays } = result
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Symulacja — ostatnie {windowDays} dni
      </p>
      {triggers.length === 0 ? (
        <p className="text-neutral-700">
          Reguła <strong>nie wyzwoliłaby się</strong> ani razu w ostatnich{' '}
          {windowDays} dniach.
          {peak && (
            <span className="text-neutral-500">
              {' '}Najwyższy pomiar: <code>{peak.measured}</code> {thresholdUnit}.
            </span>
          )}
        </p>
      ) : (
        <div>
          <p className="text-amber-800">
            Reguła wyzwoliłaby się <strong>{triggers.length}×</strong> w ciągu
            ostatnich {windowDays} dni (z 6h cooldown):
          </p>
          <ul className="mt-1.5 max-h-32 overflow-y-auto space-y-0.5">
            {triggers.slice(0, 10).map((t) => (
              <li key={t.at} className="text-xs text-neutral-700 tabular-nums">
                <code>{new Date(t.at).toLocaleString('pl-PL')}</code> —{' '}
                <strong>{t.measured}</strong> {thresholdUnit}
              </li>
            ))}
            {triggers.length > 10 && (
              <li className="text-xs text-neutral-500">
                + {triggers.length - 10} kolejnych
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
})
DryRunSummary.displayName = 'DryRunSummary'
