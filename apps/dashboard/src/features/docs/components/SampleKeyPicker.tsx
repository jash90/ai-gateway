import * as React from 'react'
import { Key, AlertCircle } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import {
  useApplicationsControllerList,
  useApplicationKeysControllerList,
} from '@gen/api'

interface SampleKeyPickerProps {
  /** Selected application id. */
  applicationId: string | null
  onApplicationChange: (id: string) => void
}

/**
 * App picker for /docs — choose which app's key prefix gets injected into
 * snippets. We don't show the full secret (we don't have it), only the prefix
 * (`sk-rcn-live-abcd`) plus a hint to copy from the dashboard.
 */
export const SampleKeyPicker = React.memo(function SampleKeyPicker({
  applicationId,
  onApplicationChange,
}: SampleKeyPickerProps) {
  const apps = useApplicationsControllerList({})
  const keys = useApplicationKeysControllerList(applicationId ?? '', {
    query: { enabled: !!applicationId },
  })

  const appList = apps.data ?? []
  const activeKey = (keys.data ?? []).find((k) => !k.revokedAt)

  // Auto-pick first app if none selected.
  React.useEffect(() => {
    if (!applicationId && appList.length > 0) {
      onApplicationChange(appList[0].id)
    }
  }, [applicationId, appList, onApplicationChange])

  if (appList.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium text-amber-900">Brak aplikacji</p>
          <p className="mt-0.5 text-amber-800">
            Utwórz aplikację i wygeneruj klucz, żeby snippety używały Twojego prefiksu zamiast{' '}
            <code className="text-xs">sk-rcn-live-XXX</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <Key className="h-4 w-4 text-neutral-500" />
      <span className="text-sm text-neutral-700">Snippety dla aplikacji:</span>
      <Select value={applicationId ?? appList[0].id} onValueChange={onApplicationChange}>
        <SelectTrigger className="h-8 max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {appList.map((app) => (
            <SelectItem key={app.id} value={app.id}>
              {app.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {activeKey && (
        <span className="ml-auto text-xs text-neutral-500">
          Prefix: <code className="font-mono text-xs">{activeKey.keyPrefix}…</code>
        </span>
      )}
    </div>
  )
})
SampleKeyPicker.displayName = 'SampleKeyPicker'
