import * as React from 'react'
import { Card, CardContent } from '@shared/ui/Card'
import { Badge } from '@shared/ui/Badge'
import {
  ArrowRight,
  Cpu,
  CreditCard,
  FileWarning,
  Key,
  ListTree,
  Package,
  Receipt,
  Repeat,
  Rocket,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react'
import { useApplicationKeysControllerList } from '@gen/api'
import { CodeSnippet } from './CodeSnippet'
import { SampleKeyPicker } from './SampleKeyPicker'

/**
 * Developer docs — wszystkie operacje, których potrzebuje aplikacja
 * integratora, wykonywalne JEDNYM kluczem aplikacji
 * (`Authorization: Bearer sk-rcn-live-…`):
 *
 *   - wywołanie modeli AI,
 *   - sprawdzenie ile tokenów ma user / ile zużył,
 *   - sprawdzenie aktywnej subskrypcji / pakietów,
 *   - pobranie katalogu produktów,
 *   - wystartowanie zakupu (Stripe Checkout).
 *
 * Brak login flow — klucz aplikacji uniwersalnie identyfikuje konto będące
 * jego właścicielem (zobacz: ClientAuthGuard po stronie backendu).
 *
 * Operatorska konfiguracja (webhooki, alerty, BYOK, CRUD aplikacji) jest
 * dostępna w panelu po lewej stronie i w pełnej specyfikacji OpenAPI na
 * dole tej strony.
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
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-neutral-900">
          Integracja z Raccoon Gateway
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Wszystkie operacje robisz <strong>jednym kluczem aplikacji</strong>{' '}
          <code className="font-mono text-xs">sk-rcn-live-…</code> — bez logowania,
          bez JWT. Wywołanie AI, saldo aplikacji, subskrypcja, katalog, zakup,
          a także — gdy Twoja apka ma swoich użytkowników — osobne saldo +
          osobny zakup per końcowy user (B2B2C, sekcja{' '}
          <a href="#end-users" className="underline">
            Końcowi userzy
          </a>
          ).
        </p>
      </header>

      <SampleKeyPicker applicationId={appId} onApplicationChange={setAppId} />

      <Toc />

      {/* 1. Quickstart */}
      <Section
        id="quickstart"
        icon={<Rocket className="h-5 w-5" />}
        title="Quickstart"
      >
        <p className="text-sm text-neutral-700">
          Klucz aplikacji generujesz raz w panelu po lewej (sekcja{' '}
          <strong>Aplikacje → Klucze</strong>) — pełen sekret pokazujemy
          tylko przy generowaniu, dlatego od razu skopiuj go w bezpieczne miejsce.
          Potem już tylko jeden header wszędzie:
        </p>
        <CodeSnippet
          language="bash"
          title="Authorization header"
          code={`Authorization: Bearer ${sampleKey}`}
        />
        <p className="text-sm text-neutral-700">
          Pierwszy strzał — pełen happy path:
        </p>
        <CodeSnippet
          language="bash"
          title="curl: chat completions"
          code={chatCurl(sampleKey)}
        />
      </Section>

      {/* 2. Klucz */}
      <Section
        id="key"
        icon={<Key className="h-5 w-5" />}
        title="Klucz aplikacji"
      >
        <p className="text-sm text-neutral-700">
          Każda aplikacja ma jeden lub więcej kluczy. Klucz jest:
        </p>
        <ul className="ml-5 list-disc space-y-1 text-sm text-neutral-700">
          <li>
            <strong>Argon2id-hashowany w DB</strong> — pełen sekret nigdzie nie
            jest zapisany. Zgubisz go → wygeneruj nowy i revoke&apos;uj stary.
          </li>
          <li>
            <strong>Identyfikuje konto</strong> będące właścicielem aplikacji
            — gateway zna saldo tego konta, jego subskrypcje, katalog.
          </li>
          <li>
            <strong>Może mieć opcjonalny <code className="font-mono text-xs">expiresAt</code></strong>
            {' '} (data wygaśnięcia) i można go w każdej chwili revoke&apos;ować.
          </li>
          <li>
            <strong>Powinien być trzymany na serwerze</strong> Twojej apki — nie
            wysyłaj go do przeglądarki użytkownika końcowego (frontend powinien
            uderzać do Twojego backendu, który dopiero robi wywołanie do gatewaya).
          </li>
        </ul>
      </Section>

      {/* 3. Wysyłanie zapytań AI */}
      <Section
        id="ai"
        icon={<Cpu className="h-5 w-5" />}
        title="Wysyłanie zapytania do AI"
      >
        <p className="text-sm text-neutral-700">
          Dwa kompatybilne formaty — wybierz ten, który pasuje do Twojego SDK:
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <EndpointCard
            method="POST"
            path="/v1/chat/completions"
            description="Format zgodny z OpenAI Chat Completions. Drop-in dla oficjalnego SDK OpenAI — zmień tylko baseURL."
            highlights={[
              'body: { model, messages, max_tokens?, stream? }',
              'response: choices[0].message.content + usage',
              'streaming: stream: true → SSE',
            ]}
          />
          <EndpointCard
            method="POST"
            path="/v1/messages"
            description="Format zgodny z Anthropic Messages API. Drop-in dla @anthropic-ai/sdk."
            highlights={[
              'body: { model, max_tokens (REQUIRED), messages, system? }',
              'response: content[].text + usage',
              'streaming: stream: true → SSE w shape Anthropic',
            ]}
          />
        </div>

        <Subsection title="Pierwsze wywołanie">
          <CodeSnippet language="bash" title="curl" code={chatCurl(sampleKey)} />
          <CodeSnippet
            language="javascript"
            title="fetch (Node 18+ / browser-server)"
            code={chatFetch(sampleKey)}
          />
          <CodeSnippet
            language="python"
            title="requests (Python)"
            code={chatPython(sampleKey)}
          />
        </Subsection>

        <Subsection title="Atrybucja per-user (opcjonalne)">
          <p className="text-sm text-neutral-700">
            Dodaj nagłówek <code className="font-mono text-xs">x-rcn-end-user</code>{' '}
            z opaque ID Twojego użytkownika — gateway zapisze go w UsageEvent
            i zobaczysz potem podział wg użytkowników w analityce konta.
          </p>
          <CodeSnippet
            language="bash"
            title="curl: z atrybucją end-user"
            code={endUserCurl(sampleKey)}
          />
        </Subsection>

        <Subsection title="Streaming (SSE)">
          <CodeSnippet
            language="javascript"
            title="fetch + ReadableStream"
            code={streamingFetch(sampleKey)}
          />
        </Subsection>
      </Section>

      {/* 4. Saldo + zużycie */}
      <Section
        id="wallet"
        icon={<Wallet className="h-5 w-5" />}
        title="Saldo i zużycie tokenów"
      >
        <p className="text-sm text-neutral-700">
          Każde konto ma <strong>wspólne saldo</strong> (do dyspozycji wszystkich
          aplikacji) plus <strong>saldo per-aplikacja</strong>. Gateway przy
          każdym wywołaniu AI najpierw używa walletu aplikacji, potem fallback
          do wspólnego.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <EndpointCard
            method="GET"
            path="/v1/billing/wallets"
            description="Pełen widok: shared + każda aplikacja + total. Najlepszy do dashboardu salda."
          />
          <EndpointCard
            method="GET"
            path="/v1/billing/applications/{id}/wallet"
            description="Saldo jednej aplikacji. Zwraca 404 dla aplikacji spoza Twojego konta."
          />
          <EndpointCard
            method="GET"
            path="/v1/wallet"
            description="Tylko saldo wspólne (legacy). Nowe integracje używają /v1/billing/wallets."
          />
          <EndpointCard
            method="GET"
            path="/v1/wallet/transactions"
            description="Historia: HOLD / SETTLE / REFUND / TOPUP / SUBSCRIPTION_GRANT / SUBSCRIPTION_RESET / ADJUST. Filtr ?applicationId=<uuid>|shared, ?limit=, ?type=."
          />
        </div>

        <CodeSnippet
          language="bash"
          title="curl: kombinowany widok salda + ostatnie 20 transakcji"
          code={WALLET_CURL(sampleKey)}
        />

        <p className="text-sm text-neutral-600">
          Pole <code className="font-mono text-xs">refundOnError</code> mówi,
          czy tokeny są zwracane gdy provider zwróci błąd 4xx/5xx. Domyślnie{' '}
          <code className="font-mono text-xs">true</code>. Zmienisz to przez
          <code className="font-mono text-xs"> PATCH /v1/billing/preferences</code>.
        </p>
      </Section>

      {/* 5. Subskrypcja + pakiety */}
      <Section
        id="subscription"
        icon={<Repeat className="h-5 w-5" />}
        title="Aktywna subskrypcja i pakiety"
      >
        <p className="text-sm text-neutral-700">
          Subskrypcje (cykliczne) i pakiety jednorazowe wpływają na saldo
          tokenów. Jeden endpoint zwróci wszystko, czego potrzebujesz do
          renderowania ekranu billingu po stronie Twojej apki.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <EndpointCard
            method="GET"
            path="/v1/billing/me"
            description="One-shot: saldo (shared + per-app) + aktywna subskrypcja + katalog + preferencje. Odpytuj przy ładowaniu ekranu billingu."
            highlights={[
              'balance.tokens (shared) + balance.refundOnError',
              'applications: [{ id, name, tokenBalance }]',
              'subscription: { productName, currentPeriodEnd, cancelAtPeriodEnd } | null',
              'catalog: [{ name, mode: PACKAGE|SUBSCRIPTION, prices }]',
              'preferences: { defaultPackageScope, defaultSubscriptionScope }',
            ]}
          />
          <EndpointCard
            method="GET"
            path="/v1/billing/subscription"
            description="Sama subskrypcja (lub null). Lekki endpoint dla widgetu nawigacji."
          />
        </div>

        <CodeSnippet
          language="bash"
          title="curl: GET /v1/billing/me"
          code={ME_CURL(sampleKey)}
        />

        <CodeSnippet
          language="javascript"
          title="fetch + render"
          code={ME_FETCH(sampleKey)}
        />

        <Subsection title="Anulowanie subskrypcji">
          <p className="text-sm text-neutral-700">
            Anulowanie wchodzi na końcu okresu rozliczeniowego — saldo z
            ostatniego reset/rollover zostaje, ale po{' '}
            <code className="font-mono text-xs">currentPeriodEnd</code> subskrypcja
            przechodzi w status CANCELED.
          </p>
          <CodeSnippet
            language="bash"
            title="curl: anuluj subskrypcję"
            code={CANCEL_CURL(sampleKey)}
          />
        </Subsection>
      </Section>

      {/* 6. Katalog */}
      <Section
        id="catalog"
        icon={<Package className="h-5 w-5" />}
        title="Katalog produktów"
      >
        <p className="text-sm text-neutral-700">
          Lista aktywnych pakietów i subskrypcji skonfigurowanych przez operatora
          gatewaya. Każdy produkt ma jedną lub więcej cen (np. miesięczna i roczna
          dla jednej subskrypcji).
        </p>

        <EndpointCard
          method="GET"
          path="/v1/billing/catalog"
          description="Aktywne produkty + ich aktywne ceny. Renderujesz z tego listę 'kup tokeny' w UI."
          highlights={[
            'product.mode: PACKAGE (jednorazowa) | SUBSCRIPTION (cykliczna)',
            'price.unitAmount: cena w centach',
            'price.currency: zwykle "usd"',
            'price.interval: "month" | "year" | null (one-time)',
            'price.tokensGranted: ile tokenów dostaje user',
          ]}
        />

        <CodeSnippet
          language="bash"
          title="curl: GET /v1/billing/catalog"
          code={CATALOG_CURL(sampleKey)}
        />
      </Section>

      {/* 7. Checkout */}
      <Section
        id="checkout"
        icon={<ShoppingCart className="h-5 w-5" />}
        title="Zakup tokenów (Stripe Checkout)"
      >
        <p className="text-sm text-neutral-700">
          Twoja apka <strong>nie integruje się ze Stripe</strong> — tylko z naszym
          gatewayem. Wywołujesz endpoint, dostajesz URL Stripe Checkout i robisz
          redirect przeglądarki. Po opłacie tokeny lądują na walletcie automatycznie.
        </p>

        <div className="grid gap-2 md:grid-cols-2">
          <EndpointCard
            method="POST"
            path="/v1/billing/checkout"
            description="Zwraca URL Stripe Checkout. Skopiuj go i otwórz w przeglądarce / window.location.href."
            highlights={[
              'priceId: ID z /v1/billing/catalog (uuid)',
              'scope: "PER_APPLICATION" | "SHARED_ACCOUNT"',
              'applicationId: wymagane gdy scope=PER_APPLICATION',
              'successUrl / cancelUrl: gdzie Stripe ma odesłać usera',
            ]}
          />
        </div>

        <Subsection title="Tokeny do walletu konkretnej aplikacji">
          <CodeSnippet
            language="bash"
            title="curl: scope=PER_APPLICATION"
            code={CHECKOUT_PER_APP(sampleKey)}
          />
        </Subsection>

        <Subsection title="Tokeny do walletu wspólnego (account)">
          <CodeSnippet
            language="bash"
            title="curl: scope=SHARED_ACCOUNT"
            code={CHECKOUT_SHARED(sampleKey)}
          />
        </Subsection>

        <p className="text-sm text-neutral-600">
          Domyślny scope każdego rodzaju produktu (pakiet / subskrypcja) zostaje
          zapamiętany per konto przez{' '}
          <code className="font-mono text-xs">PATCH /v1/billing/preferences</code>{' '}
          — jeśli nie podasz <code className="font-mono text-xs">scope</code> w
          checkoucie, wskoczy domyślny.
        </p>
      </Section>

      {/* 8. End-users (B2B2C) */}
      <Section
        id="end-users"
        icon={<Users className="h-5 w-5" />}
        title="Końcowi użytkownicy aplikacji (B2B2C)"
      >
        <p className="text-sm text-neutral-700">
          Jeśli Twoja aplikacja ma swoich użytkowników (np. SaaS z kontami), gateway
          potrafi dla każdego z nich osobno trzymać saldo i obsłużyć osobny zakup.
          Twój kod nigdy nie loguje końcowego użytkownika do gatewaya — końcówka
          identyfikowana jest <strong>opaque ID</strong> z Twojej apki, a gateway
          mapuje to na wewnętrzny rekord <code className="font-mono text-xs">EndUser</code>.
        </p>

        <ul className="ml-5 list-disc space-y-1 text-sm text-neutral-700">
          <li>
            Każdy końcowy user ma <strong>własny wallet</strong> i (po zakupie)
            <strong> własną subskrypcję</strong> + Stripe Customer.
          </li>
          <li>
            Gateway pre-check: gdy request ma header{' '}
            <code className="font-mono text-xs">x-rcn-end-user</code>, hold idzie
            <strong> wyłącznie</strong> z walletu tego końcowego usera.{' '}
            <em>Bez fallbacku</em> do walletu aplikacji ani konta — kończą się
            tokeny, kończy się dostęp (HTTP 402).
          </li>
          <li>
            Bez tego headera request korzysta z walletu aplikacji (jak
            wcześniejsze sekcje).
          </li>
        </ul>

        <Subsection title="Wywołanie AI z atrybucją końcowego usera">
          <CodeSnippet
            language="bash"
            title="curl: ten sam endpoint, dodatkowy header"
            code={endUserCallCurl(sampleKey)}
          />
        </Subsection>

        <Subsection title="Saldo + zużycie końcowego usera">
          <div className="grid gap-2 md:grid-cols-2">
            <EndpointCard
              method="GET"
              path="/v1/end-users"
              description="Lista wszystkich końcowych userów aplikacji + ich saldo + sumaryczne zużycie (requests, input/output tokens, lastSeenAt)."
            />
            <EndpointCard
              method="GET"
              path="/v1/end-users/{externalId}/wallet"
              description="Pojedynczy user — saldo + flag refundOnError."
            />
            <EndpointCard
              method="GET"
              path="/v1/end-users/{externalId}/transactions"
              description="Ledger HOLD / SETTLE / REFUND / TOPUP / SUBSCRIPTION_GRANT / SUBSCRIPTION_RESET / ADJUST tylko tego końcowego usera."
            />
            <EndpointCard
              method="GET"
              path="/v1/end-users/{externalId}/me"
              description="Jeden fetch zaopatruje cały ekran 'moje rozliczenie' w Twojej apce: saldo + aktywna subskrypcja + katalog. Zalecane dla widgetu billingu."
            />
          </div>
          <CodeSnippet
            language="bash"
            title="curl: lista końcowych userów + szczegóły"
            code={endUserListCurl(sampleKey)}
          />
        </Subsection>

        <Subsection title="Zakup pakietu / subskrypcji dla końcowego usera">
          <p className="text-sm text-neutral-700">
            Wywołujesz wygodny endpoint{' '}
            <code className="font-mono text-xs">POST /v1/end-users/{`{externalId}`}/checkout</code>
            {' '}— gateway tworzy / używa Stripe Customera końcowego usera (osobny
            od Twojego konta operatora — czyste paragony / TAX records per osoba)
            i zwraca URL Stripe Checkout. Po opłacie tokeny lądują w jego wallecie.
          </p>
          <EndpointCard
            method="POST"
            path="/v1/end-users/{externalId}/checkout"
            description="Stripe Checkout dla końcowego usera. scope=PER_END_USER jest implicitne — nie musisz go podawać w body."
            highlights={[
              'priceId: ID z /v1/billing/catalog',
              'successUrl / cancelUrl: gdzie Stripe ma odesłać końcowego usera',
              'Lazy Stripe Customer: pierwszy zakup → utworzony, kolejne → reuse',
            ]}
          />
          <CodeSnippet
            language="bash"
            title="curl: zakup pakietu dla końcowego usera"
            code={endUserCheckoutCurl(sampleKey)}
          />
        </Subsection>

        <Subsection title="Anulowanie subskrypcji końcowego usera">
          <EndpointCard
            method="POST"
            path="/v1/end-users/{externalId}/subscription/{id}/cancel"
            description="Subskrypcja zostaje aktywna do końca okresu (cancelAtPeriodEnd=true), potem CANCELED."
          />
        </Subsection>

        <Subsection title="Pełen flow w aplikacji integratora">
          <CodeSnippet
            language="javascript"
            title="fetch — typowy ekran billingu w Twojej apce"
            code={endUserFlowFetch(sampleKey)}
          />
        </Subsection>
      </Section>

      {/* 9. 402 handling */}
      <Section
        id="errors"
        icon={<FileWarning className="h-5 w-5" />}
        title="Brak środków: kody 402"
      >
        <p className="text-sm text-neutral-700">
          Gdy user nie ma wystarczająco tokenów, gateway zwraca{' '}
          <strong>HTTP 402</strong> z polem{' '}
          <code className="font-mono text-xs">code</code>. Provider AI{' '}
          <strong>nie jest wywołany</strong> — pokażesz call-to-action z linkiem
          do zakupu bez ryzyka rozliczenia tokenów.
        </p>

        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">code</th>
                <th className="px-3 py-2 text-left">Co znaczy</th>
                <th className="px-3 py-2 text-left">Reakcja UI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {ERROR_TABLE.map((r) => (
                <tr key={r.code}>
                  <td className="px-3 py-2 align-top">
                    <Badge variant={r.variant}>{r.code}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top text-neutral-700">{r.meaning}</td>
                  <td className="px-3 py-2 align-top text-neutral-700">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CodeSnippet
          language="javascript"
          title="fetch z obsługą 402"
          code={ERROR_FETCH(sampleKey)}
        />
      </Section>

      {/* 9. SDK adapters */}
      <Section
        id="sdks"
        icon={<ListTree className="h-5 w-5" />}
        title="SDK adaptery"
      >
        <p className="text-sm text-neutral-700">
          Najszybsza ścieżka dla istniejącego kodu — przekieruj{' '}
          <code className="font-mono text-xs">baseURL</code> oficjalnego SDK na
          gateway, klucz aplikacji wkładasz w pole <code className="font-mono text-xs">apiKey</code>,
          resztę zostawiasz bez zmian.
        </p>

        <Subsection title="OpenAI SDK (Node)">
          <CodeSnippet language="typescript" title="openai" code={openaiSnippet(sampleKey)} />
        </Subsection>
        <Subsection title="Anthropic SDK">
          <CodeSnippet
            language="typescript"
            title="@anthropic-ai/sdk"
            code={anthropicSnippet(sampleKey)}
          />
        </Subsection>
        <Subsection title="LangChain">
          <CodeSnippet
            language="typescript"
            title="@langchain/openai"
            code={langchainSnippet(sampleKey)}
          />
        </Subsection>
        <Subsection title="Vercel AI SDK">
          <CodeSnippet
            language="typescript"
            title="ai (Vercel)"
            code={vercelAiSnippet(sampleKey)}
          />
        </Subsection>
      </Section>

      {/* 10. OpenAPI iframe */}
      <Section
        id="openapi"
        icon={<CreditCard className="h-5 w-5" />}
        title="Pełna specyfikacja OpenAPI"
      >
        <p className="text-sm text-neutral-600">
          Interaktywne Swagger UI z każdym endpointem konta — wszystkimi
          schematami requestów i response&apos;ów. Endpointy operatorskie
          (webhooki, alerty, analytics, BYOK, CRUD aplikacji) zarządzasz przez
          panel po lewej w sidebarze.
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

// =============================================================================
// Building blocks
// =============================================================================

const Toc = React.memo(function Toc() {
  const items: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: 'quickstart', label: 'Quickstart', icon: <Rocket className="h-3 w-3" /> },
    { id: 'key', label: 'Klucz aplikacji', icon: <Key className="h-3 w-3" /> },
    { id: 'ai', label: 'Wywołanie AI', icon: <Cpu className="h-3 w-3" /> },
    { id: 'wallet', label: 'Saldo i zużycie', icon: <Wallet className="h-3 w-3" /> },
    { id: 'subscription', label: 'Subskrypcja', icon: <Repeat className="h-3 w-3" /> },
    { id: 'catalog', label: 'Katalog', icon: <Package className="h-3 w-3" /> },
    { id: 'checkout', label: 'Zakup', icon: <ShoppingCart className="h-3 w-3" /> },
    { id: 'end-users', label: 'Końcowi userzy (B2B2C)', icon: <Users className="h-3 w-3" /> },
    { id: 'errors', label: 'Brak środków (402)', icon: <FileWarning className="h-3 w-3" /> },
    { id: 'sdks', label: 'SDK', icon: <ListTree className="h-3 w-3" /> },
    { id: 'openapi', label: 'OpenAPI', icon: <Receipt className="h-3 w-3" /> },
  ]
  return (
    <Card>
      <CardContent className="flex flex-wrap gap-2 p-4">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100"
          >
            {it.icon}
            {it.label}
            <ArrowRight className="h-3 w-3" />
          </a>
        ))}
      </CardContent>
    </Card>
  )
})

