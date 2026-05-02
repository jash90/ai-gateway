import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsDashboard } from '@features/analytics'

const AnalyticsPage = React.memo(function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Analityka</h1>
        <p className="text-sm text-neutral-500">
          Liczba requestów, tokeny, koszt i latencja — ostatnie 30 dni.
        </p>
      </div>
      <AnalyticsDashboard />
    </div>
  )
})
AnalyticsPage.displayName = 'AnalyticsPage'

export const Route = createFileRoute('/analytics/')({
  component: AnalyticsPage,
})
