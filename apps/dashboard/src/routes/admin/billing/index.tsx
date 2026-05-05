import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Copy, ExternalLink, Check, AlertCircle, Package, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Input } from '@shared/ui/Input'
import { Button } from '@shared/ui/Button'
import { Badge } from '@shared/ui/Badge'
import { Skeleton } from '@shared/ui/Skeleton'
import { useAuthStore } from '@shared/stores/auth-store'
import {
  useStripeConfig,
  useUpsertStripeConfig,
} from '@features/billing/hooks/useStripeConfig'

const StripeConfigPage = React.memo(function StripeConfigPage() {
  const account = useAuthStore((s) => s.account)
  const { data, isLoading } = useStripeConfig()
  const upsert = useUpsertStripeConfig()

  const [publishableKey, setPublishableKey] = React.useState('')
  const [secretKey, setSecretKey] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [mode, setMode] = React.useState<'test' | 'live'>('test')

  // Initialize form once data loads (so we don't overwrite user typing).
  React.useEffect(() => {
    if (data) {
      setPublishableKey(data.publishableKey ?? '')
      setMode(data.mode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.publishableKey, data?.mode])

  if (account?.role !== 'ADMIN') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-neutral-600">
          Ten widok jest dostępny tylko dla kont administratora.
        </CardContent>
      </Card>
    )
  }

  const handleSave = async () => {
    const payload: Record<string, unknown> = { mode }
    // Only include `publishableKey` if it changed (avoid unnecessary writes).
    if (publishableKey !== (data?.publishableKey ?? '')) {
      payload.publishableKey = publishableKey || null
    }
    // Send secrets only when user typed something new (server keeps existing
    // value when these fields are absent).
    if (secretKey.trim()) payload.secretKey = secretKey.trim()
    if (webhookSecret.trim()) payload.webhookSecret = webhookSecret.trim()

    try {
      await upsert.mutateAsync(payload)
      setSecretKey('')
      setWebhookSecret('')
      toast.success('Konfiguracja Stripe zapisana.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się zapisać konfiguracji.')
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} skopiowane.`),
      () => toast.error('Nie udało się skopiować.'),
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Stripe — konfiguracja</h1>
        <p className="text-sm text-neutral-500">
          Wklej klucze API Stripe i zarejestruj webhook endpoint, aby zacząć przyjmować płatności.
        </p>
      </div>

      <StatusCard data={data} isLoading={isLoading} />

      {data?.isActive && (
        <Link to="/admin/billing/products">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3 p-4">
              <Package className="h-5 w-5 text-neutral-700" />
              <div className="flex-1">
                <p className="text-sm font-medium text-neutral-900">Produkty + ceny</p>
                <p className="text-xs text-neutral-500">
                  Stwórz paczki tokenów i subskrypcje (synchronizacja ze Stripe)
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-neutral-400" />
            </CardContent>
          </Card>
        </Link>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Klucze API Stripe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Publishable key"
            hint="Z Dashboardu Stripe → Developers → API keys (zaczyna się od pk_)"
          >
            <Input
              type="text"
              placeholder="pk_test_..."
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              autoComplete="off"
            />
          </FormField>

          <FormField
            label={
              <>
                Secret key{' '}
                {data?.hasSecretKey && <Badge variant="success">zapisany</Badge>}
              </>
            }
            hint="Zaczyna się od sk_. Zostanie zaszyfrowany AES-256-GCM. Wpisz ponownie tylko gdy chcesz zmienić."
          >
            <Input
              type="password"
              placeholder={data?.hasSecretKey ? '••••••••• (kliknij Zapisz aby zmienić)' : 'sk_test_...'}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="new-password"
            />
          </FormField>

          <FormField
            label={
              <>
                Webhook signing secret{' '}
                {data?.hasWebhookSecret && <Badge variant="success">zapisany</Badge>}
              </>
            }
            hint="Z Dashboardu Stripe → Developers → Webhooks → wybrany endpoint → 'Reveal signing secret' (zaczyna się od whsec_)"
          >
            <Input
              type="password"
              placeholder={data?.hasWebhookSecret ? '••••••••• (kliknij Zapisz aby zmienić)' : 'whsec_...'}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              autoComplete="new-password"
            />
          </FormField>

          <FormField label="Tryb">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'test' ? 'default' : 'outline'}
                onClick={() => setMode('test')}
              >
                Test
              </Button>
              <Button
                type="button"
                variant={mode === 'live' ? 'default' : 'outline'}
                onClick={() => setMode('live')}
              >
                Live
              </Button>
            </div>
          </FormField>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <WebhookSetupCard data={data} onCopy={copyToClipboard} />

      <DocsCard />
    </div>
  )
})
StripeConfigPage.displayName = 'StripeConfigPage'

// ─────────────────────────────────────────────────────────────────────────────

const StatusCard = React.memo(function StatusCard({
  data,
  isLoading,
}: {
  data: ReturnType<typeof useStripeConfig>['data']
  isLoading: boolean
}) {
  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-6 w-1/2" />
        </CardContent>
      </Card>
    )
  }
  const ready = data.isActive
  return (
    <Card className={ready ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}>
      <CardContent className="flex items-center gap-3 p-4">
        {ready ? (
          <Check className="h-5 w-5 text-emerald-600" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-600" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium text-neutral-900">
            {ready
              ? `Stripe gotowy (tryb: ${data.mode})`
              : 'Brakuje konfiguracji — uzupełnij klucze poniżej'}
          </p>
          <p className="text-xs text-neutral-600">
            {data.lastWebhookAt
              ? `Ostatni webhook: ${new Date(data.lastWebhookAt).toLocaleString('pl-PL')} (${data.lastWebhookEvent})`
              : 'Jeszcze nie odebrano żadnego webhooka.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
})

const WebhookSetupCard = React.memo(function WebhookSetupCard({
  data,
  onCopy,
}: {
  data: ReturnType<typeof useStripeConfig>['data']
  onCopy: (text: string, label: string) => void
}) {
  if (!data) return null
  const stripeWebhookDashboardUrl =
    data.mode === 'live'
      ? 'https://dashboard.stripe.com/webhooks'
      : 'https://dashboard.stripe.com/test/webhooks'
  const eventsString = data.requiredEvents.join('\n')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Setup webhook w Stripe Dashboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="list-inside list-decimal space-y-3 text-neutral-700">
          <li>
            Wejdź do panelu Stripe (
            <a
              href={stripeWebhookDashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-700 underline-offset-2 hover:underline"
            >
              {stripeWebhookDashboardUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
            ) i kliknij <strong>+ Add endpoint</strong>.
          </li>
          <li>
            Wklej poniższy URL jako <strong>Endpoint URL</strong>:
            <CopyRow value={data.webhookUrl} onCopy={(v) => onCopy(v, 'URL webhooka')} />
          </li>
          <li>
            W sekcji <strong>Events to send</strong> kliknij &quot;Select events&quot; i zaznacz:
            <CopyRow
              value={eventsString}
              onCopy={(v) => onCopy(v, 'Lista eventów')}
              multiline
            />
          </li>
          <li>
            Po zapisaniu kliknij endpoint w liście, sekcja <strong>Signing secret</strong> →
            &quot;Reveal&quot; → skopiuj <code className="rounded bg-neutral-100 px-1">whsec_…</code> i wklej powyżej w polu &quot;Webhook signing secret&quot;.
          </li>
          <li>
            Kliknij <strong>Zapisz</strong>. Status u góry strony zmieni się na zielony po pierwszym otrzymanym evencie. Możesz wymusić test przez &quot;Send test webhook&quot; w panelu Stripe.
          </li>
        </ol>
      </CardContent>
    </Card>
  )
})

const DocsCard = React.memo(function DocsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Co dalej?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-neutral-700">
        <p>Po skonfigurowaniu kluczy:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Stwórz produkty + ceny w sekcji <strong>Admin → Billing → Produkty</strong> (wkrótce, M5).
          </li>
          <li>
            Klienci kupują tokeny przez Stripe Checkout — UI pojawi się w <code>/settings/billing</code> (M6).
          </li>
          <li>
            Każdy webhook event (top-up, anulowanie subskrypcji) trafia do audit log, można też podpiąć
            własny endpoint w sekcji <strong>Webhooki</strong>.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
})

const CopyRow = React.memo(function CopyRow({
  value,
  onCopy,
  multiline,
}: {
  value: string
  onCopy: (v: string) => void
  multiline?: boolean
}) {
  return (
    <div className="mt-2 flex items-start gap-2">
      <pre
        className={`flex-1 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs ${multiline ? 'whitespace-pre' : 'whitespace-nowrap'}`}
      >
        {value}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onCopy(value)}
      >
        <Copy className="mr-1 h-3 w-3" />
        Skopiuj
      </Button>
    </div>
  )
})

const FormField = React.memo(function FormField({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  )
})

export const Route = createFileRoute('/admin/billing/')({
  component: StripeConfigPage,
})