const Section = React.memo(function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-4 scroll-mt-6">
      <div className="flex items-center gap-2 border-b border-neutral-200 pb-2">
        <span className="text-neutral-700">{icon}</span>
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
})

const Subsection = React.memo(function Subsection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
})

const EndpointCard = React.memo(function EndpointCard({
  method,
  path,
  description,
  highlights,
}: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  description: string
  highlights?: string[]
}) {
  const methodColor: Record<string, string> = {
    GET: 'bg-emerald-100 text-emerald-800',
    POST: 'bg-blue-100 text-blue-800',
    PATCH: 'bg-amber-100 text-amber-800',
    DELETE: 'bg-rose-100 text-rose-800',
  }
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${methodColor[method]}`}
          >
            {method}
          </span>
          <code className="break-all font-mono text-xs text-neutral-900">{path}</code>
        </div>
        <p className="text-xs text-neutral-700">{description}</p>
        {highlights && highlights.length > 0 && (
          <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-neutral-600">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
})

// =============================================================================
// Snippets — wszędzie używamy klucza aplikacji bezpośrednio
// =============================================================================

function chatCurl(key: string): string {
  return `curl -X POST https://api.raccoon.dev/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "gpt-4o-mini",
    "max_tokens": 200,
    "messages": [{"role":"user","content":"Powiedz cześć po polsku"}]
  }'
