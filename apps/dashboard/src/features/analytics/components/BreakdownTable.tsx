import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/Card'
import { Skeleton } from '@shared/ui/Skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/Select'
import { ProviderBadge } from '@shared/components/ProviderBadge'
import { useAnalyticsControllerBreakdown } from '@gen/api'
import { formatInt, formatTokens, formatUsd } from '../utils/format'

type Dimension = 'app' | 'model' | 'provider' | 'endUser'

const DIMENSION_LABELS: Record<Dimension, string> = {
  app: 'Aplikacja',
  model: 'Model',
  provider: 'Provider',
  endUser: 'End user',
}

interface BreakdownTableProps {
  applicationId?: string
}

export const BreakdownTable = React.memo(function BreakdownTable({
  applicationId,
}: BreakdownTableProps) {
  const [dimension, setDimension] = React.useState<Dimension>('model')
  const query = useAnalyticsControllerBreakdown({
    dimension,
    ...(applicationId ? { applicationId } : {}),
  })

  const rows = query.data?.rows ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Podział</CardTitle>
        <Select value={dimension} onValueChange={(v) => setDimension(v as Dimension)}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="model">wg modelu</SelectItem>
            <SelectItem value="provider">wg providera</SelectItem>
            <SelectItem value="app">wg aplikacji</SelectItem>
            <SelectItem value="endUser">wg end-usera</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        {query.isLoading ? (
          <div className="p-6">
            <Skeleton className="h-32 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">
            Brak danych w wybranym wymiarze.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2 font-medium">{DIMENSION_LABELS[dimension]}</th>
                <th className="px-4 py-2 text-right font-medium">Requesty</th>
                <th className="px-4 py-2 text-right font-medium">Tokeny</th>
                <th className="px-4 py-2 text-right font-medium">Koszt</th>
                <th className="px-4 py-2 text-right font-medium">Błędy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-neutral-100 last:border-b-0"
                >
                  <td className="px-4 py-2.5">
                    <LabelCell dimension={dimension} label={row.label} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatInt(row.requests)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                    {formatTokens(row.inputTokens + row.outputTokens)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">
                    {formatUsd(row.costUsd, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.errorCount > 0 ? (
                      <span className="text-red-600">{formatInt(row.errorCount)}</span>
                    ) : (
                      <span className="text-neutral-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
})
BreakdownTable.displayName = 'BreakdownTable'

const LabelCell = React.memo(function LabelCell({
  dimension,
  label,
}: {
  dimension: Dimension
  label: string
}) {
  if (dimension === 'provider' && (label === 'OPENAI' || label === 'ANTHROPIC' || label === 'OPENROUTER')) {
    return <ProviderBadge provider={label} />
  }
  return <span className="text-neutral-900">{label}</span>
})
LabelCell.displayName = 'LabelCell'
