import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Users, FileText, DollarSign, CreditCard } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { useAuthStore } from '@shared/stores/auth-store'

/**
 * Admin landing page — Sprint 1 keeps it minimal: list of admin sub-routes
 * + role check. Sprint 4 adds system-wide analytics cards.
 */
const AdminIndexPage = React.memo(function AdminIndexPage() {
  const account = useAuthStore((s) => s.account)

  // Defense-in-depth (sidebar already hides admin links for non-admins, but
  // a direct URL hit shouldn't render admin UI).
  if (account?.role !== 'ADMIN') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-neutral-600">
          Ten widok jest dostępny tylko dla kont administratora.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Panel administratora</h1>
        <p className="text-sm text-neutral-500">Dostęp do systemowych metryk i kont.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <AdminCard
          to="/admin/billing"
          icon={<CreditCard className="h-5 w-5" />}
          title="Billing — Stripe"
          description="Skonfiguruj klucze API i webhook endpoint"
        />
        <AdminCard
          to="/admin/customers"
          icon={<Users className="h-5 w-5" />}
          title="Konta klientów"
          description="Multi-tenant view: wszystkie konta + apki + koszty 30d"
        />
        <AdminCard
          to="/admin/audit-logs"
          icon={<FileText className="h-5 w-5" />}
          title="Audit log"
          description="Działa — Sprint 1"
        />
        <AdminCard
          to="/admin/pricing"
          icon={<DollarSign className="h-5 w-5" />}
          title="Cennik modeli"
          description="ModelPricing CRUD"
        />
      </div>
    </div>
  )
})
AdminIndexPage.displayName = 'AdminIndexPage'

const AdminCard = React.memo(function AdminCard({
  to,
  icon,
  title,
  description,
}: {
  to: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link to={to}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-neutral-500">{description}</CardContent>
      </Card>
    </Link>
  )
})
AdminCard.displayName = 'AdminCard'

export const Route = createFileRoute('/admin/')({
  component: AdminIndexPage,
})