# 200: { id, model, choices:[{message:{content}}], usage:{prompt_tokens, completion_tokens} }
# 402: { code: "INSUFFICIENT_TOKEN_BALANCE" }     ← brak środków, provider NIE wywołany
# 402: { code: "PROVIDER_INSUFFICIENT_FUNDS" }    ← BYOK key bez kredytu u providera`
}

function chatFetch(key: string): string {
  return `const resp = await fetch('https://api.raccoon.dev/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${key}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    messages: [{ role: 'user', content: 'Cześć' }],
  }),
})

if (resp.status === 402) {
  const { code } = await resp.json()
  // pokaż userowi link do zakupu — w UI gateway: /settings/billing
  throw new Error(code)
}

const data = await resp.json()
console.log(data.choices[0].message.content, data.usage)`
}

function chatPython(key: string): string {
  return `import requests

resp = requests.post(
    "https://api.raccoon.dev/v1/chat/completions",
    headers={
        "Authorization": "Bearer ${key}",
        "Content-Type": "application/json",
    },
    json={
        "model": "gpt-4o-mini",
        "max_tokens": 200,
        "messages": [{"role": "user", "content": "Hi!"}],
    },
    timeout=30,
)
if resp.status_code == 402:
    raise RuntimeError(f"Brak środków: {resp.json().get('code')}")
resp.raise_for_status()
print(resp.json()["choices"][0]["message"]["content"])`
}

