import { createFileRoute } from '@tanstack/react-router'
import { Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'

/**
 * Playground placeholder — temporarily disabled during the Sprint 1 auth
 * migration. The full playground rewires to:
 *   - POST /v1/chat/completions (OpenAI-compat)
 *   - POST /v1/messages (Anthropic-compat)
 *   - Authenticated by an Application key selected by the user
 *
 * This work happens in Sprint 2 (BE-S2-* gateway controllers + FE-S2-*
 * playground refactor with Application picker).
 */
function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Playground</h1>
        <p className="text-sm text-neutral-500">
          Testuj zapytania do modeli językowych
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Tymczasowo niedostępny
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-neutral-600">
            Playground zostanie udostępniony w Sprint 2 razem z nowym data plane
            (<code className="rounded bg-neutral-100 px-1 py-0.5">/v1/chat/completions</code>
            {' '}i{' '}
            <code className="rounded bg-neutral-100 px-1 py-0.5">/v1/messages</code>).
            Wymaga utworzenia aplikacji i wygenerowania klucza{' '}
            <code className="rounded bg-neutral-100 px-1 py-0.5">sk-rcn-live-...</code>.
          </p>
          <p className="text-sm text-neutral-600">
            W tym momencie skonfiguruj klucze BYOK do OpenAI / Anthropic w sekcji
            Ustawienia, a aplikacje pojawią się wkrótce.
          </p>
          <div>
            <Button variant="outline" asChild>
              <a href="/settings">Otwórz Ustawienia</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/proxy/playground')({
  component: PlaygroundPage,
})
