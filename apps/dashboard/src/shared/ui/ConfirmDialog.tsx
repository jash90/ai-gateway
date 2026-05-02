import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/Dialog'
import { Button } from '@shared/ui/Button'

/**
 * Pre-built confirm dialog. Replaces native `window.confirm()` everywhere.
 *
 * Two ways to use:
 *
 *  1) Imperative via `useConfirm()`:
 *
 *       const confirm = useConfirm()
 *       const ok = await confirm({
 *         title: 'Cofnąć klucz?',
 *         description: 'Aplikacje używające tego klucza przestaną działać.',
 *         confirmLabel: 'Cofnij klucz',
 *         destructive: true,
 *       })
 *       if (ok) await revokeKey()
 *
 *  2) Declarative as a regular controlled component (when you need it inside
 *     a form, or with custom JSX in the body):
 *
 *       <ConfirmDialog
 *         open={open}
 *         onOpenChange={setOpen}
 *         title="..."
 *         description="..."
 *         onConfirm={() => doIt()}
 *       />
 */
export interface ConfirmDialogOptions {
  title: string
  description?: string
  /** Defaults to "Potwierdź". */
  confirmLabel?: string
  /** Defaults to "Anuluj". */
  cancelLabel?: string
  /** Renders the confirm button in red. Use for revoke / delete / drop. */
  destructive?: boolean
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export const ConfirmDialog = React.memo(function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Potwierdź',
  cancelLabel = 'Anuluj',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)

  const handleConfirm = async () => {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent hideClose={pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? 'Trwa...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
ConfirmDialog.displayName = 'ConfirmDialog'

// =============================================================================
// useConfirm() — imperative API via React Context
// =============================================================================

interface PendingConfirm extends ConfirmDialogOptions {
  resolve: (ok: boolean) => void
}

interface ConfirmContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null)

/**
 * Mount once near the root of your app:
 *
 *   <ConfirmProvider>
 *     <App />
 *   </ConfirmProvider>
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve })
      }),
    [],
  )

  const handleClose = (ok: boolean) => {
    if (pending) {
      pending.resolve(ok)
      setPending(null)
    }
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) handleClose(false)
          }}
          title={pending.title}
          description={pending.description}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          destructive={pending.destructive}
          onConfirm={() => handleClose(true)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error(
      'useConfirm() must be used within <ConfirmProvider>. Mount it near the app root.',
    )
  }
  return ctx.confirm
}