function endUserCurl(key: string): string {
  return `curl -X POST https://api.raccoon.dev/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H 'x-rcn-end-user: user_abc123' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'
# Wszystkie wywołania z tym headerem są przypisane do user_abc123
# w analityce konta (breakdown wg endUser).`
}

function streamingFetch(key: string): string {
  return `const resp = await fetch('https://api.raccoon.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ${key}', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    max_tokens: 200,
    stream: true,
    messages: [{ role: 'user', content: 'Opowiedz historię o lisie' }],
  }),
})

const reader = resp.body!.getReader()
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6)
    if (payload === '[DONE]') return
    const chunk = JSON.parse(payload)
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
  }
}`
}

function WALLET_CURL(key: string): string {
  return `# Pełen widok salda (shared + per-app + total)
curl https://api.raccoon.dev/v1/billing/wallets \\
  -H "Authorization: Bearer ${key}"
# {
#   sharedBalance: "0",
#   refundOnError: true,
#   applications: [
#     { id: "…", name: "My App", tokenBalance: "950" },
#     { id: "…", name: "Mobile",  tokenBalance: "500" }
#   ],
#   totalAvailable: "1450"
# }

# Historia transakcji aplikacji (HOLD / SETTLE / REFUND / TOPUP / SUBSCRIPTION_*)
curl "https://api.raccoon.dev/v1/wallet/transactions?limit=20" \\
  -H "Authorization: Bearer ${key}"
# { transactions: [{ type, amount, balanceAfter, applicationId, metadata, createdAt }, …] }`
}

