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
import { useUpdateProduct, type BillingProductDto } from '../hooks/useProducts'

interface EditProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: BillingProductDto | null
}

export const EditProductDialog = React.memo(function EditProductDialog({
  open,
  onOpenChange,
  product,
}: EditProductDialogProps) {
  const update = useUpdateProduct()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')

  React.useEffect(() => {
    if (open && product) {
      setName(product.name)
      setDescription(product.description ?? '')
    }
  }, [open, product])

  if (!product) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Nazwa nie może być pusta.')
      return
    }
    const payload: { id: string; name?: string; description?: string | null } = {
      id: product.id,
    }
    if (name.trim() !== product.name) payload.name = name.trim()
    const newDesc = description.trim() || null
    if (newDesc !== (product.description ?? null)) payload.description = newDesc

    if (!payload.name && payload.description === undefined) {
      onOpenChange(false)
      return
    }

    try {
      await update.mutateAsync(payload)
      toast.success('Produkt zaktualizowany w Stripe.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się zapisać.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj produkt</DialogTitle>
          <DialogDescription>
            Zmiany nazwy lub opisu są synchronizowane ze Stripe. Typ rozliczenia
            (Pakiet/Subskrypcja) i istniejące ceny są niezmienne — żeby zmienić cenę,
            zdezaktywuj starą i dodaj nową.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Nazwa">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
              required
            />
          </Field>
          <Field label="Opis">
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="(opcjonalnie)"
              maxLength={500}
            />
          </Field>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p>
              <span className="font-medium text-neutral-900">Typ:</span>{' '}
              {product.mode === 'PACKAGE' ? 'Pakiet (jednorazowy)' : 'Subskrypcja'} (niezmienny)
            </p>
            <p className="mt-1">
              <span className="font-medium text-neutral-900">Status:</span>{' '}
              {product.isActive ? 'Aktywny' : 'Nieaktywny'} (zmień przyciskiem Aktywuj/Deaktywuj)
            </p>
            <p className="mt-1 font-mono text-[10px] text-neutral-500">
              {product.stripeProductId}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
EditProductDialog.displayName = 'EditProductDialog'

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
