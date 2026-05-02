import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as React from 'react'
import { useAuthStore } from '@shared/stores/auth-store'
import { LoginForm } from '@features/auth'

function LoginPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())

  React.useEffect(() => {
    if (isAuthenticated) navigate({ to: '/overview' })
  }, [isAuthenticated, navigate])

  return <LoginForm />
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
})