function ME_CURL(key: string): string {
  return `# /v1/billing/me — wszystko, czego potrzebuje ekran billingu
curl https://api.raccoon.dev/v1/billing/me \\
  -H "Authorization: Bearer ${key}"
# {
#   balance:       { tokens: "950", refundOnError: true },
#   applications:  [{ id, name, tokenBalance }],
#   totalAvailable: "1450",
#   subscription:  { id, productName, status, currentPeriodEnd, cancelAtPeriodEnd }
#                  | null,                                    ← brak aktywnej
#   ready: true,                                              ← Stripe skonfigurowany
#   catalog: [
#     { id, name, mode: "PACKAGE"|"SUBSCRIPTION", description,
#       prices: [{ id, unitAmount, currency, interval, tokensGranted }] }
#   ],
#   preferences: { defaultPackageScope, defaultSubscriptionScope }
# }`
}

function ME_FETCH(key: string): string {
  return `// Hook do ekranu billingu — jeden fetch zaopatruje cały widok.
async function loadBilling() {
  const resp = await fetch('https://api.raccoon.dev/v1/billing/me', {
    headers: { Authorization: 'Bearer ${key}' },
  })
  if (!resp.ok) throw new Error('billing fetch failed')
  const data = await resp.json()

  return {
    saldoTokenow: BigInt(data.totalAvailable),                // łącznie
    saldoWspolne: BigInt(data.balance.tokens),                // tylko shared
    aplikacje:    data.applications,                          // [{ id, name, tokenBalance }]
    aktywnaSubskrypcja: data.subscription,                    // null albo obiekt
    pakiety:      data.catalog.filter((p: any) => p.mode === 'PACKAGE'),
    subskrypcje:  data.catalog.filter((p: any) => p.mode === 'SUBSCRIPTION'),
  }
}`
}

