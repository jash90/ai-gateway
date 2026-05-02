import { createFileRoute } from '@tanstack/react-router'
import { ProviderKeyList } from '@features/provider-keys'

export const Route = createFileRoute('/settings/provider-keys')({
  component: ProviderKeyList,
})
