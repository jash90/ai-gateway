import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as React from 'react'
import { useAuthStore } from '@shared/stores/auth-store'
import { RegisterForm } from '@features/auth'

function RegisterPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())

  React.useEffect(() => {
    if (isAuthenticated) void navigate({ to: '/overview' })
  }, [isAuthenticated, navigate])

  return <RegisterForm />
}

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})