function CANCEL_CURL(key: string): string {
  return `# Anulowanie subskrypcji — zostaje aktywna do końca okresu.
SUB_ID="<id z /v1/billing/subscription albo /v1/billing/me>"
curl -X POST https://api.raccoon.dev/v1/billing/subscription/$SUB_ID/cancel \\
  -H "Authorization: Bearer ${key}"
# Response: zaktualizowana subskrypcja z cancelAtPeriodEnd=true`
}

function CATALOG_CURL(key: string): string {
  return `curl https://api.raccoon.dev/v1/billing/catalog \\
  -H "Authorization: Bearer ${key}"
# {
#   products: [
#     {
#       id: "<uuid>",
#       name: "Pakiet 1k tokenów",
#       description: "Idealny na start",
#       mode: "PACKAGE",
#       isActive: true,
#       prices: [
#         { id: "<uuid>", unitAmount: 500, currency: "usd",
#           interval: null, tokensGranted: "1000" }
#       ]
#     }
#   ]
# }`
}

function CHECKOUT_PER_APP(key: string): string {
  return `# Zakup pakietu — tokeny lecą do walletu konkretnej aplikacji
curl -X POST https://api.raccoon.dev/v1/billing/checkout \\
  -H "Authorization: Bearer ${key}" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "priceId": "<uuid z /v1/billing/catalog>",
    "scope": "PER_APPLICATION",
    "applicationId": "<uuid Twojej apki>",
    "successUrl": "https://twoja-apka.example.com/billing?ok=1",
    "cancelUrl":  "https://twoja-apka.example.com/billing?cancelled=1"
  }'
# { url: "https://checkout.stripe.com/…", sessionId: "cs_…" }
# Klient: window.location.href = data.url`
}

