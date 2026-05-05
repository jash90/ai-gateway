import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
import { Input } from '@shared/ui/Input'
import { Button } from '@shared/ui/Button'
import { useCreatePrice, type BillingMode } from '../hooks/useProducts'

interface PriceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId: string | null
  productMode: BillingMode | null
  productName: string | null
}

export const PriceFormDialog = React.memo(function PriceFormDialog({
  open,
  onOpenChange,
  productId,
  productMode,
  productName,
}: PriceFormDialogProps) {
  const create = useCreatePrice()
  const [unitAmountUsd, setUnitAmountUsd] = React.useState('')
  const [tokensGranted, setTokensGranted] = React.useState('')
  const [interval, setInterval] = React.useState<'month' | 'year' | null>(null)
  const [tokensRolloverOnRenew, setTokensRolloverOnRenew] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setUnitAmountUsd('')
      setTokensGranted('')
      setInterval(productMode === 'SUBSCRIPTION' ? 'month' : null)
      setTokensRolloverOnRenew(false)
    }
  }, [open, productMode])

  const isSubscription = productMode === 'SUBSCRIPTION'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productId) return

    const usd = Number(unitAmountUsd.replace(',', '.'))
    if (!Number.isFinite(usd) || usd <= 0) {
      toast.error('Podaj cenę w USD większą od 0.')
      return
    }
    const cents = Math.round(usd * 100)

    const tokens = tokensGranted.replace(/\s/g, '').replace(/_/g, '')
    if (!/^\d+$/.test(tokens) || BigInt(tokens) <= 0n) {
      toast.error('Liczba tokenów musi być dodatnią liczbą całkowitą.')
      return
    }

    try {
      await create.mutateAsync({
        productId,
        unitAmount: cents,
        tokensGranted: tokens,
        interval: isSubscription ? interval : null,
        metadata: isSubscription ? { tokensRolloverOnRenew } : undefined,
      })
      toast.success('Cena utworzona w Stripe.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się utworzyć ceny.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowa cena dla &quot;{productName ?? '—'}&quot;</DialogTitle>
          <DialogDescription>
            Cena tworzy odpowiedni Stripe Price. Każdy produkt może mieć wiele cen (np. miesięczna i roczna).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Cena (USD)">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="49.99"
              value={unitAmountUsd}
              onChange={(e) => setUnitAmountUsd(e.target.value)}
              autoFocus
              required
            />
            <p className="mt-1 text-xs text-neutral-500">Stripe rozlicza w centach. 49.99 = 4999¢.</p>
          </Field>
          <Field label="Tokeny przyznane">
            <Input
              type="text"
              inputMode="numeric"
              placeholder="1000000"
              value={tokensGranted}
              onChange={(e) => setTokensGranted(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-neutral-500">
              {isSubscription
                ? 'Liczba tokenów dodawanych/resetowanych na początku każdego okresu.'
                : 'Liczba tokenów dodawana do salda po jednorazowej płatności.'}
            </p>
          </Field>
          {isSubscription && (
            <>
              <Field label="Okres rozliczeniowy">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={interval === 'month' ? 'default' : 'outline'}
                    onClick={() => setInterval('month')}
                  >
                    Miesięcznie
                  </Button>
                  <Button
                    type="button"
                    variant={interval === 'year' ? 'default' : 'outline'}
                    onClick={() => setInterval('year')}
                  >
                    Rocznie
                  </Button>
                </div>
              </Field>
              <Field label="Tokeny przy odnowieniu">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={!tokensRolloverOnRenew ? 'default' : 'outline'}
                    onClick={() => setTokensRolloverOnRenew(false)}
                  >
                    Reset (use it or lose it)
                  </Button>
                  <Button
                    type="button"
                    variant={tokensRolloverOnRenew ? 'default' : 'outline'}
                    onClick={() => setTokensRolloverOnRenew(true)}
                  >
                    Rollover (kumulacja)
                  </Button>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {tokensRolloverOnRenew
                    ? 'Niewykorzystane tokeny przechodzą do następnego okresu (ryzyko niekończącego się salda).'
                    : 'Saldo resetowane na początku każdego okresu (standard SaaS).'}
                </p>
              </Field>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={create.isPending || !productId}>
              {create.isPending ? 'Tworzenie…' : 'Utwórz'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
PriceFormDialog.displayName = 'PriceFormDialog'

const Field = React.memo(function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      {children}
    </div>
  )
})
