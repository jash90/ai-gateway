import { createFileRoute } from '@tanstack/react-router'
import { ForgotPasswordForm } from '@features/auth'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordForm,
})
