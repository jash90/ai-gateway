import * as React from 'react'
import { Construction, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'

interface ComingInSprintCardProps {
  /** Page title shown above the card. */
  pageTitle: string
  /** Page subtitle (under H1). */
  pageSubtitle?: string
  /** "Sprint 2", "Sprint 3", etc. */
  sprintLabel: string
  /** What's coming, in one Polish sentence. */
  description: string
  /** Optional CTA button. */
  cta?: {
    label: string
    href: string
  }
}

/**
 * Placeholder shown on routes whose backing endpoints aren't built yet.
 * Tracks Sprint 1 close-out — disabled-module routes (admin, alerts, webhooks,
 * usage analytics) get this card until their respective sprints rebuild them.
 */
export const ComingInSprintCard = React.memo(function ComingInSprintCard({
  pageTitle,
  pageSubtitle,
  sprintLabel,
  description,
  cta,
}: ComingInSprintCardProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{pageTitle}</h1>
        {pageSubtitle && (
          <p className="text-sm text-neutral-500">{pageSubtitle}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-amber-600" />
            Tymczasowo niedostępne
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-neutral-600">
          <p>
            Ten widok będzie dostępny w{' '}
            <strong className="text-neutral-900">{sprintLabel}</strong>.
          </p>
          <p>{description}</p>
          {cta && (
            <div className="pt-2">
              <Button asChild>
                <a href={cta.href}>
                  {cta.label}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
})
ComingInSprintCard.displayName = 'ComingInSprintCard'
