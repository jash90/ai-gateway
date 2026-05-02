import { createFileRoute } from '@tanstack/react-router'
import { AlertList } from '@features/alerts'

export const Route = createFileRoute('/settings/alerts')({
  component: AlertList,
})
