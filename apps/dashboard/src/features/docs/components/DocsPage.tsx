import * as React from 'react'
import { Card, CardContent } from '@shared/ui/Card'
import { useApplicationKeysControllerList } from '@gen/api'
import { CodeSnippet } from './CodeSnippet'
import { SampleKeyPicker } from './SampleKeyPicker'

/**
 * Developer docs page — quick-start snippets for OpenAI / Anthropic / native
 * @raccoon/sdk + LangChain + Vercel AI SDK + webhook verification.
 *
 * Snippets get the user's Application key prefix injected when they pick an
 * app. The actual secret isn't accessible (we hash it on creation), so the
 * placeholder is `sk-rcn-live-...` — user copies their stored full key.
 */
export const DocsPage = React.memo(function DocsPage() {
  const [appId, setAppId] = React.useState<string | null>(null)
  const keysQuery = useApplicationKeysControllerList(appId ?? '', {
    query: { enabled: !!appId },
  })
  const activeKey = (keysQuery.data ?? []).find((k) => !k.revokedAt)
  const sampleKey = activeKey
    ? `${activeKey.keyPrefix}<reszta-Twojego-klucza>`
    : 'sk-rcn-live-XXX'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Dokumentacja</h1>
        <p className="text-sm text-neutral-500">
          Quick-start dla popularnych SDK. Pełna OpenAPI spec na dole strony.
        </p>
      </div>

      <SampleKeyPicker applicationId={appId} onApplicationChange={setAppId} />

      <Section title="OpenAI SDK (drop-in)">
        <p className="text-sm text-neutral-600">
          Najprostsza ścieżka — przekieruj <code className="text-xs">baseURL</code> na
          gateway, wszystko inne zostaje jak w oryginalnym SDK.
        </p>
        <CodeSnippet
          language="typescript"
          title="openai (Node)"
          code={openaiSnippet(sampleKey)}
        />
      </Section>

      <Section title="Anthropic SDK (drop-in)">
        <p className="text-sm text-neutral-600">
          Analogicznie — <code className="text-xs">@anthropic-ai/sdk</code> z naszym{' '}
          <code className="text-xs">baseURL</code>.
        </p>
        <CodeSnippet
          language="typescript"
          title="@anthropic-ai/sdk"
          code={anthropicSnippet(sampleKey)}
        />
      </Section>

      <Section title="@raccoon/sdk (native)">
        <p className="text-sm text-neutral-600">
          Cienki wrapper z helperami <code className="text-xs">withEndUser</code> +{' '}
          <code className="text-xs">withProvider</code> dla atrybucji per-user.
        </p>
        <CodeSnippet
          language="typescript"
          title="@raccoon/sdk"
          code={raccoonSdkSnippet(sampleKey)}
        />
      </Section>

      <Section title="Cross-provider routing">
        <p className="text-sm text-neutral-600">
          Wywołaj model Anthropica przez OpenAI-compat endpoint — gateway przetłumaczy
          request i response. Dla streamingu cross-provider jeszcze nie wspieramy
          (niedostępne w Sprincie 5).
        </p>
        <CodeSnippet
          language="typescript"
          title="OpenAI client → Anthropic model"
          code={crossProviderSnippet(sampleKey)}
        />
      </Section>

      <Section title="LangChain">
        <CodeSnippet
          language="typescript"
          title="@langchain/openai"
          code={langchainSnippet(sampleKey)}
        />
      </Section>

      <Section title="Vercel AI SDK">
        <CodeSnippet
          language="typescript"
          title="ai (Vercel)"
          code={vercelAiSnippet(sampleKey)}
        />
      </Section>

      <Section title="End-user attribution">
        <p className="text-sm text-neutral-600">
          Aby przypisać użycie do konkretnego użytkownika Twojej aplikacji, dodaj header{' '}
          <code className="text-xs">x-rcn-end-user</code>.
        </p>
        <CodeSnippet
          language="typescript"
          title="OpenAI client + end-user header"
          code={endUserSnippet(sampleKey)}
        />
      </Section>

      <Section title="Webhook signature verification">
        <p className="text-sm text-neutral-600">
          Każdy webhook ma header <code className="text-xs">X-Raccoon-Signature</code>{' '}
          w formacie <code className="text-xs">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>.
          Zweryfikuj go HMAC-SHA256 swoim sekretem (<code className="text-xs">whsec_...</code>).
        </p>
        <CodeSnippet language="typescript" title="Express handler" code={WEBHOOK_VERIFY_SNIPPET} />
      </Section>

      <Section title="Pełna specyfikacja OpenAPI">
        <p className="text-sm text-neutral-600">
          Interaktywna Swagger UI z każdym endpointem, schematem requestu i response.
        </p>
        <Card>
          <CardContent className="p-0">
            <iframe
              src="/docs"
              className="h-[700px] w-full rounded border-0"
              title="Swagger UI"
            />
          </CardContent>
        </Card>
      </Section>
    </div>
  )
})
DocsPage.displayName = 'DocsPage'

