import { createFileRoute } from '@tanstack/react-router'
import { AppDetail } from '@features/applications'

function AppDetailPage() {
  const { id } = Route.useParams()
  return <AppDetail applicationId={id} />
}

export const Route = createFileRoute('/applications/$id')({
  component: AppDetailPage,
})
