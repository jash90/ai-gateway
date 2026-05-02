import { createFileRoute } from '@tanstack/react-router'
import { AppList } from '@features/applications'

export const Route = createFileRoute('/applications/')({
  component: AppList,
})