function CHECKOUT_SHARED(key: string): string {
  return `# Zakup pakietu wspólnego — tokeny dostępne dla wszystkich aplikacji konta
curl -X POST https://api.raccoon.dev/v1/billing/checkout \\
  -H "Authorization: Bearer ${key}" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "priceId": "<uuid>",
    "scope": "SHARED_ACCOUNT",
    "successUrl": "https://twoja-apka.example.com/billing?ok=1",
    "cancelUrl":  "https://twoja-apka.example.com/billing?cancelled=1"
  }'`
}

function ERROR_FETCH(key: string): string {
  return `async function callAi(message: string) {
  const resp = await fetch('https://api.raccoon.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ${key}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [{ role: 'user', content: message }],
    }),
  })

  if (resp.status === 402) {
    const { code } = await resp.json()
    switch (code) {
      case 'INSUFFICIENT_TOKEN_BALANCE':
        // Pokaż ekran "Doładuj tokeny" z linkiem do checkoutu
        showTopUpDialog()
        return null
      case 'PROVIDER_INSUFFICIENT_FUNDS':
        // BYOK key operatora bez kredytu — informacja techniczna
        showError('Provider AI nie ma środków, skontaktuj się z administratorem.')
        return null
    }
  }
  if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`)
  return resp.json()
}`
}

const ERROR_TABLE: {
  code: string
  meaning: string
  action: string
  variant: 'default' | 'warning' | 'destructive' | 'secondary' | 'success'
}[] = [
  {
    code: 'INSUFFICIENT_TOKEN_BALANCE',
    meaning:
      'Saldo aplikacji + saldo wspólne < estymowany koszt requesta. Provider NIE wywołany.',
    action:
      'Pokaż dialog "Doładuj tokeny" → POST /v1/billing/checkout albo redirect do /settings/billing.',
    variant: 'warning',
  },
  {
    code: 'PROVIDER_INSUFFICIENT_FUNDS',
    meaning:
      'BYOK klucz operatora nie ma środków u dostawcy AI (OpenAI/Anthropic). Hold zwrócony — saldo Twojego usera nie zmalało.',
    action:
      'Komunikat techniczny: "Tymczasowy problem dostawcy AI". Skontaktuj się z administratorem gateway.',
    variant: 'destructive',
  },
  {
    code: 'MAX_TOKENS_REQUIRED_LOW_BALANCE',
    meaning:
      'Streaming bez `max_tokens` przy niskim saldzie — gateway wymaga limitu, żeby móc oszacować hold.',
    action: 'Dodaj pole `max_tokens` do body requesta i powtórz.',
    variant: 'warning',
  },
]

// =============================================================================
// SDK adapter snippets
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
  model: 'claude-3-5-sonnet-latest',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Cześć!' }],
})

console.log(message.content)`
}

