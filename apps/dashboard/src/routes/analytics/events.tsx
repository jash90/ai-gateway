import { createFileRoute } from '@tanstack/react-router'
import { EventsList } from '@features/analytics'

export const Route = createFileRoute('/analytics/events')({
  component: EventsList,
})
