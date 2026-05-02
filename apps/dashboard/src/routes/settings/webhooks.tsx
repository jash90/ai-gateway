import { createFileRoute } from '@tanstack/react-router'
import { WebhookList } from '@features/webhooks'

export const Route = createFileRoute('/settings/webhooks')({
  component: WebhookList,
})
