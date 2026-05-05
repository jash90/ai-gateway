import { createFileRoute } from '@tanstack/react-router'
import { DocsPage } from '@features/docs'

export const Route = createFileRoute('/integration')({
  component: DocsPage,
})
