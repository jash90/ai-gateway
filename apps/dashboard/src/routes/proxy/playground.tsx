import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Terminal,
  Send,
  Loader2,
  AlertCircle,
  Key,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'
import { Input } from '@shared/ui/Input'
import { Badge } from '@shared/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import {
  useApplicationsControllerList,
  useApplicationKeysControllerList,
} from '@gen/api'

type RequestFormat = 'openai' | 'anthropic'

interface ModelOption {
  value: string
  label: string
  format: RequestFormat
}

const MODELS: ModelOption[] = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (OpenAI)', format: 'openai' },
  { value: 'gpt-4o', label: 'gpt-4o (OpenAI)', format: 'openai' },
  {
    value: 'claude-3-5-haiku-latest',
    label: 'claude-3-5-haiku (Anthropic)',
    format: 'anthropic',
  },
  {
    value: 'claude-3-5-sonnet-latest',
    label: 'claude-3-5-sonnet (Anthropic)',
    format: 'anthropic',
  },
  {
    value: 'openrouter/openai/gpt-4o-mini',
    label: 'OpenRouter — gpt-4o-mini',
    format: 'openai',
  },
]

interface UsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface ResultState {
  status: number
  ok: boolean
  errorCode?: string
  message?: string
  content?: string
  usage?: UsageInfo
  latencyMs: number
  requestId?: string | null
}

