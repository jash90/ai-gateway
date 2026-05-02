import { createFileRoute } from '@tanstack/react-router'
import { ComingInSprintCard } from '@shared/components/ComingInSprintCard'

/**
 * ModelPricing CRUD endpoint isn't exposed via the API yet — admin can manage
 * via `prisma db seed` for now. Sprint 4 (admin refactor ticket BE-S4-pricing)
 * adds GET/POST/PATCH/DELETE on /v1/admin/model-pricing.
 */
export const Route = createFileRoute('/admin/pricing')({
  component: () => (
    <ComingInSprintCard
      pageTitle="Cennik modeli"
      pageSubtitle="ModelPricing — info-only, używany do liczenia costUsd"
      sprintLabel="Sprint 4"
      description="Endpointy CRUD ModelPricing dochodzą w Sprint 4 razem z multi-tenant adminem. Aktualne ceny zasiewane są przez prisma db seed."
      cta={{ label: 'Wróć do panelu', href: '/admin' }}
    />
  ),
})
