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

interface KeyRevealModalProps {
  open: boolean
  /** The plaintext sk-rcn-live-... secret. Shown ONCE per key creation. */
  secret: string | null
  keyPrefix: string | null
  label?: string | null
  /** Called when the user explicitly acknowledges they've saved the key. */
  onAcknowledge: () => void
}

/**
 * One-time-reveal modal shown right after `POST /v1/apps/:id/keys`. The user
 * MUST check the "I've stored this securely" checkbox to dismiss — preventing
 * accidental loss before they copy.
 *
 * The modal blocks dismissal via overlay-click / ESC for the same reason.
 * Once dismissed the secret is never shown again — they have to revoke and
 * generate a new one.
 */
export const KeyRevealModal = React.memo(function KeyRevealModal({
  open,
  secret,
  keyPrefix,
  label,
  onAcknowledge,
}: KeyRevealModalProps) {
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  // Reset state on each open.
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
      toast.success('Klucz skopiowany do schowka.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Nie udało się skopiować — zaznacz i skopiuj ręcznie.')
    }
  }

  return (
    <Dialog
      open={open}
      // Block ESC / overlay-click dismissal — must explicitly acknowledge.
      onOpenChange={() => undefined}
    >
      <DialogContent
        hideClose
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Skopiuj klucz teraz — zobaczysz go tylko raz
          </DialogTitle>
          <DialogDescription>
            {label ? `Klucz „${label}" został wygenerowany. ` : 'Klucz został wygenerowany. '}
            Zapisz go w bezpiecznym miejscu (np. menedżer haseł). Po zamknięciu
            tego okna nie będzie możliwości jego odzyskania — będziesz musiał
            wygenerować nowy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {keyPrefix && (
            <p className="text-xs text-neutral-500">
              Prefix do identyfikacji w panelu: <code className="font-mono">{keyPrefix}</code>
            </p>
          )}
          <div className="flex items-stretch gap-2">
            <code className="flex-1 select-all rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm break-all">
              {secret ?? '—'}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
              aria-label="Skopiuj klucz"
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
              Zapisałem klucz w bezpiecznym miejscu i rozumiem, że nie będzie go
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
KeyRevealModal.displayName = 'KeyRevealModal'