function langchainSnippet(key: string): string {
  return `import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  apiKey: '${key}',
  configuration: { baseURL: 'https://api.raccoon.dev/v1' },
  model: 'gpt-4o-mini',
})

const response = await model.invoke('Cześć!')`
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

// =============================================================================
// End-user (B2B2C) snippets
// =============================================================================

function endUserCallCurl(key: string): string {
  return `# Każdy request z headerem x-rcn-end-user holduje z walletu TYLKO tego usera.
# Brak headera → nadal działa fallback do walletu aplikacji (poprzednie sekcje).
curl -X POST https://api.raccoon.dev/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "x-rcn-end-user: alice_42" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "gpt-4o-mini",
    "max_tokens": 200,
    "messages": [{"role":"user","content":"Hi"}]
  }'
# 402 INSUFFICIENT_TOKEN_BALANCE → end-user nie ma tokenów. BRAK fallbacku do
# walletu aplikacji — pokaż dialog "doładuj swoje saldo".`
}

function endUserListCurl(key: string): string {
  return `# Lista wszystkich końcowych userów Twojej aplikacji + ich saldo + zużycie.
curl 'https://api.raccoon.dev/v1/end-users?limit=20' \\
  -H "Authorization: Bearer ${key}"
# {
#   endUsers: [
#     { externalId: "alice_42", tokenBalance: "172",
#       hasActiveSubscription: false,
#       totalRequests: 5, totalInputTokens: 60, totalOutputTokens: 80,
#       lastSeenAt: "2026-…" },
#     …
#   ],
#   total: 1
# }

# Saldo i status pojedynczego usera
curl https://api.raccoon.dev/v1/end-users/alice_42/wallet \\
  -H "Authorization: Bearer ${key}"
# { externalId, endUserId, applicationId, tokenBalance, refundOnError }

# Pełen widok billingu dla ekranu "moje rozliczenie" w Twojej apce
curl https://api.raccoon.dev/v1/end-users/alice_42/me \\
  -H "Authorization: Bearer ${key}"
# {
#   balance: { tokens, refundOnError },
#   subscription: { … } | null,
#   catalog:  [ { mode: "PACKAGE"|"SUBSCRIPTION", prices: [ … ] }, … ],
#   ready: true
# }

# Ledger transakcji końcowego usera (HOLD / REFUND / SETTLE / TOPUP / SUBSCRIPTION_*)
curl 'https://api.raccoon.dev/v1/end-users/alice_42/transactions?limit=20' \\
  -H "Authorization: Bearer ${key}"`
}

function endUserCheckoutCurl(key: string): string {
  return `# Zakup pakietu dla końcowego usera (scope=PER_END_USER implicit).
curl -X POST https://api.raccoon.dev/v1/end-users/alice_42/checkout \\
  -H "Authorization: Bearer ${key}" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "priceId":   "<uuid z /v1/billing/catalog>",
    "successUrl": "https://twoja-apka.example.com/billing?ok=1",
    "cancelUrl":  "https://twoja-apka.example.com/billing?cancelled=1"
  }'
# { url: "https://checkout.stripe.com/…", sessionId: "cs_…" }
# Po stronie klienta:  window.location.href = data.url
# Po opłacie Stripe → webhook → wallet końcowego usera += tokensGranted.`
}

function endUserFlowFetch(key: string): string {
  return `// Backend Twojej aplikacji — np. Next.js route handler "/api/billing/me"
// wywoływany przez frontend gdy zalogowany user otwiera ekran billingu.

const RACCOON_KEY = process.env.RACCOON_APP_KEY!  // sk-rcn-live-…

export async function GET(req: Request) {
  const session = await getCurrentSession(req)
  if (!session) return new Response('unauthorized', { status: 401 })

  // ID Twojego usera w Twoim DB (UUID, slug, czy cokolwiek opaque)
  const externalId = session.user.id

  const resp = await fetch(
    \`https://api.raccoon.dev/v1/end-users/\${externalId}/me\`,
    { headers: { Authorization: \`Bearer \${RACCOON_KEY}\` } },
  )

  if (resp.status === 404) {
    // End-user jeszcze nie istnieje w gateway (nie wykonał żadnego requesta AI).
    // Zwróć saldo 0 + katalog do zakupu.
    const cat = await fetch('https://api.raccoon.dev/v1/billing/catalog', {
      headers: { Authorization: \`Bearer \${RACCOON_KEY}\` },
    }).then((r) => r.json())
    return Response.json({
      balance: '0', subscription: null, catalog: cat.products,
    })
  }

  return Response.json(await resp.json())
}

// Zakup z UI Twojej apki:
export async function POST(req: Request) {
  const session = await getCurrentSession(req)
  const { priceId } = await req.json()

  const resp = await fetch(
    \`https://api.raccoon.dev/v1/end-users/\${session.user.id}/checkout\`,
    {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${RACCOON_KEY}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceId,
        successUrl: \`\${process.env.APP_URL}/billing?ok=1\`,
        cancelUrl:  \`\${process.env.APP_URL}/billing?cancel=1\`,
      }),
    },
  )
  const { url } = await resp.json()
  return Response.json({ url })   // frontend: window.location.href = url
}`
}
