import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VerifyEmailScreen } from '@features/auth'

const searchSchema = z.object({
  token: z.string().optional(),
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  return <VerifyEmailScreen token={token} />
}

export const Route = createFileRoute('/verify-email')({
  component: VerifyEmailPage,
  validateSearch: searchSchema,
})