const PlaygroundPage = React.memo(function PlaygroundPage() {
  const apps = useApplicationsControllerList({})
  const appList = React.useMemo(() => (apps.data ?? []).filter((a) => a.isActive), [apps.data])
  const [applicationId, setApplicationId] = React.useState<string | null>(null)
  const keys = useApplicationKeysControllerList(applicationId ?? '', {
    query: { enabled: !!applicationId },
  })
  const activeKey = (keys.data ?? []).find((k) => !k.revokedAt)

  const [secret, setSecret] = React.useState('')
  const [modelValue, setModelValue] = React.useState<string>('gpt-4o-mini')
  const [systemPrompt, setSystemPrompt] = React.useState('')
  const [userMessage, setUserMessage] = React.useState(
    'Powiedz cześć po polsku, jednym słowem.',
  )
  const [maxTokens, setMaxTokens] = React.useState('128')
  const [running, setRunning] = React.useState(false)
  const [result, setResult] = React.useState<ResultState | null>(null)

  // Auto-pick first app once loaded.
  React.useEffect(() => {
    if (!applicationId && appList.length > 0) {
      setApplicationId(appList[0].id)
    }
  }, [applicationId, appList])

  const model = React.useMemo(
    () => MODELS.find((m) => m.value === modelValue) ?? MODELS[0],
    [modelValue],
  )

  const handleRun = async () => {
    if (!secret.trim()) {
      setResult({
        status: 0,
        ok: false,
        errorCode: 'NO_KEY',
        message: 'Wklej pełny klucz aplikacji (sk-rcn-live-…). Klucze są pokazywane tylko raz przy generowaniu.',
        latencyMs: 0,
      })
      return
    }
    if (!userMessage.trim()) {
      setResult({
        status: 0,
        ok: false,
        errorCode: 'EMPTY_MESSAGE',
        message: 'Wpisz wiadomość użytkownika.',
        latencyMs: 0,
      })
      return
    }

    setRunning(true)
    setResult(null)
    const t0 = performance.now()

    try {
      const url =
        model.format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'
      const body = buildBody(model, systemPrompt, userMessage, Number(maxTokens) || 128)
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${secret.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const latencyMs = Math.round(performance.now() - t0)
      const reqId = resp.headers.get('x-rcn-request-id')
      const json = await resp.json().catch(() => null) as Record<string, unknown> | null

      if (!resp.ok) {
        const code = (json?.code as string | undefined) ?? (json?.errorCode as string | undefined)
        const msg = (json?.message as string | undefined)
          ?? (typeof json?.error === 'object' && json?.error
            ? (json.error as { message?: string }).message
            : undefined)
          ?? `HTTP ${resp.status}`
        setResult({
          status: resp.status,
          ok: false,
          errorCode: code,
          message: msg,
          latencyMs,
          requestId: reqId,
        })
        return
      }

      const content = extractContent(model.format, json)
      const usage = extractUsage(model.format, json)
      setResult({
        status: resp.status,
        ok: true,
        content,
        usage,
        latencyMs,
        requestId: reqId,
      })
    } catch (err) {
      setResult({
        status: 0,
        ok: false,
        errorCode: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Math.round(performance.now() - t0),
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Playground</h1>
        <p className="text-sm text-neutral-500">
          Wyślij testowe zapytanie przez gateway (OpenAI / Anthropic / OpenRouter) używając klucza{' '}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">sk-rcn-live-…</code> swojej aplikacji.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" />
            Aplikacja + klucz
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {appList.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">Brak aktywnych aplikacji</p>
                <p className="mt-0.5 text-amber-800">
                  Utwórz aplikację w{' '}
                  <Link to="/applications" className="underline">
                    /applications
                  </Link>{' '}
                  i wygeneruj klucz API.
                </p>
              </div>
            </div>
          ) : (
            <>
              <Field label="Aplikacja">
                <Select value={applicationId ?? ''} onValueChange={setApplicationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz aplikację" />
                  </SelectTrigger>
                  <SelectContent>
                    {appList.map((app) => (
                      <SelectItem key={app.id} value={app.id}>
                        {app.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeKey && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Aktywny klucz: <code className="font-mono">{activeKey.keyPrefix}…</code>
                  </p>
                )}
              </Field>

              <Field
                label="Klucz aplikacji (pełny secret)"
                hint="Klucze są pokazywane tylko raz przy generowaniu. Wklej zachowany sekret lub wygeneruj nowy w widoku Aplikacja → Klucze."
              >
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="sk-rcn-live-…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4" />
            Zapytanie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <Field label="Model">
              <Select value={modelValue} onValueChange={setModelValue}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-neutral-500">
                Endpoint:{' '}
                <code className="font-mono">
                  {model.format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}
                </code>
              </p>
            </Field>
            <Field label="max_tokens">
              <Input
                type="number"
                min={1}
                max={4096}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="w-32"
              />
            </Field>
          </div>

          <Field label="System prompt (opcjonalny)">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={2}
              placeholder="Jesteś pomocnym asystentem…"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </Field>

          <Field label="Wiadomość użytkownika">
            <textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </Field>

          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-500">
              Gateway sprawdzi saldo, zarezerwuje tokeny, odpyta providera i rozliczy zużycie.
            </p>
            <Button onClick={handleRun} disabled={running || appList.length === 0}>
              {running ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Wysyłam…
                </>
              ) : (
                <>
                  <Send className="mr-1 h-4 w-4" />
                  Wyślij
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && <ResultCard result={result} />}
    </div>
  )
})
PlaygroundPage.displayName = 'PlaygroundPage'

const ResultCard = React.memo(function ResultCard({ result }: { result: ResultState }) {
  const [showRaw, setShowRaw] = React.useState(false)
  return (
    <Card className={result.ok ? '' : 'border-amber-200'}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {result.ok ? 'Odpowiedź modelu' : 'Błąd zapytania'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={result.ok ? 'success' : 'destructive'}>
              {result.status > 0 ? `HTTP ${result.status}` : 'Lokalny błąd'}
            </Badge>
            <Badge variant="secondary">{result.latencyMs} ms</Badge>
            {result.usage && (
              <Badge variant="default">
                tokeny: {result.usage.inputTokens}+{result.usage.outputTokens}={result.usage.totalTokens}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.ok ? (
          <>
            <pre className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm text-neutral-900">
              {result.content || '(pusta odpowiedź)'}
            </pre>
            {result.requestId && (
              <p className="text-xs text-neutral-500">
                Request ID: <code className="font-mono">{result.requestId}</code>
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2">
            {result.errorCode && (
              <p className="text-sm">
                <span className="font-medium text-neutral-900">Kod błędu:</span>{' '}
                <code className="font-mono text-amber-700">{result.errorCode}</code>
              </p>
            )}
            <p className="text-sm text-neutral-700">{result.message}</p>
            {result.errorCode === 'INSUFFICIENT_TOKEN_BALANCE' && (
              <p className="text-sm text-neutral-600">
                Brak tokenów na walletcie aplikacji ani na koncie. Doładuj saldo w{' '}
                <Link to="/settings/billing" className="underline">
                  Ustawienia → Płatności
                </Link>
                .
              </p>
            )}
            {result.errorCode === 'PROVIDER_INSUFFICIENT_FUNDS' && (
              <p className="text-sm text-neutral-600">
                Twój klucz BYOK do providera nie ma środków u dostawcy AI. Doładuj go w panelu OpenAI/Anthropic.
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${showRaw ? 'rotate-180' : ''}`} />
          {showRaw ? 'Ukryj raw' : 'Pokaż raw'}
        </button>
        {showRaw && (
          <pre className="max-h-80 overflow-auto rounded-md bg-neutral-900 p-3 font-mono text-[11px] text-neutral-100">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  )
})

const Field = React.memo(function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  )
})

function buildBody(
  model: ModelOption,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
) {
  if (model.format === 'anthropic') {
    return {
      model: model.value,
      max_tokens: maxTokens,
      ...(systemPrompt.trim() ? { system: systemPrompt.trim() } : {}),
      messages: [{ role: 'user', content: userMessage }],
    }
  }
  const messages: { role: string; content: string }[] = []
  if (systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt.trim() })
  messages.push({ role: 'user', content: userMessage })
  return { model: model.value, max_tokens: maxTokens, messages }
}

function extractContent(format: RequestFormat, json: Record<string, unknown> | null): string {
  if (!json) return ''
  if (format === 'anthropic') {
    const blocks = json.content as Array<{ type: string; text?: string }> | undefined
    if (Array.isArray(blocks)) {
      return blocks
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    }
    return ''
  }
  const choices = json.choices as Array<{ message?: { content?: string } }> | undefined
  return choices?.[0]?.message?.content ?? ''
}

function extractUsage(
  format: RequestFormat,
  json: Record<string, unknown> | null,
): UsageInfo | undefined {
  if (!json) return undefined
  if (format === 'anthropic') {
    const u = json.usage as { input_tokens?: number; output_tokens?: number } | undefined
    if (!u) return undefined
    const i = u.input_tokens ?? 0
    const o = u.output_tokens ?? 0
    return { inputTokens: i, outputTokens: o, totalTokens: i + o }
  }
  const u = json.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined
  if (!u) return undefined
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
  }
}

export const Route = createFileRoute('/proxy/playground')({
  component: PlaygroundPage,
})
