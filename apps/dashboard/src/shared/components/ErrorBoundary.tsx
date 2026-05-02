import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@shared/ui/Button'
import { Card, CardContent } from '@shared/ui/Card'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }
      return (
        <Card className="m-4">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <div className="text-center">
              <h3 className="text-lg font-semibold text-neutral-900">
                Wystąpił błąd
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                {this.state.error?.message || 'Nieoczekiwany błąd aplikacji.'}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
            >
              Spróbuj ponownie
            </Button>
          </CardContent>
        </Card>
      )
    }
    return this.props.children
  }
}
