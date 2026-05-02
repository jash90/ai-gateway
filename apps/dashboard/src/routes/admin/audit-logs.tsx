import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAuditControllerGetLogs } from '@gen/api'
import type { AuditLogsResponseDtoLogsItem } from '@gen/api.schemas'
import { DataTable } from '@shared/components/DataTable'
import { EmptyState } from '@shared/components/EmptyState'
import { Skeleton } from '@shared/ui/Skeleton'
import { FileText } from 'lucide-react'
import { formatDate } from '@shared/utils/format'
import type { ColumnDef } from '@tanstack/react-table'

type AuditRow = AuditLogsResponseDtoLogsItem

const columns: ColumnDef<AuditRow>[] = [
  { accessorKey: 'createdAt', header: 'Czas', cell: ({ getValue }) => formatDate(getValue() as string) },
  { accessorKey: 'action', header: 'Akcja' },
  { accessorKey: 'actorType', header: 'Typ aktora' },
  { accessorKey: 'resource', header: 'Zasób' },
]

function AuditLogsPage() {
  // Fully typed end-to-end via nestjs-zod → OpenAPI → Orval. No casts needed.
  const logsQuery = useAuditControllerGetLogs()
  const logs = React.useMemo(() => logsQuery.data?.logs ?? [], [logsQuery.data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Dziennik audytu</h1>
        <p className="text-sm text-neutral-500">Historia akcji w systemie</p>
      </div>
      {logsQuery.isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : logs.length === 0 ? (
        <EmptyState icon={<FileText className="h-12 w-12" />} title="Brak wpisów" description="Wpisy pojawią się po aktywności." />
      ) : (
        <DataTable columns={columns} data={logs} />
      )}
    </div>
  )
}

export const Route = createFileRoute('/admin/audit-logs')({
  component: AuditLogsPage,
})