const Section = React.memo(function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  )
})
Section.displayName = 'Section'

// =============================================================================
// Snippet templates — interpolated with user's key prefix
// =============================================================================

function openaiSnippet(key: string): string {
  return `import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: '${key}',
  baseURL: 'https://api.raccoon.dev/v1',
})

const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Cześć!' }],
})

console.log(completion.choices[0].message.content)`
}

function anthropicSnippet(key: string): string {
  return `import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: '${key}',
  baseURL: 'https://api.raccoon.dev',
})

const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Cześć!' }],
})

console.log(message.content)`
}

function raccoonSdkSnippet(key: string): string {
  return `import { RaccoonClient } from '@raccoon/sdk'

const client = new RaccoonClient({ apiKey: '${key}' })

// Per-user attribution:
const userClient = client.withEndUser('user_abc123')

const r = await userClient.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hi' }],
})

console.log(r.choices[0].message.content, r.usage)`
}

function crossProviderSnippet(key: string): string {
  return `import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: '${key}',
  baseURL: 'https://api.raccoon.dev/v1',
})

// Anthropic model przez OpenAI-compatible endpoint:
const completion = await openai.chat.completions.create({
  model: 'anthropic/claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Cześć!' }],
})`
}

function langchainSnippet(key: string): string {
  return `import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  apiKey: '${key}',
  configuration: { baseURL: 'https://api.raccoon.dev/v1' },
  model: 'gpt-4o-mini',
})

const response = await model.invoke('Hello!')`
}

function vercelAiSnippet(key: string): string {
  return `import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const openai = createOpenAI({
  apiKey: '${key}',
  baseURL: 'https://api.raccoon.dev/v1',
})

const { text } = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Cześć!',
})`
}

function endUserSnippet(key: string): string {
  return `import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: '${key}',
  baseURL: 'https://api.raccoon.dev/v1',
  defaultHeaders: {
    'x-rcn-end-user': 'user_abc123',  // opaque user ID from your app
  },
})

// Wszystkie requesty z tego klienta będą atrybutowane do user_abc123
// w analytics dashboard (breakdown by endUser).`
}

const WEBHOOK_VERIFY_SNIPPET = `import * as crypto from 'crypto'
import express from 'express'

const app = express()
const WEBHOOK_SECRET = process.env.RACCOON_WEBHOOK_SECRET! // whsec_...

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sigHeader = req.headers['x-raccoon-signature'] as string
  const match = sigHeader.match(/t=(\\d+),v1=([a-f0-9]+)/)
  if (!match) return res.status(400).send('bad signature header')

  const [, timestamp, providedSig] = match
  const payload = \`\${timestamp}.\${req.body.toString('utf8')}\`
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')

  // Timing-safe comparison
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expected))) {
    return res.status(401).send('invalid signature')
  }

  // Reject events older than 5 min (replay protection)
  if (Date.now() / 1000 - Number(timestamp) > 300) {
    return res.status(400).send('event too old')
  }

  const body = JSON.parse(req.body.toString('utf8'))
  console.log('Verified event:', body.event, body.data)
  res.status(200).send('ok')
})

app.listen(3000)`
