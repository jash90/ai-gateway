import { createFileRoute } from '@tanstack/react-router'
import { AccountsList } from '@features/admin'

export const Route = createFileRoute('/admin/customers')({
  component: AccountsList,
})
