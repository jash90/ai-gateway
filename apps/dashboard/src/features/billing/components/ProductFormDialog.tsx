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
import { useCreateProduct, type BillingMode } from '../hooks/useProducts'

interface ProductFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ProductFormDialog = React.memo(function ProductFormDialog({
  open,
  onOpenChange,
}: ProductFormDialogProps) {
  const create = useCreateProduct()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [mode, setMode] = React.useState<BillingMode>('PACKAGE')

  React.useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setMode('PACKAGE')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        mode,
      })
      toast.success('Produkt utworzony.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się utworzyć produktu.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowy produkt</DialogTitle>
          <DialogDescription>
            Utwórz produkt w Stripe i zsynchronizuj z naszym DB. Po utworzeniu dodaj do niego ceny.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Nazwa">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Pakiet Starter — 1M tokenów"
              maxLength={120}
              autoFocus
              required
            />
          </Field>
          <Field label="Opis (opcjonalnie)">
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="np. Idealny na start"
              maxLength={500}
            />
          </Field>
          <Field label="Typ rozliczenia">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'PACKAGE' ? 'default' : 'outline'}
                onClick={() => setMode('PACKAGE')}
              >
                Pakiet (jednorazowy)
              </Button>
              <Button
                type="button"
                variant={mode === 'SUBSCRIPTION' ? 'default' : 'outline'}
                onClick={() => setMode('SUBSCRIPTION')}
              >
                Subskrypcja
              </Button>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {mode === 'PACKAGE'
                ? 'Klient płaci raz, dostaje tokeny. Nie odnawia się automatycznie.'
                : 'Klient płaci miesięcznie/rocznie, tokeny są resetowane na początku każdego okresu.'}
            </p>
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Tworzenie…' : 'Utwórz'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
ProductFormDialog.displayName = 'ProductFormDialog'

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
