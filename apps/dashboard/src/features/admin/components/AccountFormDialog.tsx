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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import {
  useCreateAdminAccount,
  useUpdateAdminAccount,
  type AdminAccountSummary,
} from '../hooks/useAdminAccounts'

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; account: AdminAccountSummary }
  | { kind: 'reset-password'; account: AdminAccountSummary }

interface AccountFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: Mode | null
}

/**
 * Single dialog used for: tworzenie konta, edycja (rola/imię/aktywność/email-verified),
 * reset hasła. Mode determines which fields render — keeps it one component
 * instead of three near-identical dialogs.
 */
export const AccountFormDialog = React.memo(function AccountFormDialog({
  open,
  onOpenChange,
  mode,
}: AccountFormDialogProps) {
  const create = useCreateAdminAccount()
  const update = useUpdateAdminAccount()

  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState<'USER' | 'ADMIN'>('USER')
  const [emailVerified, setEmailVerified] = React.useState(true)
  const [isActive, setIsActive] = React.useState(true)
  const [newPassword, setNewPassword] = React.useState('')

  // Reset state when dialog opens with new mode.
  React.useEffect(() => {
    if (!open || !mode) return
    if (mode.kind === 'create') {
      setEmail('')
      setPassword('')
      setName('')
      setRole('USER')
      setEmailVerified(true)
    } else if (mode.kind === 'edit') {
      setEmail(mode.account.email)
      setName(mode.account.name ?? '')
      setRole(mode.account.role)
      setEmailVerified(mode.account.emailVerified)
      setIsActive(mode.account.isActive)
    } else if (mode.kind === 'reset-password') {
      setNewPassword('')
    }
  }, [open, mode])

  if (!mode) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (mode.kind === 'create') {
        await create.mutateAsync({
          email: email.trim().toLowerCase(),
          password,
          name: name.trim() || null,
          role,
          emailVerified,
        })
        toast.success('Konto utworzone.')
      } else if (mode.kind === 'edit') {
        await update.mutateAsync({
          id: mode.account.id,
          input: {
            name: name.trim() === (mode.account.name ?? '').trim()
              ? undefined
              : name.trim() || null,
            role: role === mode.account.role ? undefined : role,
            isActive: isActive === mode.account.isActive ? undefined : isActive,
            emailVerified:
              emailVerified === mode.account.emailVerified ? undefined : emailVerified,
          },
        })
        toast.success('Konto zaktualizowane.')
      } else {
        await update.mutateAsync({
          id: mode.account.id,
          input: { newPassword },
        })
        toast.success('Hasło zresetowane.')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Operacja nie powiodła się.')
    }
  }

  const isPending = create.isPending || update.isPending
  const title =
    mode.kind === 'create'
      ? 'Nowe konto'
      : mode.kind === 'edit'
        ? `Edytuj ${mode.account.email}`
        : `Resetuj hasło dla ${mode.account.email}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === 'create' &&
              'Konto powstanie z gotowym hasłem. Komunikat OOB do użytkownika należy do Ciebie.'}
            {mode.kind === 'edit' &&
              'Wyłączenie konta cofa wszystkie aktywne refresh tokeny.'}
            {mode.kind === 'reset-password' &&
              'Ustaw nowe hasło. Użytkownik dostanie je OOB — nie wysyłamy maila.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode.kind === 'create' && (
            <>
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Hasło początkowe">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="min. 8 znaków"
                />
              </Field>
              <Field label="Imię (opcjonalne)">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label="Rola">
                <Select value={role} onValueChange={(v) => setRole(v as 'USER' | 'ADMIN')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">USER</SelectItem>
                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Toggle
                label="Email zweryfikowany"
                hint="Włączone — user może zalogować się od razu, bez maila weryfikacyjnego."
                value={emailVerified}
                onChange={setEmailVerified}
              />
            </>
          )}

          {mode.kind === 'edit' && (
            <>
              <Field label="Imię">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label="Rola">
                <Select value={role} onValueChange={(v) => setRole(v as 'USER' | 'ADMIN')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USER">USER</SelectItem>
                    <SelectItem value="ADMIN">ADMIN</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Toggle
                label="Konto aktywne"
                hint="Wyłączenie revoke'uje wszystkie aktywne refresh tokeny natychmiast."
                value={isActive}
                onChange={setIsActive}
              />
              <Toggle
                label="Email zweryfikowany"
                hint="Override — np. konta provisionowane przez admina."
                value={emailVerified}
                onChange={setEmailVerified}
              />
            </>
          )}

          {mode.kind === 'reset-password' && (
            <Field label="Nowe hasło">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
                placeholder="min. 8 znaków"
              />
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? 'Zapisywanie…'
                : mode.kind === 'create'
                  ? 'Utwórz konto'
                  : mode.kind === 'reset-password'
                    ? 'Zmień hasło'
                    : 'Zapisz'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
})
AccountFormDialog.displayName = 'AccountFormDialog'

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

const Toggle = React.memo(function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">{label}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-neutral-200 bg-neutral-50 text-neutral-600'
          }`}
        >
          {value ? 'Włączone' : 'Wyłączone'}
        </button>
      </div>
    </div>
  )
})
