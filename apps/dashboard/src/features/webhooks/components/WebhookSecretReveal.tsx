import * as React from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
import { Button } from '@shared/ui/Button'

interface WebhookSecretRevealProps {
  open: boolean
  secret: string | null
  onAcknowledge: () => void
}

/**
 * One-time-reveal modal for webhook signing secret (`whsec_...`).
 * Same UX as KeyRevealModal — forced acknowledge, no ESC/overlay-click dismiss.
 */
export const WebhookSecretReveal = React.memo(function WebhookSecretReveal({
  open,
  secret,
  onAcknowledge,
}: WebhookSecretRevealProps) {
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setAcknowledged(false)
      setCopied(false)
    }
  }, [open])

  const handleCopy = async () => {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      toast.success('Sekret skopiowany do schowka.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Nie udało się skopiować — zaznacz i skopiuj ręcznie.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        hideClose
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Skopiuj sekret HMAC teraz
          </DialogTitle>
          <DialogDescription>
            Sekret służy do weryfikacji podpisu webhook payloadów po Twojej stronie
            (header <code className="rounded bg-neutral-100 px-1 text-xs">X-Raccoon-Signature</code>).
            Po zamknięciu tego okna nie zobaczysz go już ponownie. Jeśli go zgubisz,
            będziesz musiał wygenerować nowy webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-stretch gap-2">
            <code className="flex-1 select-all rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm break-all">
              {secret ?? '—'}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
              aria-label="Skopiuj sekret"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <label className="flex cursor-pointer items-start gap-2 pt-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-neutral-700">
              Zapisałem sekret w bezpiecznym miejscu i rozumiem, że nie będzie go
              można odzyskać.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={onAcknowledge} disabled={!acknowledged}>
            Zamknij
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
WebhookSecretReveal.displayName = 'WebhookSecretReveal'
